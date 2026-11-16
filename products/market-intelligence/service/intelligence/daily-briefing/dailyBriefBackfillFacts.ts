import type {
  BriefingMarketRow, BriefingPulseRow, BriefingValueFormat, DailyBriefingDocument
} from '../../../contracts/dailyBriefing'
import type { DailyBriefBackfillResult } from '../public-query/dailyBriefBackfill'

/** 一次补采请求的结果：成功时 `result` 带着取回的值。 */
export type BackfillOutcome = Readonly<{
  source: string
  metric: string
  asOf: string
  result?: DailyBriefBackfillResult
  gapCode?: string
  detail?: string
}>

/**
 * 补回来的数只落在它自己那一格上。
 *
 * 表里的键是后端指标名，值是版面行 id 与展示格式——两边名字不同，所以映射必须在这里写死一次：
 * 让模型挑行就等于让它决定哪个数填哪一格。状态一并从「缺」改成「可用」并记下观测时刻，
 * 否则读者看到的是一格有数字、但仍标着缺数的行。
 */
export function applyBackfillFacts(document: DailyBriefingDocument, outcomes: readonly BackfillOutcome[]): DailyBriefingDocument {
  const metrics: Record<string, { id: string; format: BriefingValueFormat; group: 'market' | 'funds' }> = {
    'core-stablecoin-supply-usd': { id: 'stablecoin', format: 'usd', group: 'funds' },
    'etf-net-flow-btc': { id: 'etf-btc', format: 'usd', group: 'funds' },
    'etf-net-flow-eth': { id: 'etf-eth', format: 'usd', group: 'funds' },
    'funding-rate-percent-btc': { id: 'funding-btc', format: 'percent', group: 'funds' },
    'funding-rate-percent-eth': { id: 'funding-eth', format: 'percent', group: 'funds' },
    'dxy-level': { id: 'dxy', format: 'level', group: 'market' },
    'gold-level-usd': { id: 'gold', format: 'level', group: 'market' },
    'us10y-yield-percent': { id: 'us10y', format: 'percent', group: 'market' },
    'us10y-real-yield-percent': { id: 'us10y-real', format: 'percent', group: 'market' }
  }
  const byId = new Map(outcomes.flatMap((outcome) => outcome.result?.state === 'available' && metrics[outcome.result.metric] ? [[metrics[outcome.result.metric]!.id, outcome.result] as const] : []))
  if (byId.size === 0) return document
  const patch = <T extends BriefingMarketRow | BriefingPulseRow>(row: T): T => {
    const fact = byId.get(row.id)
    if (!fact) return row
    return Object.freeze({ ...row, state: 'available' as const, value: Object.freeze({ number: fact.value, format: metrics[fact.metric]!.format }), observedAt: fact.observedAt, change: null }) as T
  }
  return Object.freeze({
    ...document,
    data: Object.freeze({ ...document.data, market: Object.freeze(document.data.market.map(patch)), funds: Object.freeze(document.data.funds.map(patch)) })
  })
}
