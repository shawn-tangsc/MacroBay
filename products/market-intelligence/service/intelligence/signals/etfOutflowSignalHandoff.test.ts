import { describe, expect, it, vi } from 'vitest'

import type { EventGroup } from '../../../contracts/marketAnalysisContracts'
import { countAnalysisRuns } from '../analysis/analysisRunCounter'
import { createSignalAnalysisRequest, type SignalAnalysisRequest } from '../jobs/requestSignalAnalysis'
import { buildEtfOutflowSignal } from './etfOutflowSignal'
import { etfOutflowSignalHandoff } from './etfOutflowSignalHandoff'

const readingAt = '2026-10-28T12:00:00.000Z'

function rows(values: readonly number[]) {
  return values.map((netFlowUsd, index) => {
    const tradingDate = `2026-10-${String(26 + index).padStart(2, '0')}`
    return { tradingDate, netFlowUsd, observedAt: `${tradingDate}T00:00:00.000Z` }
  })
}

/** 一条成立的三日净流出（BTC 两天流入、最后一天大跌，三日累计跨过门槛）。 */
function outflowSignals() {
  const btc = buildEtfOutflowSignal({ asset: 'btc', rows: rows([-40_000_000, -50_000_000, -60_000_000]), asOf: readingAt })!
  const eth = buildEtfOutflowSignal({ asset: 'eth', rows: rows([-10_000_000, -40_000_000, -120_000_000]), asOf: readingAt })!
  return [btc, eth]
}

describe('the ETF signal hand-off', () => {
  // 通知与自动分析是两个消费者，同一份信号各交一次；谁都不在交接点重判。
  it('hands the same signals to the notification and to the analysis entry', async () => {
    const submit = vi.fn(async () => ({ kind: 'accepted' as const, recordId: 'record-1', levels: [] }))
    const analyze = vi.fn(async (_request: SignalAnalysisRequest) => ({ state: 'queued' as const, groupId: 'g', attemptLedgerId: 'l', jobRunId: 'j' }))

    await etfOutflowSignalHandoff(submit, () => analyze).handOffSignals(outflowSignals())

    expect(submit).toHaveBeenCalledTimes(2)
    expect(analyze).toHaveBeenCalledTimes(2)
    const keys = analyze.mock.calls.map(([request]) => request.triggerKey)
    expect(new Set(keys)).toEqual(new Set(['signal.etf-flows.etf-outflow-3d']))
  })

  // 刷新服务先于分析运行时建好：入口还没绑定时，通知照发、分析一条都不递，不假装做过。
  it('still notifies while the analysis entry is not bound yet', async () => {
    const submit = vi.fn(async () => ({ kind: 'accepted' as const, recordId: 'record-1', levels: [] }))
    await etfOutflowSignalHandoff(submit, () => undefined).handOffSignals(outflowSignals())
    expect(submit).toHaveBeenCalledTimes(2)
  })

  // 一次入队失败不能把已经写好的行情判成失败：接收端自己把账本行翻成 skipped。
  it('does not let a failed enqueue reach the refresh result', async () => {
    const analyze = vi.fn(async () => { throw new Error('job-runtime-unavailable') })
    await expect(etfOutflowSignalHandoff(undefined, () => analyze).handOffSignals(outflowSignals())).resolves.toBeUndefined()
  })
})

describe('ETF signal → the analysis entry, end to end', () => {
  // 判据（架构师）：造一条信号 → 接收端收到该触发键 → 一次 queued 行 → 计数落在 event 线。
  it('writes one queued ledger row on the event line, and none on the calendar line', async () => {
    const groups = new Map<string, EventGroup>()
    const ledger: { id: string; eventGroupId: string; triggerKey: string; changeHash: string; decision: string; reasonCode: string; snapshotHash: string | null; analysisRunId: string | null; createdAt: string }[] = []
    const repository = {
      appendEventGroup: (group: EventGroup) => { groups.set(group.id, group) },
      findEventGroupByMergeKey: (mergeKey: string) => [...groups.values()].find(group => group.mergeKey === mergeKey),
      listEventGroups: () => [...groups.values()],
      listRuns: () => [] as readonly unknown[],
      appendTriggerLedger: (row: typeof ledger[number]) => { ledger.push(row); return row.id },
      updateTriggerLedgerDecision: (rowId: string, decision: string, reasonCode: string) => {
        const row = ledger.find(entry => entry.id === rowId)
        if (row) Object.assign(row, { decision, reasonCode })
      },
      listTriggerLedger: (eventGroupId: string) => ledger.filter(row => row.eventGroupId === eventGroupId)
    }
    let sequence = 0
    const enqueued: Record<string, unknown>[] = []
    const analyze = createSignalAnalysisRequest({
      repository: repository as never,
      jobRuntime: { enqueueDefinition: async (definition: Record<string, unknown>) => { enqueued.push(definition); return { id: `job-${enqueued.length}` } }, listRuns: () => [] } as never,
      now: () => readingAt,
      idFactory: () => `${++sequence}`,
      isEnabled: async () => true
    })

    await etfOutflowSignalHandoff(undefined, () => analyze).handOffSignals([outflowSignals()[0]!])

    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({
      triggerKey: 'signal.etf-flows.etf-outflow-3d',
      decision: 'queued',
      reasonCode: 'signal-medium-triggered',
      // 信号是对已有判断的修正，不是首篇：用它，同组第二次才不会被 `analysis-already-available` 挡住。
      changeHash: 'etf-flows:etf-outflow-3d:btc:2026-10-28'
    })
    expect(enqueued[0]).toMatchObject({ payload: { triggerKey: 'signal.etf-flows.etf-outflow-3d', analysisPhase: 'correction', asOf: '2026-10-28T00:00:00.000Z' } })

    const counts = countAnalysisRuns(repository as never, readingAt)
    expect(counts.eventRunsToday).toBe(1)
    expect(counts.calendarRunsToday).toBe(0)
  })
})
