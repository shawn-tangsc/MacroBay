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

/**
 * The four shapes the policy block takes, derived from the decision instant rather than stored.
 *
 * A reading is read at an instant and means something different on each side of the meeting: two
 * weeks out it is a priced meeting, inside the window it is a countdown, on the day it is a
 * settlement against what was priced, and for three days after it is a verdict. Deriving the shape
 * from the clock keeps it from disagreeing with the reader's calendar.
 */
export type PolicyPathPhase =
  | Readonly<{ kind: 'normal' }>
  | Readonly<{ kind: 'pre-meeting'; daysLeft: number }>
  | Readonly<{ kind: 'settlement'; minutesSinceDecision: number }>
  | Readonly<{ kind: 'verdict'; daysSinceDecision: number }>

export const POLICY_PATH_PHASE_POLICY = Object.freeze({
  /** The block upgrades to the meeting view only inside this many days. */
  preMeetingDays: 14,
  /** The settlement strip stays up for a full day: readers look back the next morning. */
  settlementHours: 24,
  /** How long the verdict stays on the card before the next meeting's normal shape returns. */
  verdictDays: 3
} as const)

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

/**
 * New York's wall clock at an instant, expressed as the offset from UTC in milliseconds.
 *
 * This is looked up from the time zone database rather than assumed: 14:00 in New York is 18:00Z in
 * summer and 19:00Z in winter, and a fixed number would put a whole season's decisions an hour off.
 */
const newYorkClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
})

function newYorkOffsetMs(instantMs: number): number {
  const parts = Object.fromEntries(newYorkClock.formatToParts(new Date(instantMs)).map((part) => [part.type, part.value]))
  const wallClock = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  )
  return wallClock - instantMs
}

/** The decision instant: 14:00 on the meeting day in New York, converted to UTC exactly once. */
export function decisionInstant(meetingDate: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(meetingDate)
  if (!match) return undefined
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const wallClock = Date.UTC(year, month - 1, day, 14, 0, 0)
  // Date.UTC normalises 02-30 and 13-01 into the next month; a meeting date that does not survive
  // the round trip is not a date.
  const calendarDay = new Date(wallClock)
  if (calendarDay.getUTCFullYear() !== year || calendarDay.getUTCMonth() !== month - 1 || calendarDay.getUTCDate() !== day) return undefined
  // Two passes: the first guess lands on the right side of a DST change, the second settles the
  // offset that is actually in force at the converted instant.
  const firstGuess = wallClock - newYorkOffsetMs(wallClock)
  return new Date(wallClock - newYorkOffsetMs(firstGuess)).toISOString()
}

/**
 * Which shape the block takes at `now`. The boundaries belong to the later shape: exactly T0 is a
 * settlement, exactly T0+24h is a verdict, and exactly T0+3d is normal again.
 */
export function phaseAt(decisionAt: string, now: string): PolicyPathPhase {
  const decision = Date.parse(decisionAt)
  const current = Date.parse(now)
  if (!Number.isFinite(decision) || !Number.isFinite(current)) return { kind: 'normal' }
  const elapsed = current - decision
  if (elapsed < 0) {
    return -elapsed <= POLICY_PATH_PHASE_POLICY.preMeetingDays * DAY_MS
      ? { kind: 'pre-meeting', daysLeft: Math.ceil(-elapsed / DAY_MS) }
      : { kind: 'normal' }
  }
  if (elapsed < POLICY_PATH_PHASE_POLICY.settlementHours * 60 * MINUTE_MS) {
    return { kind: 'settlement', minutesSinceDecision: Math.floor(elapsed / MINUTE_MS) }
  }
  if (elapsed < POLICY_PATH_PHASE_POLICY.verdictDays * DAY_MS) {
    return { kind: 'verdict', daysSinceDecision: Math.floor(elapsed / DAY_MS) }
  }
  return { kind: 'normal' }
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
