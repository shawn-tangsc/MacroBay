import type { DailyBriefingDocument, DailyBriefingReadingState } from '../../../contracts/dailyBriefing'
import type { DailyBriefDataGap } from './dailyBriefAgentTurn'
import { isDailyBriefBackfillMetric } from '../public-query/dailyBriefBackfill'

/**
 * Reading gaps a finished document cannot fill.
 *
 * Every gap names its source, metric, state and reason, and whether a backfill may ask for it again.
 * It is a pure read of the document — no prompt, no agent, no clock — which is why it lives on its
 * own rather than inside the turn that happens to need it.
 */
const MARKET_GAP_METRICS: Readonly<Record<string, readonly [string, string]>> = Object.freeze({
  dxy: Object.freeze(['dxy', 'dxy-level'] as const),
  gold: Object.freeze(['gold', 'gold-level-usd'] as const),
  us10y: Object.freeze(['treasury', 'us10y-yield-percent'] as const),
  'us10y-real': Object.freeze(['treasury', 'us10y-real-yield-percent'] as const)
})

const FUNDS_GAP_METRICS: Readonly<Record<string, readonly [string, string]>> = Object.freeze({
  stablecoin: Object.freeze(['stablecoin', 'core-stablecoin-supply-usd'] as const),
  'etf-btc': Object.freeze(['etf', 'etf-net-flow-btc'] as const),
  'etf-eth': Object.freeze(['etf', 'etf-net-flow-eth'] as const),
  'funding-btc': Object.freeze(['funding', 'funding-rate-percent-btc'] as const),
  'funding-eth': Object.freeze(['funding', 'funding-rate-percent-eth'] as const)
})

export function collectDataGaps(document: DailyBriefingDocument): readonly DailyBriefDataGap[] {
  const asOf = document.edition.windowEnd
  const gaps = new Map<string, DailyBriefDataGap>()
  const add = (source: string, metric: string, state: DailyBriefingReadingState, reason: string): void => {
    if (!isDailyBriefBackfillMetric(source, metric)) return
    const id = `${source}:${metric}`
    if (gaps.has(id)) return
    gaps.set(id, Object.freeze({ id, source, metric, asOf, state, reason, requestable: state !== 'source-disabled' }))
  }
  for (const row of document.data.market) {
    if (row.state === 'available') continue
    const pair = MARKET_GAP_METRICS[row.id]
    if (pair) add(pair[0], pair[1], row.state, row.reason ?? row.state)
  }
  for (const row of document.data.funds) {
    if (row.state === 'available') continue
    const pair = FUNDS_GAP_METRICS[row.id]
    if (pair) add(pair[0], pair[1], row.state, row.reason ?? row.state)
  }
  const leverage = document.data.leverage
  if (!leverage || leverage.state !== 'available') {
    const state: DailyBriefingReadingState = leverage?.state ?? 'unavailable'
    add('open-interest', 'open-interest-usd-btc', state, 'open-interest row missing')
    add('open-interest', 'open-interest-usd-eth', state, 'open-interest row missing')
  }
  return Object.freeze([...gaps.values()])
}
