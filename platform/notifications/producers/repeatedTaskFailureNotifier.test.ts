import { describe, expect, it, vi } from 'vitest'

import type { JobRunRecord } from '../../jobs/contracts/jobTypes'
import type { NotificationSubmitRequest } from '../contracts/notificationContracts'
import { createRepeatedTaskFailureNotifier } from './repeatedTaskFailureNotifier'

function run(overrides: Partial<JobRunRecord> = {}): JobRunRecord {
  return {
    id: 'run-3',
    definitionId: 'definition-1',
    handlerId: 'handler-1',
    owner: 'platform',
    title: 'Collect 央行',
    status: 'failed',
    trigger: { kind: 'cron', expression: '0 9 * * *' },
    payload: {},
    attempt: 1,
    maxAttempts: 1,
    createdAt: '2026-11-02T01:00:00.000Z',
    startedAt: '2026-11-02T01:00:01.000Z',
    completedAt: '2026-11-02T01:00:05.000Z',
    lastError: 'upstream returned 503',
    logs: [],
    ...overrides
  }
}

/** 同一任务、新到旧：前面 `failed` 个失败，后面用 `tail` 补历史。 */
function history(failed: number, tail: JobRunRecord['status'][] = []): JobRunRecord[] {
  const failures = Array.from({ length: failed }, (_, index) =>
    run({ id: `run-${failed - index}` })
  )
  const older = tail.map((status, index) => run({ id: `old-${tail.length - index}`, status }))
  return [...failures, ...older]
}

function notifier(overrides: {
  runs?: JobRunRecord[]
  taskNameSnapshot?: (input: { definitionId: string; productId?: string }) =>
    { 'zh-CN': string; 'en-US': string } | undefined
} = {}) {
  const submit = vi.fn<(request: NotificationSubmitRequest) => Promise<unknown>>(async () => undefined)
  const listHandlerRuns = vi.fn(() => overrides.runs ?? history(3))
  const notify = createRepeatedTaskFailureNotifier({
    submit,
    taskNameSnapshot: overrides.taskNameSnapshot ?? (() => ({ 'zh-CN': '央行利率决议采集', 'en-US': 'Central bank rate decision' })),
    listHandlerRuns,
    dayToken: (instant) => instant.slice(0, 10)
  })
  return { submit, notify, listHandlerRuns }
}

describe('repeated task failure notifier (P2)', () => {
  it('upgrades exactly at the third consecutive terminal failure', async () => {
    const { submit, notify, listHandlerRuns } = notifier()
    await notify({ run: run(), cause: 'executed' })

    expect(listHandlerRuns).toHaveBeenCalledWith('handler-1')
    expect(submit).toHaveBeenCalledTimes(1)
    const request = submit.mock.calls[0]?.[0] as NotificationSubmitRequest
    expect(request.eventTypeId).toBe('platform.job.repeated-failed')
    expect(request.producerId).toBe('handler-1')
    // 和 P1 一样：两种语言各拼一份，记录里没有文案键（契约 v2.56）。
    expect(request.rendered?.['zh-CN']?.body).toBe('央行利率决议采集已连续 3 次跑到失败；先看清楚它在哪出错，再决定要不要继续跑。')
    // 英文这一格以前缺一个空格（名字与 has 粘在一起），拼成品后是读者会直接看到的一行。
    expect(request.rendered?.['en-US']?.body).toBe('Central bank rate decision has failed three runs in a row; see what it is failing on before it runs again.')
    expect(request).not.toHaveProperty('bodyParams')
    expect(request.dedupeVars).toEqual({
      builder: 'template',
      vars: { jobKey: 'definition:definition-1', date: '2026-11-02' }
    })
    expect(request.deeplink).toMatchObject({ entityType: 'job-definition', entityId: 'definition-1' })
    expect(request.occurredAt).toBe('2026-11-02T01:00:05.000Z')
  })

  it('does not ring again on the 4th..10th failure: ten failures still produce one upgrade', async () => {
    // S3 的形状：同一任务一天失败 10 次 → P2 只有一条。
    for (const failed of [1, 2, 4, 5, 6, 7, 8, 9, 10]) {
      const { submit, notify } = notifier({ runs: history(failed) })
      await notify({ run: run(), cause: 'executed' })
      expect(submit, `chain of ${failed}`).not.toHaveBeenCalled()
    }
  })

  it('counts across days but resets after a success: a new 3-run streak rings again', async () => {
    const afterSuccess = notifier({ runs: history(2, ['completed', 'failed', 'failed']) })
    await afterSuccess.notify({ run: run(), cause: 'executed' })
    expect(afterSuccess.submit).not.toHaveBeenCalled()

    const newStreak = notifier({ runs: history(3, ['completed']) })
    await newStreak.notify({ run: run(), cause: 'executed' })
    expect(newStreak.submit).toHaveBeenCalledTimes(1)
  })

  it('counts one-shot runs of the same handler and source as one streak, across different definition ids', async () => {
    // 同一来源连续失败 3 次、每次 definitionId 都不同 → 仍然只发一条升级（恰好一条）。
    const runs = [3, 2, 1].map((index) =>
      run({
        id: `run-${index}`,
        definitionId: `market-intelligence.scoreNewsSentiment:global:1794052912${index}00:abc${index}`,
        trigger: { kind: 'manual' },
        payload: { sourceId: 'coindesk' }
      })
    )
    const upgraded = notifier({ runs })
    await upgraded.notify({ run: runs[0]!, cause: 'executed' })
    expect(upgraded.submit).toHaveBeenCalledTimes(1)

    // 换一个来源：那是另一件事，不许借前一条的计数凑到阈值。
    const other = notifier({
      runs: [run({ definitionId: 'other:1', trigger: { kind: 'manual' }, payload: { sourceId: 'theblock' } })]
    })
    await other.notify({
      run: run({ definitionId: 'other:1', trigger: { kind: 'manual' }, payload: { sourceId: 'theblock' } }),
      cause: 'executed'
    })
    expect(other.submit).not.toHaveBeenCalled()
  })

  it('stays silent for successful runs and for runs that were cancelled or recovered', async () => {
    const { submit, notify } = notifier()
    await notify({ run: run({ status: 'completed', lastError: undefined }), cause: 'executed' })
    await notify({ run: run(), cause: 'rejected' })
    await notify({ run: run(), cause: 'recovered' })
    expect(submit).not.toHaveBeenCalled()
  })

  it('stays silent when no readable task name exists, instead of inventing one', async () => {
    const { submit, notify } = notifier({ taskNameSnapshot: () => undefined })
    await notify({ run: run(), cause: 'executed' })
    expect(submit).not.toHaveBeenCalled()
  })

  it('stays silent when the ledger has nothing to count (never guesses a streak)', async () => {
    const { submit, notify } = notifier({ runs: [] })
    await notify({ run: run(), cause: 'executed' })
    expect(submit).not.toHaveBeenCalled()
  })

  it('keeps the raw error out of the upgrade notification', async () => {
    const { submit, notify } = notifier()
    await notify({ run: run({ lastError: `upstream returned 503 ${'x'.repeat(500)}` }), cause: 'executed' })
    const request = submit.mock.calls[0]?.[0] as NotificationSubmitRequest
    expect(request.reasonParams).toBeUndefined()
    expect(JSON.stringify(request)).not.toContain('503')
  })
})
