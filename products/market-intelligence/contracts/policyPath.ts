/**
 * The policy path reading: one meeting's official facts plus the market's implied odds for it.
 *
 * Two rules shape this file. The series is the primary data — a single value cannot say whether the
 * market moved — and every value carries the instant it was observed, because these numbers change
 * all day and a value without an as-of is unfalsifiable.
 */

export const POLICY_PATH_OUTCOMES = ['no-change', 'hike-25', 'hike-50-plus', 'cut-25', 'cut-50-plus'] as const
export type PolicyPathOutcome = typeof POLICY_PATH_OUTCOMES[number]

export type PolicyPathDistribution = Readonly<Record<PolicyPathOutcome, number>>

export type PolicyPathQuote = Readonly<{ bid: number; ask: number }>

export type PolicyPathObservation = Readonly<{
  /** When the venue data was read, ISO with milliseconds. */
  at: string
  values: PolicyPathDistribution
  quote?: PolicyPathQuote
}>

/** One SEP release, reduced to the row the policy block reads. */
export type PolicyPathSep = Readonly<{
  /** The meeting that published these projections; the median is only meaningful against it. */
  asOf: string
  medianPath: Readonly<{ y2026?: number; y2027?: number; y2028?: number; y2029?: number; longerRun?: number }>
  rangeCurrentYear?: Readonly<{ low: number; high: number }>
  /** The same-year median from the previous SEP, for "up or down" without a second fetch. */
  previousMedian?: number
  sourceUrl: string
}>

export type PolicyPathStaleness = 'live' | 'delayed' | 'stale' | 'unavailable'

/** Sum drift beyond this share means the payload is not a usable distribution. */
export const POLICY_PATH_SUM_TOLERANCE = 0.005

/** The venue quotes five buckets that should sum to one; overround is a few tenths of a percent. */
export function normalizeOutcomes(raw: Partial<Record<PolicyPathOutcome, number>>): PolicyPathDistribution | undefined {
  const values = POLICY_PATH_OUTCOMES.map((outcome) => raw[outcome])
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) return undefined
  const sum = values.reduce<number>((total, value) => total + (value as number), 0)
  if (!Number.isFinite(sum) || sum <= 0 || Math.abs(sum - 1) > 0.1) return undefined
  const normalized = values.map((value) => (value as number) / sum) as number[]
  return Object.fromEntries(POLICY_PATH_OUTCOMES.map((outcome, index) => [outcome, normalized[index]!])) as PolicyPathDistribution
}

/** Percent-point change, rounded to one decimal so a 0.04pp wobble does not read as movement. */
export function changeInPp(current: number, previous: number): number {
  return Math.round((current - previous) * 1000) / 10
}

/** The most likely bucket, and how likely it is. */
export function leadingOutcome(values: PolicyPathDistribution): { outcome: PolicyPathOutcome; probability: number } {
  return POLICY_PATH_OUTCOMES.reduce((best, outcome) =>
    values[outcome] > best.probability ? { outcome, probability: values[outcome] } : best,
  { outcome: 'no-change' as PolicyPathOutcome, probability: -1 })
}

/**
 * How much of the realised outcome the market had already priced.
 *
 * This is arithmetic about the market, not a judgement about the committee: a hold that was priced
 * at 24% is a large surprise, but calling it "dovish" would assert a motive the data does not carry.
 */
export function verdictOf(pricedShare: number): 'priced' | 'partially-priced' | 'not-priced' {
  if (pricedShare >= 0.6) return 'priced'
  return pricedShare >= 0.3 ? 'partially-priced' : 'not-priced'
}

/** Minutes-old thresholds; a market quote goes stale far faster than a macro release. */
export function stalenessOf(asOf: string, now: string): PolicyPathStaleness {
  const observed = Date.parse(asOf)
  const current = Date.parse(now)
  if (!Number.isFinite(observed) || !Number.isFinite(current)) return 'unavailable'
  const minutes = (current - observed) / 60_000
  if (minutes < -5) return 'unavailable'
  if (minutes <= 15) return 'live'
  if (minutes <= 120) return 'delayed'
  if (minutes <= 7 * 24 * 60) return 'stale'
  return 'unavailable'
}

/** Oldest-to-newest, thinned to at most `limit` points, always keeping the last observation. */
export function thinSeries(series: readonly PolicyPathObservation[], limit: number): readonly PolicyPathObservation[] {
  if (limit < 1 || series.length <= limit) return [...series]
  const step = (series.length - 1) / (limit - 1)
  const picked = Array.from({ length: limit }, (_unused, index) => series[Math.round(index * step)]!)
  picked[picked.length - 1] = series[series.length - 1]!
  return [...new Map(picked.map((observation) => [observation.at, observation])).values()]
}

/** The value that was in force `minutes` before the newest observation, if the series reaches back. */
export function valueAtOrBefore(series: readonly PolicyPathObservation[], outcome: PolicyPathOutcome, minutes: number): number | undefined {
  const newest = series.at(-1)
  if (!newest) return undefined
  const target = Date.parse(newest.at) - minutes * 60_000
  let candidate: number | undefined
  for (const observation of series) {
    if (Date.parse(observation.at) <= target) candidate = observation.values[outcome]
    else break
  }
  return candidate
}
