import { describe, expect, it, vi } from 'vitest'

import type { JobRunRecord } from '../../jobs/contracts/jobTypes'
import type { NotificationSubmitRequest } from '../contracts/notificationContracts'
import { createTaskFailureNotifier } from './taskFailureNotifier'

function run(overrides: Partial<JobRunRecord> = {}): JobRunRecord {
  return {
    id: 'run-1',
    definitionId: 'definition-1',
    handlerId: 'handler-1',
    owner: 'platform',
    // 故意用「标识」而不是人话：生产代码不许把它当标题用。
    title: 'Collect 央行',
    status: 'failed',
    trigger: { kind: 'manual' },
    payload: {},
    attempt: 2,
    maxAttempts: 2,
    createdAt: '2026-11-02T01:00:00.000Z',
    startedAt: '2026-11-02T01:00:01.000Z',
    completedAt: '2026-11-02T01:00:05.000Z',
    lastError: 'upstream returned 503',
    logs: [],
    ...overrides
  }
}

function notifier(overrides: {
  resolveTaskName?: (input: { definitionId: string; productId?: string }) => string | null
} = {}) {
  const submit = vi.fn<(request: NotificationSubmitRequest) => Promise<unknown>>(async () => undefined)
  const notify = createTaskFailureNotifier({
    submit,
    resolveTaskName: overrides.resolveTaskName ?? (() => '央行利率决议采集'),
    dayToken: (instant) => instant.slice(0, 10)
  })
  return { submit, notify }
}

describe('task failure notifier', () => {
  it('submits one notification when the task actually failed, with the readable task name', async () => {
    const { submit, notify } = notifier()
    await notify({ run: run(), cause: 'executed' })

    expect(submit).toHaveBeenCalledTimes(1)
    const request = submit.mock.calls[0]?.[0] as NotificationSubmitRequest
    // 契约 §3.2：事件 id、参数、去重变量；标题/正文键在 P1 声明里，不在这里。
    expect(request.eventTypeId).toBe('platform.job.failed-terminal')
    expect(request.producerId).toBe('definition-1')
    expect(request.dedupeVars).toEqual({
      builder: 'template',
      vars: { definitionId: 'definition-1', date: '2026-11-02' }
    })
    expect(request.titleParams).toEqual({ taskName: '央行利率决议采集' })
    // 不是 run.title：那是任务标识（`Collect 央行`），不是给人看的标题。
    expect(JSON.stringify(request)).not.toContain('Collect 央行')
    expect(request.actions).toHaveLength(1)
    expect(request.deeplink).toMatchObject({ entityType: 'job-definition', entityId: 'definition-1' })
    expect(request.occurredAt).toBe('2026-11-02T01:00:05.000Z')
  })

  it('stays silent when the run succeeded: a quiet day produces nothing', async () => {
    const { submit, notify } = notifier()
    await notify({ run: run({ status: 'completed', lastError: undefined }), cause: 'executed' })
    expect(submit).not.toHaveBeenCalled()
  })

  it('stays silent for runs that never started or were recovered from a previous process', async () => {
    const { submit, notify } = notifier()
    await notify({ run: run(), cause: 'rejected' })
    await notify({ run: run(), cause: 'recovered' })
    expect(submit).not.toHaveBeenCalled()
  })

  it('stays silent when no readable task name exists, rather than falling back to the identifier', async () => {
    const { submit, notify } = notifier({ resolveTaskName: () => null })
    await notify({ run: run(), cause: 'executed' })
    expect(submit).not.toHaveBeenCalled()
  })

  it('truncates a long failure reason instead of pasting a stack trace into the notification', async () => {
    const { submit, notify } = notifier()
    await notify({ run: run({ lastError: 'x'.repeat(500) }), cause: 'executed' })
    const request = submit.mock.calls[0]?.[0] as NotificationSubmitRequest
    // 长错误不进记录：只有截断后的 reason 参数，正文键在声明里。
    expect(request.titleParams?.taskName).toBe('央行利率决议采集')
    expect(String(request.reasonParams?.reason).length).toBeLessThanOrEqual(160)
    expect(JSON.stringify(request)).not.toContain('x'.repeat(200))
  })
})
