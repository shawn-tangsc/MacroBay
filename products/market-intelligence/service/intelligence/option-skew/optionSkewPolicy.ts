/**
 * The one place the option-skew 口径 lives: target tenor, the 25Δ target, the deep-out-of-the-money
 * filters, retention. The card's ⓘ sentence is written from this file, and `sentimentOptionsCardPolicy`
 * reads the tenor from here — no second copy of "30".
 */

import { OPTION_SKEW_COLLECT_JOB_ID } from './optionSkewJobId'

export const optionSkewPolicy = {
  sourceId: 'deribit-options',
  productId: 'market-intelligence',
  jobId: OPTION_SKEW_COLLECT_JOB_ID,
  /** One round an hour, 2 requests per round: 48 requests a day, far below the public limit. */
  intervalMs: 60 * 60_000,
  /** The venue's public JSON API. Requests go through the platform's proxy-aware adapter, never direct. */
  baseUrl: 'https://www.deribit.com/api/v2/public',
  currency: 'BTC',
  /** Fixed tenor: the reader compares one number across days, so the tenor may not drift. */
  targetTenorDays: 30,
  /** Less than two days to expiry: gamma and near-zero time value distort implied vol. */
  minimumTenorDays: 2,
  /** The delta the two legs are read at (|Δ| = 0.25, put and call). */
  targetDelta: 0.25,
  /** A day bucket per UTC day; 400 days ≈ 60 KB, and the card's percentile needs a year. */
  retentionDays: 400,
  filters: {
    /** A contract nobody holds is not a market price. */
    minimumOpenInterestExclusive: 0,
    /** Both sides quoted: a deep wing with one side at zero is not tradeable. */
    minimumQuotedPrice: 0,
    /** Deep wings are excluded before interpolation. */
    minimumAbsDelta: 0.05,
    maximumAbsDelta: 0.95,
    /** Extreme strikes may not take part in the interpolation. */
    minimumStrikeToForward: 0.5,
    maximumStrikeToForward: 2
  }
} as const

export type OptionSkewFailureCode = 'upstream-shape-invalid' | 'no-bracketing-expiry'

/** One listed contract, normalized off the wire. Times are epoch milliseconds. */
export type DeribitOptionInstrument = Readonly<{
  instrumentName: string
  expiryMs: number
  strike: number
  optionType: 'call' | 'put'
}>

/** One contract's summary, normalized off the wire. `markIv` is a percentage (58.4 = 58.4%). */
export type DeribitOptionQuote = Readonly<{
  instrumentName: string
  markIv: number
  bidPrice: number
  askPrice: number
  openInterest: number
  underlyingPrice?: number
}>

/** One stored day. `day` is the UTC day of `observedAt`; a later read on the same day replaces it. */
export type OptionSkewPoint = Readonly<{
  day: string
  observedAt: string
  riskReversal: number
  putIv25: number
  callIv25: number
  tenorDays: 30
  expiries: readonly [string, string]
  underlyingPrice: number
}>

export type OptionSkewStoreState = Readonly<{
  schemaVersion: 1
  points: readonly OptionSkewPoint[]
  lastAttemptAt?: string
  lastSuccessAt?: string
  lastFailureCode?: string
  consecutiveFailures: number
}>

export const EMPTY_OPTION_SKEW_STORE: OptionSkewStoreState = Object.freeze({
  schemaVersion: 1 as const,
  points: Object.freeze([]) as readonly OptionSkewPoint[],
  consecutiveFailures: 0
})

/** Percent with one decimal: the unit the card prints, so rounding happens once, at the source. */
export function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}

export function utcDayOf(instant: string): string {
  return instant.slice(0, 10)
}

export function tenorInYears(milliseconds: number): number {
  return milliseconds / (365 * 24 * 60 * 60 * 1000)
}

/** Total variance between now and expiry, used to move a leg's vol onto the 30-day tenor. */
export function totalVariance(volPercent: number, tenorYears: number): number {
  const sigma = volPercent / 100
  return sigma * sigma * tenorYears
}