import type { OptionSkewDirection } from '../../../contracts/intelligenceQueryContracts'

export const sentimentOptionsCardPolicy = {
  /** Query-side capability kept for later; this version's card always asks for 30. */
  windowDays: [30, 90] as const,
  percentile: { windowDays: 365, minimumBasisDays: 300 },
  direction: {
    points: 5,
    staleAfterDays: 2,
    discontinuousAfterDays: 10,
    deadband: 0.5
  }
} as const

/**
 * The source's own day label. Fear & Greed timestamps are always UTC 00:00 — that is the label of
 * "the reading for this day", not an instant — so it is never converted to a reader timezone.
 * Option-skew days use the snapshot instant's UTC date under the same function.
 */
export function utcDayLabel(instant: string): string {
  return instant.slice(0, 10)
}

/** The reader's today, as a day label. Used only for "how many days ago" comparisons. */
export function localDayLabel(asOf: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(asOf))
  const value = (type: string): string | undefined => parts.find((part) => part.type === type)?.value
  const year = value('year')
  const month = value('month')
  const day = value('day')
  if (!year || !month || !day) throw new Error('sentimentOptions: timezone day parts unavailable')
  return `${year}-${month}-${day}`
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** Whole calendar days between two day labels. Both are labels, so this never depends on a clock. */
export function calendarDaysBetween(earlierDay: string, laterDay: string): number {
  const earlier = Date.parse(`${earlierDay}T00:00:00.000Z`)
  const later = Date.parse(`${laterDay}T00:00:00.000Z`)
  if (!Number.isFinite(earlier) || !Number.isFinite(later)) return Number.NaN
  return Math.round((later - earlier) / 86_400_000)
}

/**
 * The direction of the protection premium over the latest five non-empty days.
 *
 * Order is fixed and does not look at the chart window: a point older than two days cannot speak
 * for "the last five days", fewer than five points cannot either, and five points spread over more
 * than ten days are "the last five days with data", not "the last five days".
 */
export function computeOptionSkewDirection(input: {
  /** Newest first, one point per day, no holes filled. */
  points: ReadonlyArray<{ day: string; riskReversal: number }>
  daysAgo: number
}): OptionSkewDirection {
  if (input.daysAgo > sentimentOptionsCardPolicy.direction.staleAfterDays) return { kind: 'unknown', reason: 'stale' }
  const window = input.points.slice(0, sentimentOptionsCardPolicy.direction.points)
  if (window.length < sentimentOptionsCardPolicy.direction.points) return { kind: 'unknown', reason: 'insufficient' }
  const newest = window[0]!
  const oldest = window[window.length - 1]!
  if (calendarDaysBetween(oldest.day, newest.day) > sentimentOptionsCardPolicy.direction.discontinuousAfterDays) {
    return { kind: 'unknown', reason: 'discontinuous' }
  }
  const delta = newest.riskReversal - oldest.riskReversal
  if (Math.abs(delta) < sentimentOptionsCardPolicy.direction.deadband) return { kind: 'flat' }
  return delta > 0 ? { kind: 'steeper' } : { kind: 'flatter' }
}

/**
 * Where today's score ranks among the past year's daily readings.
 *
 * Only when the window actually holds 300 distinct days: calling 120 days "this year's percentile"
 * would be a lie. Values below today count; today itself does not.
 */
export function computeFearGreedPercentile(input: {
  /** Newest first, one point per day. */
  points: ReadonlyArray<{ day: string; score: number }>
  asOf: string
}): { value: number; basisDays: number; from: string; to: string } | undefined {
  const today = utcDayLabel(input.asOf)
  const startMs = Date.parse(`${today}T00:00:00.000Z`) - sentimentOptionsCardPolicy.percentile.windowDays * 86_400_000
  const fromDay = new Date(startMs).toISOString().slice(0, 10)
  const inWindow = input.points.filter((point) => point.day >= fromDay && point.day <= today)
  if (inWindow.length < sentimentOptionsCardPolicy.percentile.minimumBasisDays) return undefined
  const current = inWindow[0]
  if (!current) return undefined
  const lower = inWindow.filter((point) => point.score < current.score).length
  return {
    value: Math.round((lower / inWindow.length) * 100),
    basisDays: inWindow.length,
    from: inWindow[inWindow.length - 1]!.day,
    to: current.day
  }
}