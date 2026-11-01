import { describe, expect, it } from 'vitest'

import type { JobDefinition, JobRunQuery, JobRunRecord, ScheduledJobDefinition } from '../contracts/jobTypes'
import { projectJobSchedules } from './jobScheduleView'

const now = new Date('2026-07-17T09:30:00.000Z')

  it('leaves an internal definition registered but out of the user-facing table', () => {
    const internal = definition({ id: 'job-internal', title: 'Notification retention', visibility: 'internal' })
    const resource = definition({ id: 'job-resource', title: 'Collect the dollar index' })
    const source = { listSchedules: () => [internal, resource], listRuns: () => [] }

    const projected = projectJobSchedules(source, { now })
    expect(projected.map((view) => view.id)).toEqual(['job-resource'])
    // Two assertions, not one: "not in the table" alone would also pass if the projection were
    // broken and returned nothing, and it would not distinguish hiding from unregistering.
    expect(source.listSchedules().map((item) => item.id)).toEqual(['job-internal', 'job-resource'])
  })

describe('projectJobSchedules', () => {
  it('projects the safe schedule fields and never leaks payload, handler, or redaction internals', () => {
    const views = projectJobSchedules({
      listSchedules: () => [
        definition({
          id: 'market-intelligence.source.crypto-news',
          owner: 'product',
          productId: 'market-intelligence',
          title: 'Crypto news collection',
          trigger: { kind: 'cron', expression: '0 * * * *', timezone: 'Asia/Shanghai' },
          payload: { credentialRef: 'vault://market-intelligence/news', workspacePath: '/tmp/profile/secret' },
          redact: () => ({ redacted: true })
        })
      ],
      listRuns: () => []
    }, { now })

    expect(views).toEqual([{
      id: 'market-intelligence.source.crypto-news',
      title: 'Crypto news collection',
      owner: 'product',
      productId: 'market-intelligence',
      trigger: { kind: 'cron', expression: '0 * * * *', timezone: 'Asia/Shanghai' },
      registered: true,
      nextRunAt: '2026-07-17T10:00:00.000Z',
      lastRunAt: null,
      lastOutcome: 'never',
      lastRunStatus: null,
      lastDurationMs: null,
      lastErrorSummary: null
    }])
    const serialized = JSON.stringify(views)
    expect(serialized).not.toContain('vault://')
    expect(serialized).not.toContain('/tmp/profile/secret')
    expect(serialized).not.toContain('handlerId')
    expect(views[0]).not.toHaveProperty('payload')
    expect(views[0]).not.toHaveProperty('redact')
  })

  it('derives registration only from listSchedules and projects nothing when no definition is registered', () => {
    expect(projectJobSchedules({ listSchedules: () => [], listRuns: () => [] }, { now })).toEqual([])
  })

  it('reports the latest run outcome, time, and duration and derives the next interval run from the last run', () => {
    const runs: JobRunRecord[] = [
      run({ id: 'run-2', definitionId: 'job-interval', status: 'failed', createdAt: '2026-07-17T09:00:00.000Z', startedAt: '2026-07-17T09:00:01.000Z', completedAt: '2026-07-17T09:00:05.000Z' }),
      run({ id: 'run-1', definitionId: 'job-interval', status: 'completed', createdAt: '2026-07-17T08:00:00.000Z', completedAt: '2026-07-17T08:00:05.000Z' })
    ]
    const views = projectJobSchedules({
      listSchedules: () => [
        definition({
          id: 'job-interval',
          owner: 'platform',
          title: 'Interval job',
          trigger: { kind: 'interval', intervalMs: 900_000, anchor: 'lastComplete' }
        })
      ],
      listRuns: (query) => runs.filter((item) => item.definitionId === query?.definitionId).slice(0, query?.limit ?? runs.length)
    }, { now })

    expect(views[0]?.lastRunAt).toBe('2026-07-17T09:00:05.000Z')
    expect(views[0]?.lastOutcome).toBe('failed')
    expect(views[0]?.lastRunStatus).toBe('failed')
    expect(views[0]?.lastDurationMs).toBe(4_000)
    expect(views[0]?.nextRunAt).toBe('2026-07-17T09:15:05.000Z')
  })

  it('reads the newest run by time, not by run id text, once the shared sequence passes 9999', () => {
    const calls: JobRunQuery[] = []
    // Exactly what the repository does: default order compares the id text, so `…-9999` sits above
    // `…-23789` and the older run wins; `newestFirst` compares `created_at`.
    const runs: JobRunRecord[] = [
      run({ id: 'run-sqlite-9999', definitionId: 'job-hi-freq', status: 'completed', createdAt: '2026-07-10T08:00:00.000Z' }),
      run({ id: 'run-sqlite-23789', definitionId: 'job-hi-freq', status: 'failed', createdAt: '2026-07-17T09:00:00.000Z' })
    ]
    const views = projectJobSchedules({
      listSchedules: () => [definition({ id: 'job-hi-freq', title: 'High frequency job' })],
      listRuns: (query) => {
        calls.push(query ?? {})
        const ordered = [...runs].sort((a, b) => query?.newestFirst
          ? b.createdAt.localeCompare(a.createdAt)
          : b.id.localeCompare(a.id))
        return ordered.slice(0, query?.limit ?? ordered.length)
      }
    }, { now })

    expect(calls).toEqual([{ definitionId: 'job-hi-freq', limit: 1, newestFirst: true }])
    expect(views[0]?.lastRunAt).toBe('2026-07-17T09:00:00.000Z')
    expect(views[0]?.lastOutcome).toBe('failed')
  })

  it('maps cancelled runs to skipped and keeps in-flight runs without a terminal outcome', () => {
    const views = projectJobSchedules({
      listSchedules: () => [
        definition({ id: 'job-cancelled', title: 'Cancelled job' }),
        definition({ id: 'job-running', title: 'Running job' })
      ],
      listRuns: (query) => query?.definitionId === 'job-cancelled'
        ? [run({ definitionId: 'job-cancelled', status: 'cancelled', createdAt: '2026-07-17T09:00:00.000Z', completedAt: '2026-07-17T09:00:01.000Z' })]
        : [run({ id: 'run-running', definitionId: 'job-running', status: 'running', createdAt: '2026-07-17T09:20:00.000Z', startedAt: '2026-07-17T09:20:01.000Z' })]
    }, { now })

    expect(views[0]?.lastOutcome).toBe('skipped')
    expect(views[0]?.lastRunStatus).toBe('cancelled')
    expect(views[1]?.lastOutcome).toBe('never')
    expect(views[1]?.lastRunStatus).toBe('running')
    expect(views[1]?.lastRunAt).toBe('2026-07-17T09:20:01.000Z')
    expect(views[1]?.lastDurationMs).toBeNull()
  })

  it('leaves the next run empty for manual, startup, event, and unparseable cron schedules', () => {
    const views = projectJobSchedules({
      listSchedules: () => [
        definition({ id: 'job-manual', title: 'Manual job', trigger: { kind: 'manual' } }),
        definition({ id: 'job-startup', title: 'Startup job', trigger: { kind: 'startup' } }),
        definition({ id: 'job-event', title: 'Event job', trigger: { kind: 'event', topic: 'agent.session.created' } }),
        definition({ id: 'job-cron-invalid', title: 'Broken cron job', trigger: { kind: 'cron', expression: 'not-a-cron' } })
      ],
      listRuns: () => []
    }, { now })

    expect(views.map((view) => view.nextRunAt)).toEqual([null, null, null, null])
    expect(views.map((view) => view.trigger.kind)).toEqual(['manual', 'startup', 'event', 'cron'])
  })

  /**
   * 守卫（`MI-11-R40` 第 3 步）：`internal` 是平台自己维护的活（保留期清理、投递重试、状态巡检），
   * 用户既配置不了也停不了。它一旦出现在这张表里，读者就要面对一行看不懂、点不动的技术条目——
   * 所以这里断言的是「表里不可能有 internal」，不是「默认没有」。
   */
  it('never shows an internal maintenance definition in the table the reader sees', () => {
    const views = projectJobSchedules({
      listSchedules: () => [
        definition({ id: 'resource-job', title: 'Collect a source', visibility: 'resource' }),
        definition({ id: 'internal-job', title: 'Retention sweep', visibility: 'internal' }),
        definition({ id: 'another-resource', title: 'Refresh a calendar', visibility: 'resource' })
      ],
      listRuns: () => []
    }, { now })

    expect(views.map((view) => view.id)).toEqual(['resource-job', 'another-resource'])
    expect(views.some((view) => view.id === 'internal-job')).toBe(false)
  })
})

function definition(overrides: Partial<JobDefinition> = {}): ScheduledJobDefinition {
  return {
    id: 'job-1',
    owner: 'platform',
    handlerId: 'noop',
    title: 'Job',
    trigger: { kind: 'manual' },
    payload: {},
    visibility: 'resource',
    ...overrides
  }
}

function run(overrides: Partial<JobRunRecord> = {}): JobRunRecord {
  return {
    id: 'run-1',
    definitionId: 'job-1',
    handlerId: 'noop',
    owner: 'platform',
    title: 'Job',
    status: 'completed',
    trigger: { kind: 'manual' },
    payload: {},
    attempt: 1,
    maxAttempts: 1,
    createdAt: '2026-07-17T08:00:00.000Z',
    logs: [],
    ...overrides
  }
}
