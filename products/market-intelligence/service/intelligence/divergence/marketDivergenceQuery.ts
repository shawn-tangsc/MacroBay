import { rowsFromJudgements } from './divergenceJudgementService'
import type { DivergenceJudgementResult } from './divergenceJudgementService'
import type { NewsSentimentView } from '../news-sentiment/newsSentimentQuery'
import type { NewsSentimentQuery } from '../schema/newsSentiment'
import {
  detectDivergences,
  divergencePolicy,
  divergenceUnavailable,
  isCanonicalDivergenceTime,
  type DivergenceInputs,
  type MarketDivergenceResult
} from '../../../contracts/marketDivergence'
import { isWithinUtf8JsonBudget } from '../../../contracts/intelligenceQueryContracts'

/**
 * Reads the legs the dashboard already has and asks the pure rule set what, if anything, the
 * cards disagree about.
 *
 * Nothing is collected here: every leg comes from a query that already exists and already fails
 * closed. This module's only job is to hand those readings to `detectDivergences` with their own
 * instants, so a stale leg is refused instead of being quietly compared with a fresh one.
 */
export type DivergenceLegReader = Readonly<{
  stablecoin: () => Promise<Readonly<{ change7dPercent: number; observedAt: string }> | undefined>
  etf: () => Promise<Readonly<{ rows: readonly Readonly<{ tradingDate: string; netFlowUsd: number }>[] }> | undefined>
  openInterest: () => Promise<Readonly<{ change24hPct: number; observedAt: string }> | undefined>
  funding: () => Promise<Readonly<{ ratePercent: number; observedAt: string }> | undefined>
  price: () => Promise<Readonly<{ return24hPercent: number; observedAt: string }> | undefined>
  /**
   * The share of scored headlines that are bearish in the last 24 hours.
   *
   * Not the sentiment snapshot: its aggregates only exist for market-wide scopes, so an
   * asset-scoped or 24h-labelled read answers `unknown` and the leg silently disappears.
   */
  sentiment: () => Promise<Readonly<{ bearishSharePercent: number; scoredCount: number; observedAt: string; headlines?: readonly string[] }> | undefined>
}>

export type DivergenceJudge = (input: Readonly<{
  asOf: string
  headlines?: readonly string[]
  pairs: readonly Readonly<{ pairId: import('../../../contracts/marketDivergence').DivergencePairId; legs: readonly import('../../../contracts/marketDivergence').DivergenceLeg[]; ruleVerdict: 'divergence' | 'agreement' }>[]
}>) => Promise<import('./divergenceJudgementService').DivergenceJudgementResult>

export async function queryMarketDivergenceAsync(input: Readonly<{
  asOf: string
  read: DivergenceLegReader
  /** The assistant model's reading of the same legs. Absent means the rules answer alone. */
  judge?: DivergenceJudge
  /**
   * `auto` asks the model only when the rules found at least one divergence — there is nothing to
   * explain otherwise, and a quiet day must not cost a request every time the dashboard opens.
   * `manual` is the reader pressing "AI 复核": they asked, so it runs even on a quiet day.
   */
  mode?: 'auto' | 'manual'
}>): Promise<MarketDivergenceResult> {
  if (!isCanonicalDivergenceTime(input.asOf)) return divergenceUnavailable('invalid-clock')
  try {
    // Every leg is attempted: one that fails must show up as `withheld` with its own name, not
    // take the other two pairs down with it.
    const missing: Array<import('../../../contracts/marketDivergence').DivergenceLegId> = []
    const read = async <T>(id: import('../../../contracts/marketDivergence').DivergenceLegId, fn: () => Promise<T | undefined>) => {
      const value = await safe(fn)
      if (!value) missing.push(id)
      return value
    }
    const [stablecoin, etf, openInterest, funding, price, sentiment] = await Promise.all([
      read('stablecoin', input.read.stablecoin), read('etf', input.read.etf), read('open-interest', input.read.openInterest),
      read('funding', input.read.funding), read('price', input.read.price), read('sentiment', input.read.sentiment)
    ])
    if (missing.length === 6) return divergenceUnavailable('all-legs-missing', missing)
    const legs: DivergenceInputs = {
      asOf: input.asOf,
      ...(stablecoin ? { stablecoin } : {}),
      ...(etf ? { etf } : {}),
      ...(openInterest ? { openInterest } : {}),
      ...(funding ? { funding } : {}),
      ...(price ? { price } : {}),
      ...(sentiment ? { sentiment } : {})
    }
    const ruleResult = detectDivergences(legs)
    if (ruleResult.state === 'unavailable') return ruleResult
    const judged = await judgeRows(input, legs, ruleResult)
    return isWithinUtf8JsonBudget(judged, divergencePolicy.maximumDtoBytes) ? judged : divergenceUnavailable('too-large', missing)
  } catch {
    return divergenceUnavailable('query-failed')
  }
}

/**
 * Turns the scored headline view into the one number the pair needs.
 *
 * `directionalCount` excludes neutral items on purpose: "most of what was said was bearish" is a
 * statement about the headlines that took a side, not about the volume of coverage.
 */
