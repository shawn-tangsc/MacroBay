import type { NewsSentimentView } from '../news-sentiment/newsSentimentQuery'
import type { NewsSentimentQuery } from '../schema/newsSentiment'
import {
  detectDivergences,
  shouldEscalate,
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

export async function queryMarketDivergenceAsync(input: Readonly<{
  asOf: string
  read: DivergenceLegReader
  /**
   * `auto` asks the model only when the rules found at least one divergence — there is nothing to
   * explain otherwise, and a quiet day must not cost a request every time the dashboard opens.
   * `manual` is the reader pressing "AI 复核": they asked, so it runs even on a quiet day.
   */
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
    const result = detectDivergences(legs)
    if (result.state === 'unavailable') return result
    // The card publishes the rule answer; the flag is what hands an unusual reading to the page's
    // written analysis, which is the only place a model belongs in this flow.
    const escalated = shouldEscalate(legs, result)
    const withFlag = { ...result, escalated }
    return isWithinUtf8JsonBudget(withFlag, divergencePolicy.maximumDtoBytes) ? withFlag : divergenceUnavailable('too-large', missing)
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
