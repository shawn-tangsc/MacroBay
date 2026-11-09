import { describe, expect, it, vi } from 'vitest'

import type { EventGroup } from '../../../contracts/marketAnalysisContracts'
import { countAnalysisRuns } from '../analysis/analysisRunCounter'
import { createSignalAnalysisRequest, type SignalAnalysisRequest } from '../jobs/requestSignalAnalysis'
import { signalTriggerKey } from '../../../contracts/moduleSignal'
import { buildEtfOutflowSignal } from './etfOutflowSignal'
import { etfOutflowSignalHandoff } from './etfOutflowSignalHandoff'
import { createSignalScanRunner } from './signalScanRunner'

// 判定的那一刻：三日都静置满一天（10-28 也要到 10-29 之后才算定稿）。
const readingAt = '2026-10-30T12:00:00.000Z'

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
  // 交接点只剩通知：分析的唯一入口是十五分钟扫描（两个入口会让「什么时候叫」有两个答案）。
  it('notifies and leaves the analysis to the tick scan', async () => {
    const submit = vi.fn(async () => ({ kind: 'accepted' as const, recordId: 'record-1', levels: [], suppressedLevels: [] }))

    await etfOutflowSignalHandoff(submit).handOffSignals(outflowSignals())

    expect(submit).toHaveBeenCalledTimes(2)
  })

  it('still works without a notification port, and never throws into the refresh result', async () => {
    await expect(etfOutflowSignalHandoff(undefined).handOffSignals(outflowSignals())).resolves.toBeUndefined()
  })
})

describe('ETF signal → the scan, end to end', () => {
  // 判据（架构师）：造一条信号 → 接收端收到该触发键 → 一次 queued 行 → 计数落在 event 线。
  it('writes one queued ledger row on the event line, and none on the calendar line', async () => {
    const groups = new Map<string, EventGroup>()
    const ledger: { id: string; eventGroupId: string; triggerKey: string; changeHash: string; decision: string; reasonCode: string; snapshotHash: string | null; analysisRunId: string | null; createdAt: string; evidenceJson: string | null }[] = []
    const repository = {
      appendEventGroup: (group: EventGroup) => { groups.set(group.id, group) },
      findEventGroupByMergeKey: (mergeKey: string) => [...groups.values()].find(group => group.mergeKey === mergeKey),
      listEventGroups: () => [...groups.values()],
      listRuns: () => [] as readonly unknown[],
      // 信号入口的写入形状（`appendSignalTrigger`）：同键插不进去就返回那一行，让接收端自己判
      // 「已存在」还是「上次入队失败、可以重来」。
      //
      // 这里不能只留 `appendTriggerLedger`——那是条目线的写法，接收端根本不调它。调不到时异常会被
      // 交接层的「入队失败不升级成采集失败」吞掉，台账空着，用例只看到「0 行」，看起来像产品缺陷。
      appendSignalTrigger: (value: { id: string; eventGroupId: string; triggerKey: string; changeHash: string; reasonCode: string; evidence?: unknown; createdAt: string }) => {
        const existing = ledger.find(row => row.eventGroupId === value.eventGroupId && row.triggerKey === value.triggerKey && row.changeHash === value.changeHash)
        if (existing) return { id: existing.id, created: false, previous: { decision: existing.decision, reasonCode: existing.reasonCode } }
        // 与仓储同形：读数随行落成 JSON，读端拿到的就是判定当时的快照。
        ledger.push({
          ...value,
          decision: 'queued',
          snapshotHash: null,
          analysisRunId: null,
          evidenceJson: value.evidence ? JSON.stringify(value.evidence) : null
        })
        return { id: value.id, created: true, previous: null }
      },
      rewriteSignalTrigger: (rowId: string, value: { decision: string; reasonCode: string; evidence: unknown }) => {
        const row = ledger.find(entry => entry.id === rowId)
        if (!row) throw new Error('signal-trigger-rewrite-refused')
        Object.assign(row, { decision: value.decision, reasonCode: value.reasonCode, evidenceJson: JSON.stringify(value.evidence) })
      },
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

    // 接收端对每条请求的答复记下来：台账空着时，红的那一句要能说出「哪道门拒了」，
    // 而不是只说「0 行」——`disabled`、`in-flight`、`duplicate` 三种拒绝长得一模一样。
    const answers: string[] = []
    const recorded = async (request: Parameters<typeof analyze>[0]) => {
      const result = await analyze(request)
      answers.push(result.state)
      return result
    }
    const runScan = createSignalScanRunner({
      now: () => readingAt,
      querySignals: async () => [{ signal: outflowSignals()[0]!, window: { unit: 'trading-days' as const, amount: 3, upperBoundMs: null } }],
      requestAnalysis: recorded,
      log: async () => undefined
    })
    await runScan()

    expect(answers).toEqual(['queued'])
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({
      triggerKey: 'signal.etf-flows.etf-outflow-3d',
      decision: 'queued',
      reasonCode: 'signal-medium-triggered',
      // 信号是对已有判断的修正，不是首篇：用它，同组第二次才不会被 `analysis-already-available` 挡住。
      changeHash: 'etf-flows:etf-outflow-3d:btc:2026-10-28'
    })
    expect(enqueued[0]).toMatchObject({ payload: { triggerKey: 'signal.etf-flows.etf-outflow-3d', analysisPhase: 'correction', asOf: '2026-10-28T00:00:00.000Z' } })

    // 架构师那条判据：行上必须带判定当时的读数，否则横条与详情都能空着还不报错。
    expect(ledger[0]!.evidenceJson).not.toBeNull()
    const evidence = JSON.parse(ledger[0]!.evidenceJson!) as { signalCount: number; signals: Record<string, unknown>[] }
    expect(evidence.signalCount).toBe(1)
    expect(Object.keys(evidence.signals[0]!).sort()).toEqual(['asset', 'moduleId', 'observedAt', 'ruleId', 'severity', 'values', 'window'])
    expect(evidence.signals[0]).toMatchObject({
      moduleId: 'etf-flows', ruleId: 'etf-outflow-3d', asset: 'btc', severity: 'medium',
      observedAt: '2026-10-28T00:00:00.000Z', window: { unit: 'trading-days', amount: 3, upperBoundMs: null },
      values: { cumulativeNetFlowUsd: -150_000_000, coveredDays: 3, requiredDays: 3, thresholdUsd: -100_000_000 }
    })

    const counts = countAnalysisRuns(repository as never, readingAt)
    expect(counts.eventRunsToday).toBe(1)
    expect(counts.calendarRunsToday).toBe(0)
  })
})
