import { describe, expect, it } from 'vitest'

import { createMarketCalendarBriefingRefresh, MARKET_CALENDAR_BRIEFING_CATCH_UP_CEILING_MS }
  from './macroCalendarBriefingCatchUp'

const DEFINITION = 'market-intelligence.refreshNarwhalCalendarTick.automatic'

/**
 * 日报补跑的判据：**排上了不等于采到了**。
 *
 * 先前的实现排完作业就回「已完成」，日报只认四种结果，认不出就写「采集失败」——于是每一版
 * 都写那四个字，与真实结果无关。这里钉住四件事：等结果、超时上限、数据有没有真的变、抛错算失败。
 */
function harness(input: Readonly<{
  writes?: (string | null)[]
  wait?: { state: 'timeout' } | { state: 'interrupted' } | { state: 'terminal'; status: string; lastError?: string }
  enqueueThrows?: boolean
  waitThrows?: boolean
}>) {
  const writes = [...(input.writes ?? [])]
  const calls: { waited: { runId: string; timeoutMs?: number } | undefined; enqueued: string[] } = {
    waited: undefined, enqueued: []
  }
  const refresh = createMarketCalendarBriefingRefresh({
    definitionId: DEFINITION,
    readLastWrittenAt: () => writes.length > 0 ? writes.shift()! : null,
    jobRuntime: {
      enqueueManual: async (definitionId) => {
        calls.enqueued.push(definitionId)
        if (input.enqueueThrows === true) throw new Error('queue-full')
        return { id: 'run-1' }
      },
      waitForRunTerminal: async (runId, options) => {
        calls.waited = { runId, ...(options === undefined ? {} : { timeoutMs: options.timeoutMs }) }
        if (input.waitThrows === true) throw new Error('job-store-unavailable')
        const settled = input.wait ?? { state: 'terminal' as const, status: 'completed' }
        return settled.state === 'terminal'
          ? { state: 'terminal' as const, run: { status: settled.status, ...(settled.lastError === undefined ? {} : { lastError: settled.lastError }) } }
          : settled
      }
    }
  })
  return { refresh, calls }
}

describe('日报补跑：排上作业后等结果', () => {
  it('等到完成且数据真的变了 → collected，并带上这次补跑覆盖的 feed', async () => {
    const { refresh, calls } = harness({ writes: ['2026-11-14T04:00:00.000Z', '2026-11-14T05:00:00.000Z'] })
    const verdict = await refresh({ timeoutMs: 90_000, sourceIds: ['macro-calendar-narwhal-economic-data'] })
    expect(verdict).toEqual({ state: 'collected', sources: ['macro-calendar-narwhal-economic-data'] })
    expect(calls.enqueued).toEqual([DEFINITION])
    expect(calls.waited?.runId).toBe('run-1')
  })

  it('作业完成但数据没动 → unchanged（「跑过了」不等于「有新数据」）', async () => {
    const { refresh } = harness({ writes: ['2026-11-14T04:00:00.000Z', '2026-11-14T04:00:00.000Z'] })
    expect(await refresh({ timeoutMs: 90_000 })).toEqual({ state: 'unchanged' })
  })

  it('等待最多 20 秒：调用方给 90 秒也只等 20 秒，超时按「超时」回答而不是「失败」', async () => {
    const { refresh, calls } = harness({ writes: [null], wait: { state: 'timeout' } })
    const verdict = await refresh({ timeoutMs: 90_000 })
    expect(calls.waited?.timeoutMs).toBe(MARKET_CALENDAR_BRIEFING_CATCH_UP_CEILING_MS)
    expect(verdict).toEqual({ state: 'timeout', timeoutMs: MARKET_CALENDAR_BRIEFING_CATCH_UP_CEILING_MS })
  })

  it('作业失败、被中断、排不进去、等不到记录——四种都算失败，并带上原因码', async () => {
    const failed = await harness({ writes: [null], wait: { state: 'terminal', status: 'failed', lastError: 'collector-error' } })
      .refresh({ timeoutMs: 20_000 })
    expect(failed).toEqual({ state: 'failed', failureCode: 'collector-error' })
    expect(await harness({ writes: [null], wait: { state: 'interrupted' } }).refresh({ timeoutMs: 20_000 }))
      .toEqual({ state: 'failed', failureCode: 'run-interrupted' })
    expect(await harness({ writes: [null], enqueueThrows: true }).refresh({ timeoutMs: 20_000 }))
      .toEqual({ state: 'failed', failureCode: 'queue-full' })
    expect(await harness({ writes: [null], waitThrows: true }).refresh({ timeoutMs: 20_000 }))
      .toEqual({ state: 'failed', failureCode: 'job-store-unavailable' })
  })
})