export function bearishShare(view: NewsSentimentView): Readonly<{ bearishSharePercent: number; scoredCount: number; observedAt: string; headlines: readonly string[] }> | undefined {
  if (view.state !== 'available' || !view.summary) return undefined
  const directional = view.summary.directionalCount
  const bearishItems = view.items.filter(item => item.polarity === 'bearish')
  if (directional <= 0 || bearishItems.length === 0) return undefined
  // The titles travel with the share: a judge that only knows "72% bearish" can write a number,
  // not a sentence about what the market was actually told.
  const headlines = bearishItems
    .slice()
    .sort((left, right) => (right.publishedAt ?? '').localeCompare(left.publishedAt ?? ''))
    .slice(0, 3)
    .map(item => item.title.trim().slice(0, 90))
    .filter(title => title.length > 0)
  return {
    bearishSharePercent: Math.round((bearishItems.length / directional) * 100),
    scoredCount: directional,
    observedAt: view.summary.latestItemAt ?? view.generatedAt,
    headlines
  }
}

/**
 * Hands the same legs to the model and swaps in its verdict.
 *
 * The rules still decide which pairs exist (their legs) and still answer when the model cannot —
 * a provider that is off must not blank a dashboard. What the model changes is the judgement and
 * the sentence; the readings it was shown are the ones that get drawn.
 */
async function judgeRows(
  input: Readonly<{ asOf: string; judge?: DivergenceJudge; mode?: 'auto' | 'manual' }>,
  legs: DivergenceInputs,
  ruleResult: Exclude<MarketDivergenceResult, { state: 'unavailable' }>
): Promise<MarketDivergenceResult> {
  if (!input.judge) return ruleResult
  // Auto: nothing diverged, so there is no sentence to write. The reader can still ask.
  if ((input.mode ?? 'auto') === 'auto' && ruleResult.state !== 'available') return ruleResult
  const pairs = buildPairs(legs, ruleResult)
  if (pairs.length === 0) return ruleResult
  const outcome = await input.judge({
    asOf: input.asOf,
    pairs,
    ...(legs.sentiment?.headlines?.length ? { headlines: legs.sentiment.headlines } : {})
  })
  if (outcome.state !== 'judged') return ruleResult
  const rows = rowsFromJudgements(outcome.judgements, pairs)
  return rows.length > 0
    ? { state: 'available', asOf: input.asOf, rows, withheld: ruleResult.withheld }
    : { state: 'empty', asOf: input.asOf, withheld: ruleResult.withheld }
}

/** Every pair that has all its legs, plus the rule engine's own verdict as a hint. */
function buildPairs(
  legs: DivergenceInputs,
  ruleResult: Exclude<MarketDivergenceResult, { state: 'unavailable' }>
) {
  const divergent = new Set((ruleResult.state === 'available' ? ruleResult.rows : []).map(row => row.pairId))
  const pairs: Array<{ pairId: import('../../../contracts/marketDivergence').DivergencePairId; legs: readonly import('../../../contracts/marketDivergence').DivergenceLeg[]; ruleVerdict: 'divergence' | 'agreement' }> = []
  if (legs.stablecoin && legs.openInterest && legs.funding) {
    pairs.push({ pairId: 'liquidity-leverage', ruleVerdict: divergent.has('liquidity-leverage') ? 'divergence' : 'agreement', legs: [
      { id: 'stablecoin', value: legs.stablecoin.change7dPercent, unit: 'percent', observedAt: legs.stablecoin.observedAt },
      { id: 'open-interest', value: legs.openInterest.change24hPct, unit: 'percent', observedAt: legs.openInterest.observedAt },
      { id: 'funding', value: legs.funding.ratePercent, unit: 'percent-per-8h', observedAt: legs.funding.observedAt }
    ] })
  }
  const sessions = legs.etf ? lastSessions(legs.etf.rows, divergencePolicy.thresholds.etfWindowSessions) : []
  if (sessions.length === divergencePolicy.thresholds.etfWindowSessions && legs.openInterest && legs.price) {
    const net = sessions.reduce((total, row) => total + row.netFlowUsd, 0)
    pairs.push({ pairId: 'flows-price', ruleVerdict: divergent.has('flows-price') ? 'divergence' : 'agreement', legs: [
      { id: 'etf', value: net, unit: 'usd', observedAt: `${sessions.at(-1)!.tradingDate}T21:00:00.000Z` },
      { id: 'open-interest', value: legs.openInterest.change24hPct, unit: 'percent', observedAt: legs.openInterest.observedAt },
      { id: 'price', value: legs.price.return24hPercent, unit: 'percent', observedAt: legs.price.observedAt }
    ] })
  }
  if (legs.sentiment && legs.price && legs.openInterest) {
    pairs.push({ pairId: 'narrative-price', ruleVerdict: divergent.has('narrative-price') ? 'divergence' : 'agreement', legs: [
      { id: 'sentiment', value: legs.sentiment.bearishSharePercent, unit: 'percent', observedAt: legs.sentiment.observedAt },
      { id: 'price', value: legs.price.return24hPercent, unit: 'percent', observedAt: legs.price.observedAt },
      { id: 'open-interest', value: legs.openInterest.change24hPct, unit: 'percent', observedAt: legs.openInterest.observedAt }
    ] })
  }
  return pairs
}

async function safe<T>(read: () => Promise<T | undefined>): Promise<T | undefined> {
  try { return await read() } catch { return undefined }
}

/** Newest N sessions, oldest first: the ETF leg is a window sum, not a single day. */
function lastSessions(rows: readonly Readonly<{ tradingDate: string; netFlowUsd: number }>[], count: number) {
  return [...rows]
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.tradingDate) && Number.isFinite(row.netFlowUsd))
    .sort((left, right) => left.tradingDate.localeCompare(right.tradingDate))
    .slice(-count)
}
