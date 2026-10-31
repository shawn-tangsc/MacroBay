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
  sentiment: () => Promise<Readonly<{ bearishSharePercent: number; scoredCount: number; observedAt: string }> | undefined>
}>

export async function queryMarketDivergenceAsync(input: Readonly<{
  asOf: string
  read: DivergenceLegReader
}>): Promise<MarketDivergenceResult> {
  if (!isCanonicalDivergenceTime(input.asOf)) return divergenceUnavailable()
  try {
    // Every leg is attempted: one that fails must show up as `withheld` with its own name, not
    // take the other two pairs down with it.
    const [stablecoin, etf, openInterest, funding, price, sentiment] = await Promise.all([
      safe(input.read.stablecoin), safe(input.read.etf), safe(input.read.openInterest),
      safe(input.read.funding), safe(input.read.price), safe(input.read.sentiment)
    ])
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
    return isWithinUtf8JsonBudget(result, divergencePolicy.maximumDtoBytes) ? result : divergenceUnavailable()
  } catch {
    return divergenceUnavailable()
  }
}

/**
 * Turns the scored headline view into the one number the pair needs.
 *
 * `directionalCount` excludes neutral items on purpose: "most of what was said was bearish" is a
 * statement about the headlines that took a side, not about the volume of coverage.
 */
export function bearishShare(view: NewsSentimentView): Readonly<{ bearishSharePercent: number; scoredCount: number; observedAt: string }> | undefined {
  if (view.state !== 'available' || !view.summary) return undefined
  const directional = view.summary.directionalCount
  const bearish = view.items.filter(item => item.polarity === 'bearish').length
  if (directional <= 0 || bearish <= 0) return undefined
  return {
    bearishSharePercent: Math.round((bearish / directional) * 100),
    scoredCount: directional,
    observedAt: view.summary.latestItemAt ?? view.generatedAt
  }
}

async function safe<T>(read: () => Promise<T | undefined>): Promise<T | undefined> {
  try { return await read() } catch { return undefined }
}
