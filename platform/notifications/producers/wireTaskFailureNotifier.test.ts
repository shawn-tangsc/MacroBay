import { describe, expect, it, vi } from 'vitest'

import type { JobRunRecord } from '../../jobs/contracts/jobTypes'
import type { NotificationSubmitRequest } from '../contracts/notificationContracts'
import { wireTaskFailureNotifier } from './wireTaskFailureNotifier'

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
    completedAt: '2026-11-02T01:00:05.000Z',
    lastError: 'upstream returned 503',
    logs: [],
    ...overrides
  }
}

/** 同一任务、新到旧；三次失败正好落在 P2 的阈值上。 */
function failedChain(): JobRunRecord[] {
  return [run({ id: 'run-3' }), run({ id: 'run-2' }), run({ id: 'run-1' })]
}

/** 等到链路把该发的都发完：submit 之后还有 then / catch 几跳，microtask 计数不可靠。 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function wire(submit: (request: NotificationSubmitRequest) => Promise<unknown>) {
  return wireTaskFailureNotifier({
    submit,
    listDefinitions: () => [{ id: 'definition-1', title: '央行利率决议采集' }],
    listDefinitionRuns: () => failedChain(),
    dayToken: (instant) => instant.slice(0, 10)
  })
}

describe('task failure wiring', () => {
  it('submits the upgrade only after the failure record has landed', async () => {
    // runtime 是「读整份 state → 改 → 整份写回」，两条同时提交会互相覆盖，S3 就只剩一条。
    const pending: Array<{ eventTypeId: string; resolve: () => void }> = []
    const submit = vi.fn(
      (request: NotificationSubmitRequest) =>
        new Promise<void>((resolve) => {
          pending.push({ eventTypeId: request.eventTypeId, resolve })
        })
    )

    wire(submit)({ run: run(), cause: 'executed' })
    await flush()

    // 第一条还没落库：第二条必须还没发出，否则两条读到同一份基线。
    expect(pending.map((entry) => entry.eventTypeId)).toEqual(['platform.job.failed-terminal'])

    pending[0]!.resolve()
    await flush()

    expect(pending.map((entry) => entry.eventTypeId)).toEqual([
      'platform.job.failed-terminal',
      'platform.job.repeated-failed'
    ])
  })

  it('still reports the upgrade when the failure record itself could not be submitted', async () => {
    const submit = vi.fn(async (request: NotificationSubmitRequest) => {
      if (request.eventTypeId === 'platform.job.failed-terminal') throw new Error('disk full')
    })

    wire(submit)({ run: run(), cause: 'executed' })
    await flush()

    expect(submit).toHaveBeenCalledTimes(2)
    expect(submit.mock.calls.map((call) => call[0].eventTypeId)).toEqual([
      'platform.job.failed-terminal',
      'platform.job.repeated-failed'
    ])
  })

  it('never lets a throwing notification stop the scheduler', async () => {
    const submit = vi.fn(async () => {
      throw new Error('runtime is not configured')
    })

    expect(() => wire(submit)({ run: run(), cause: 'executed' })).not.toThrow()
    await flush()
  })
})
