/**
 * The expected difference between what a market release printed and what the market expected.
 *
 * This is the only implementation of comparability, direction, magnitude, the display choice and
 * the trigger threshold. It is a pure contract module with no Node dependency because both the
 * main process (analysis facts, the release trigger) and the renderer (calendar card, inspectors)
 * read it. `marketCalendarObservationNormalization.ts` depends on `node:crypto` and therefore
 * cannot be the owner.
 *
 * Provider values are display strings that never passed unit admission: `250K`, `1.2M` and ranges
 * are deliberately not compared, because guessing a unit would invent a number.
 */
export const marketCalendarSurprisePolicy = Object.freeze({
  /** Signed decimal or percent only; everything else is `not-comparable`. */
  comparableValuePattern: /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/,
  percentSuffix: '%',
  /** No unit admission means no numeric tolerance: equality is `inline`. */
  inlineToleranceAbsolute: 0,
  /** The release trigger: percent values by percentage points, bare numbers by relative distance. */
  trigger: Object.freeze({ percentPoints: 0.2, relativeFraction: 0.05 })
} as const)

export type MarketCalendarSurpriseReason =
  | 'missing-actual'
  | 'missing-consensus'
  | 'unit-mismatch'
  | 'non-numeric'

export type MarketCalendarSurpriseAssessment = Readonly<{
  direction: 'beat' | 'miss' | 'inline' | 'not-comparable'
  /** Actual − expectation; `null` when the pair cannot be compared. */
  absoluteDifference: number | null
  /** (Actual − expectation) / |expectation| × 100; `null` when incomparable or expectation is 0. */
  relativeDifferencePercent: number | null
  /** Which number a reader should see: percentage points, relative deviation, or neither. */
  presentation: Readonly<{ unit: 'pp' | 'relative-percent'; value: number }> | null
  reason: MarketCalendarSurpriseReason | null
}>

type CalendarValue = Readonly<{ displayValue: string }>

/**
 * Judges one released value against its expectation.
 *
 * The direction is always decided when both values are comparable, even when no displayable
 * magnitude exists (a bare-number expectation of `0` has no relative denominator). The caller
 * decides separately whether it may state a number.
 */
export function assessMarketCalendarSurprise(
  actual: CalendarValue | null | undefined,
  consensus: CalendarValue | null | undefined
): MarketCalendarSurpriseAssessment {
  if (!actual) return assessment('not-comparable', null, null, null, 'missing-actual')
  if (!consensus) return assessment('not-comparable', null, null, null, 'missing-consensus')

  const left = comparableValue(actual)
  const right = comparableValue(consensus)
  if (!left || !right) return assessment('not-comparable', null, null, null, 'non-numeric')
  if (left.suffix !== right.suffix) return assessment('not-comparable', null, null, null, 'unit-mismatch')

  const difference = left.magnitude - right.magnitude
  const relativePercent = right.magnitude === 0 ? null : difference / Math.abs(right.magnitude) * 100
  const direction = Math.abs(difference) <= marketCalendarSurprisePolicy.inlineToleranceAbsolute
    ? 'inline'
    : difference > 0 ? 'beat' : 'miss'
  const presentation = left.suffix === marketCalendarSurprisePolicy.percentSuffix
    ? { unit: 'pp' as const, value: difference }
    : relativePercent === null ? null : { unit: 'relative-percent' as const, value: relativePercent }
  return assessment(direction, difference, relativePercent, presentation, null)
}

/**
 * The calendar view's enum. It has four values on purpose: "no expectation" and "cannot compare"
 * share `consensus-unavailable`, and the reason above tells the surfaces which sentence to print.
 */
export function toCalendarSurpriseView(
  assessmentResult: MarketCalendarSurpriseAssessment
): 'beat' | 'miss' | 'inline' | 'consensus-unavailable' {
  return assessmentResult.direction === 'not-comparable' ? 'consensus-unavailable' : assessmentResult.direction
}

/**
 * Whether the release crossed the trigger threshold.
 *
 * `inline` never triggers, and a bare-number expectation of `0` has no relative magnitude, so it
 * cannot trigger either. The threshold itself lives in `policy.trigger`.
 */
export function exceedsSurpriseTrigger(assessmentResult: MarketCalendarSurpriseAssessment): boolean {
  if (assessmentResult.direction !== 'beat' && assessmentResult.direction !== 'miss') return false
  if (assessmentResult.presentation?.unit === 'pp') {
    return Math.abs(assessmentResult.absoluteDifference ?? 0) >= marketCalendarSurprisePolicy.trigger.percentPoints
  }
  if (assessmentResult.presentation?.unit === 'relative-percent') {
    return assessmentResult.relativeDifferencePercent !== null &&
      Math.abs(assessmentResult.relativeDifferencePercent) >= marketCalendarSurprisePolicy.trigger.relativeFraction * 100
  }
  return false
}

function comparableValue(value: CalendarValue): Readonly<{ magnitude: number; suffix: string }> | undefined {
  const text = value.displayValue.trim()
  const suffix = text.endsWith(marketCalendarSurprisePolicy.percentSuffix) ? marketCalendarSurprisePolicy.percentSuffix : ''
  const digits = suffix ? text.slice(0, -suffix.length) : text
  if (!marketCalendarSurprisePolicy.comparableValuePattern.test(digits)) return undefined
  const magnitude = Number(digits)
  return Number.isFinite(magnitude) ? { magnitude, suffix } : undefined
}

function assessment(
  direction: MarketCalendarSurpriseAssessment['direction'],
  absoluteDifference: number | null,
  relativeDifferencePercent: number | null,
  presentation: MarketCalendarSurpriseAssessment['presentation'],
  reason: MarketCalendarSurpriseReason | null
): MarketCalendarSurpriseAssessment {
  return Object.freeze({
    direction,
    absoluteDifference,
    relativeDifferencePercent,
    presentation: presentation ? Object.freeze(presentation) : null,
    reason
  })
}
