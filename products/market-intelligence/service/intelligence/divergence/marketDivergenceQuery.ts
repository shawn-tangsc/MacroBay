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
   *
   * Three outcomes, never one `undefined`: a reading (0% included — the headlines took a side and
   * none of them was bearish), a read that found nothing to score, and a read that failed. The
   * card says "today is quiet" for the second and "today I do not know" for the third, so a single
   * absent value cannot carry both.
   */
  sentiment: () => Promise<DivergenceSentimentLeg>
}>

/** What the sentiment leg answered. `empty` is a fact about the day; `unavailable` is about us. */
export type DivergenceSentimentLeg =
  | Readonly<{ state: 'available'; bearishSharePercent: number; scoredCount: number; observedAt: string; headlines?: readonly string[] }>
  | Readonly<{ state: 'empty'; reason: 'no-scored-items' }>
  | Readonly<{ state: 'unavailable' }>

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
    // take the other two pairs down with it. A leg that threw is recorded apart from one that
    // answered nothing, because the card has to say which of the two happened.
    const missing: Array<import('../../../contracts/marketDivergence').DivergenceLegId> = []
    const faulted: Array<import('../../../contracts/marketDivergence').DivergenceLegId> = []
    const read = async <T>(id: import('../../../contracts/marketDivergence').DivergenceLegId, fn: () => Promise<T | undefined>) => {
      try {
        const value = await fn()
        if (!value) missing.push(id)
        return value
      } catch (error) {
        faulted.push(id)
        console.error(`[divergence] leg ${id} threw:`, error instanceof Error ? `${error.name}: ${error.message}` : String(error))
        return undefined
      }
    }
    // The sentiment leg answers in three states, so it is folded here rather than through `read`:
    // "nothing worth scoring" is a quiet day, "could not read" is a fault, and only the second is
    // allowed to read as a missing reading.
    const readSentiment = async (): Promise<DivergenceInputs['sentiment']> => {
      try {
        const leg = await input.read.sentiment()
        if (leg.state === 'available') {
          return {
            bearishSharePercent: leg.bearishSharePercent, scoredCount: leg.scoredCount, observedAt: leg.observedAt,
            ...(leg.headlines ? { headlines: leg.headlines } : {})
          }
        }
        if (leg.state === 'unavailable') faulted.push('sentiment')
        else missing.push('sentiment')
        return undefined
      } catch (error) {
        faulted.push('sentiment')
        console.error('[divergence] leg sentiment threw:', error instanceof Error ? `${error.name}: ${error.message}` : String(error))
        return undefined
      }
    }
    const [stablecoin, etf, openInterest, funding, price, sentiment] = await Promise.all([
      read('stablecoin', input.read.stablecoin), read('etf', input.read.etf), read('open-interest', input.read.openInterest),
      read('funding', input.read.funding), read('price', input.read.price), readSentiment()
    ])
    if (missing.length + faulted.length === 6) return divergenceUnavailable('all-legs-missing', [...missing, ...faulted])
    const legs: DivergenceInputs = {
      asOf: input.asOf,
      ...(stablecoin ? { stablecoin } : {}),
      ...(etf ? { etf } : {}),
      ...(openInterest ? { openInterest } : {}),
      ...(funding ? { funding } : {}),
      ...(price ? { price } : {}),
      ...(sentiment ? { sentiment } : {}),
      ...(faulted.length > 0 ? { faulted } : {})
    }
    const result = detectDivergences(legs)
    if (result.state === 'unavailable') return result
    // The card publishes the rule answer; the flag is what hands an unusual reading to the page's
    // written analysis, which is the only place a model belongs in this flow.
    const escalated = shouldEscalate(legs, result)
    const withFlag = { ...result, escalated }
    return isWithinUtf8JsonBudget(withFlag, divergencePolicy.maximumDtoBytes) ? withFlag : divergenceUnavailable('too-large', missing)
  } catch (error) {
    // One line, no credentials: a thrown read is a fault, and silence about it cost a day.
    console.error('[divergence] query threw:', error instanceof Error ? `${error.name}: ${error.message}` : String(error))
    return divergenceUnavailable('query-failed')
  }
}

/**
 * Turns the scored headline view into the one number the pair needs.
 *
 * `directionalCount` excludes neutral items on purpose: "most of what was said was bearish" is a
 * statement about the headlines that took a side, not about the volume of coverage.
 *
 * That denominator also decides whether a share may exist at all. With no headline taking a side
 * there is no share to publish — writing 0% would turn "nobody was scored" into "nobody is
 * bearish", which is a conclusion the day does not support.
 */
export function readSentimentLeg(view: NewsSentimentView): DivergenceSentimentLeg {
  // A read that succeeded but found nothing in its window is a quiet day, not a fault. Only a read
  // that failed, or one whose shape cannot yield a share at all, is allowed to call itself unknown.
  if (view.state === 'unavailable') return { state: 'unavailable' }
  if (view.state === 'empty') return { state: 'empty', reason: 'no-scored-items' }
  if (!view.summary) return { state: 'unavailable' }
  const directional = view.summary.directionalCount
  if (directional <= 0) return { state: 'empty', reason: 'no-scored-items' }
  const bearishItems = view.items.filter(item => item.polarity === 'bearish')
  // The titles travel with the share: a judge that only knows "72% bearish" can write a number,
  // not a sentence about what the market was actually told.
  const headlines = bearishItems
    .slice()
    .sort((left, right) => (right.publishedAt ?? '').localeCompare(left.publishedAt ?? ''))
    .slice(0, 3)
    .map(item => item.title.trim().slice(0, 90))
    .filter(title => title.length > 0)
  return {
    state: 'available',
    bearishSharePercent: Math.round((bearishItems.length / directional) * 100),
    scoredCount: directional,
    observedAt: view.summary.latestItemAt ?? view.generatedAt,
    headlines
  }
}

/** Newest N sessions, oldest first: the ETF leg is a window sum, not a single day. */
function lastSessions(rows: readonly Readonly<{ tradingDate: string; netFlowUsd: number }>[], count: number) {
  return [...rows]
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.tradingDate) && Number.isFinite(row.netFlowUsd))
    .sort((left, right) => left.tradingDate.localeCompare(right.tradingDate))
    .slice(-count)
}
