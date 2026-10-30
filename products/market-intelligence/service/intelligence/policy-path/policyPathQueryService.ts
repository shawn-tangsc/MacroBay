import {
  changeInPp, decisionInstant, leadingOutcome, outcomeFromRangeChange, phaseAt, repricingMarkers,
  settlementConclusion, stalenessOf, thinSeries, valueAtOrBefore,
  type PolicyPathMarker, type PolicyPathObservation, type PolicyPathOutcome, type PolicyPathPhase,
  type PolicyPathSettlement, type PolicyPathStaleness
} from '../../../contracts/policyPath'
import type { MacroEconomicCalendarQueryService } from '../macro-calendar/macroEconomicCalendarQueryService'
import type { PolicyPathFactStore, PolicyPathFacts } from './policyPathFactStore'
import type { PolicyPathObservationStore } from './policyPathObservationStore'

/**
 * Assembles the one reading the block renders.
 *
 * The meeting date comes from the calendar, the official readings from the fact row, and the odds
 * from the observation series. It never fetches: collection is a job, this is a read.
 */
export type PolicyPathReading = Readonly<{
  meetingDate: string
  daysUntilMeeting: number
  hasProjectionMaterials: boolean
  /** The shape the block takes at the instant the reading was asked for. */
  phase: PolicyPathPhase
  /** At most one repricing chip; absent when neither window moved enough to name. */
  markers?: readonly PolicyPathMarker[]
  /** The realised band against the price one hour before the decision; settlement and verdict only. */
  settlement?: PolicyPathSettlement
  targetRange?: Readonly<{ lowerPercent: number; upperPercent: number; source?: 'statement' | 'fred' }>
  sep?: Readonly<{
    asOf: string
    medianPath?: Readonly<Record<string, number>>
    medianCurrentYear?: number
    previousMedian?: number
    rangeCurrentYear?: Readonly<{ low: number; high: number }>
    /** What the median still implies against the current midpoint, in 25bp steps. */
    stepsFromCurrent?: number
    /** The same gap for the previous quarter's median, so the move can be read at a glance. */
    previousStepsFromCurrent?: number
    sourceUrl: string
  }>
  lastDecision?: Readonly<{
    vote?: Readonly<{ for: number; against: number }>
    dissents?: ReadonlyArray<Readonly<{ name: string; preferred: 'raise' | 'lower' | 'maintain' }>>
    statementUrl?: string
    /** What the decision did, from the range before it: the card must not call every decision "维持". */
    outcome?: PolicyPathOutcome
  }>
  probability?: Readonly<{
    venue: string
    asOf: string
    outcome: PolicyPathOutcome
    value: number
    changeInPp24h?: number
    range30d?: Readonly<{ min: number; max: number }>
    quote?: Readonly<{ bid: number; ask: number }>
    points: number
  }>
  staleness: PolicyPathStaleness
}>

export type PolicyPathQueryService = Readonly<{
  read: (input: { asOf: string }) => PolicyPathReading | undefined
}>

/**
 * The analysis-facing answer: whether the reader enabled the source, and the reading if it has one.
 *
 * `disabled` is deliberately distinct from `unavailable`: a reader who turned the source off should
 * not be told their analysis is missing a gap, while an enabled source with no meeting or no odds is
 * a real gap the conclusion must name.
 */
export type PolicyPathContextRead =
  | Readonly<{ state: 'available'; reading: PolicyPathReading }>
  | Readonly<{ state: 'disabled' }>
  | Readonly<{ state: 'unavailable' }>

export const policyPathQueryPolicy = {
  venue: 'polymarket',
  /** 30 days at the 10-minute collection cadence, before thinning. */
  seriesLookback: 4320,
  /** The window the range is quoted over, independent of how many points arrived. */
  rangeDays: 30,
  chartPoints: 120
} as const

export function createPolicyPathQueryService(deps: {
  calendar: Pick<MacroEconomicCalendarQueryService, 'nextFomcMeeting'>
  facts: Pick<PolicyPathFactStore, 'read' | 'readLatestDecision' | 'readLatestDecisionBefore' | 'readLatestSep'>
  observations: Pick<PolicyPathObservationStore, 'list'>
  /**
   * The policy range as FRED already publishes it. The decision refresh only writes a fact when a
   * statement is parsed, so a range that depends on it alone stays empty until the next meeting.
   */
  readTargetRange?: () => Readonly<{ lowerPercent: number; upperPercent: number }> | undefined
}): PolicyPathQueryService {
  return Object.freeze({
    read({ asOf }) {
      const next = deps.calendar.nextFomcMeeting({ asOf })
      if (next.state !== 'available') return undefined
      const meetingDate = next.meeting.scheduledDate
      const facts = deps.facts.read(meetingDate)
      // The range, the vote and the latest SEP belong to the last meeting that has already decided;
      // the next meeting's row carries only its date and whether it will publish projections.
      const latestDecision = deps.facts.readLatestDecision(asOf)
      const decided = facts?.targetRange ? facts : latestDecision
      // The projections belong to the latest SEP meeting, which is usually not the meeting that last
      // decided; reading them off `decided` would hide a September SEP behind an October statement.
      const sepFact = decided?.sep ? decided : deps.facts.readLatestSep(asOf)
      const daysUntilMeeting = Math.round((Date.parse(`${meetingDate}T00:00:00.000Z`) - Date.parse(asOf)) / 86_400_000)
      // Replays ask for a past instant; only points at or before it may be used, or the reading would
      // describe the future it was asked about.
      const asOfMs = Date.parse(asOf)
      const series = deps.observations.list(meetingDate, policyPathQueryPolicy.seriesLookback)
        .filter((row) => !Number.isFinite(asOfMs) || Date.parse(row.at) <= asOfMs)
      const range = targetRangeOf(decided?.targetRange, deps.readTargetRange)
      const markers = markersOf(series)
      const nextPhase = phaseOfMeeting(meetingDate, asOf)
      const decidedPhase = decided?.targetRange ? phaseOfMeeting(decided.meetingDate, asOf) : undefined
      const settledPhase = decidedPhase && (decidedPhase.kind === 'settlement' || decidedPhase.kind === 'verdict')
        ? decidedPhase
        : undefined
      // The decided meeting's own series is not the next meeting's: after the decision the collector
      // starts on the next meeting, and the strip still needs the price from before this one.
      const decidedSeries = settledPhase && decided && decided.meetingDate !== meetingDate
        ? deps.observations.list(decided.meetingDate, policyPathQueryPolicy.seriesLookback)
          .filter((row) => !Number.isFinite(asOfMs) || Date.parse(row.at) <= asOfMs)
        : series
      const previousDecision = settledPhase && decided?.targetRange
        ? deps.facts.readLatestDecision(dayBefore(decided.meetingDate))
        : undefined
      const decidedRange = decided?.targetRange
      const settlement = settledPhase && decided && decidedRange && previousDecision?.targetRange
        ? settlementOf({
          asOf,
          decidedMeetingDate: decided.meetingDate,
          targetRange: decidedRange,
          previousTargetRange: previousDecision.targetRange,
          actualOutcome: outcomeFromRangeChange({ previous: previousDecision.targetRange, current: decidedRange }),
          series: decidedSeries,
          nextMeetingAfter: (meetingDateAfter) => {
            const after = deps.calendar.nextFomcMeeting({ asOf: `${dayAfter(meetingDateAfter)}T00:00:00.000Z` })
            return after.state === 'available' ? after.meeting.scheduledDate : undefined
          }
        })
        : undefined
      // A decision window whose decision has not been collected falls back to the normal block:
      // without the realised band and the price before it there is nothing honest to strip against.
      const phase: PolicyPathPhase = settlement && settledPhase
        ? settledPhase
        : nextPhase.kind === 'normal' || nextPhase.kind === 'pre-meeting'
          ? nextPhase
          : { kind: 'normal' }
      return {
        meetingDate,
        daysUntilMeeting,
        hasProjectionMaterials: facts?.hasProjectionMaterials ?? false,
        phase,
        ...(markers.length ? { markers } : {}),
        ...(settlement ? { settlement } : {}),
        ...(range === undefined ? {} : { targetRange: range }),
        ...(sepFact?.sep ? { sep: sepOf(sepFact.sep, sepFact.targetRange) } : {}),
        ...(decided && (decided.vote || decided.dissents || decided.statementUrl)
          ? { lastDecision: {
            ...(decided.vote ? { vote: decided.vote } : {}),
            ...(decided.dissents ? { dissents: decided.dissents } : {}),
            ...(decided.statementUrl ? { statementUrl: decided.statementUrl } : {}),
            // What the decision actually did, from the two ranges. Without it the card has to call
            // every decision "维持", which is wrong the first time the committee moves.
            ...(lastActionOf(decided, deps.facts) === undefined ? {} : { outcome: lastActionOf(decided, deps.facts)! })
          } }
          : {}),
        ...(series.length ? { probability: probabilityOf(series, asOf) } : {}),
        staleness: series.length ? stalenessOf(series[series.length - 1]!.at, asOf) : 'unavailable'
      }
    }
  })
}

/** Repricing markers for the bucket the card leads with: the 24h move, with the 6h fallback. */
function markersOf(series: readonly PolicyPathObservation[]): readonly PolicyPathMarker[] {
  const latest = series.at(-1)
  if (!latest) return []
  const { outcome } = leadingOutcome(latest.values)
  const current = latest.values[outcome]
  const previous24h = valueAtOrBefore(series, outcome, 24 * 60)
  const previous6h = valueAtOrBefore(series, outcome, 6 * 60)
  return repricingMarkers({
    ...(previous24h === undefined ? {} : { change24hPp: changeInPp(current, previous24h) }),
    ...(previous6h === undefined ? {} : { change6hPp: changeInPp(current, previous6h) })
  })
}

/** The phase of one meeting's decision instant, or normal when the date is unusable. */
function phaseOfMeeting(meetingDate: string, asOf: string): PolicyPathPhase {
  const decisionAt = decisionInstant(meetingDate)
  return decisionAt ? phaseAt(decisionAt, asOf) : { kind: 'normal' }
}

/**
 * The settlement strip: the realised band, the price in force one hour before the decision, and the
 * gap between them.
 *
 * The price is the last observation at or before T0-1h — not the first after and not the latest:
 * the question is what the market had already paid for before the statement landed.
 */
function settlementOf(input: Readonly<{
  asOf: string
  decidedMeetingDate: string
  targetRange: Readonly<{ lowerPercent: number; upperPercent: number }>
  previousTargetRange: Readonly<{ lowerPercent: number; upperPercent: number }>
  actualOutcome: PolicyPathOutcome
  series: readonly PolicyPathObservation[]
  nextMeetingAfter: (meetingDate: string) => string | undefined
}>): PolicyPathSettlement {
  const decisionAt = decisionInstant(input.decidedMeetingDate)
  const cutoff = decisionAt ? Date.parse(decisionAt) - 3_600_000 : Number.NaN
  const before = Number.isFinite(cutoff)
    ? input.series.filter((row) => Date.parse(row.at) <= cutoff).at(-1)
    : undefined
  const pricedOutcome = before ? leadingOutcome(before.values).outcome : undefined
  const priced = before ? before.values[input.actualOutcome] : undefined
  const conclusion: PolicyPathSettlement['conclusion'] = before && pricedOutcome && priced !== undefined
    ? settlementConclusion({ actual: input.actualOutcome, pricedOutcome, pricedShare: priced })
    : { kind: 'unavailable', reason: 'settlement-pricing-unavailable' }
  const nextMeetingDate = input.nextMeetingAfter(input.decidedMeetingDate)
  const daysUntil = nextMeetingDate === undefined
    ? undefined
    : Math.round((Date.parse(`${nextMeetingDate}T00:00:00.000Z`) - Date.parse(input.asOf)) / 86_400_000)
  return {
    decidedMeetingDate: input.decidedMeetingDate,
    previousTargetRange: input.previousTargetRange,
    actualOutcome: input.actualOutcome,
    ...(priced === undefined ? {} : { priced }),
    ...(pricedOutcome ? { pricedOutcome } : {}),
    ...(before ? { pricedDistribution: before.values } : {}),
    conclusion,
    ...(nextMeetingDate && daysUntil !== undefined && Number.isFinite(daysUntil)
      ? { nextMeeting: { meetingDate: nextMeetingDate, daysUntil } }
      : {})
  }
}

function dayBefore(date: string): string {
  return shiftDay(date, -1)
}

function dayAfter(date: string): string {
  return shiftDay(date, 1)
}

function shiftDay(date: string, days: number): string {
  const parsed = Date.parse(`${date}T00:00:00.000Z`)
  return Number.isFinite(parsed) ? new Date(parsed + days * 86_400_000).toISOString().slice(0, 10) : date
}

/** The last decision's direction, read from the range before it and the range after it. */
function lastActionOf(
  decided: PolicyPathFacts,
  facts: Pick<PolicyPathFactStore, 'readLatestDecisionBefore'>
): PolicyPathOutcome | undefined {
  if (!decided.targetRange) return undefined
  const previous = facts.readLatestDecisionBefore(decided.meetingDate)
  if (!previous?.targetRange) return undefined
  return outcomeFromRangeChange({ previous: previous.targetRange, current: decided.targetRange })
}

/** The parsed statement wins; the published series fills in when no decision has been parsed. */
function targetRangeOf(
  decided: PolicyPathReading['targetRange'] | undefined,
  read: (() => PolicyPathReading['targetRange'] | undefined) | undefined
): PolicyPathReading['targetRange'] | undefined {
  if (decided) return { ...decided, source: 'statement' }
  try {
    const fred = read?.()
    return fred ? { ...fred, source: 'fred' } : undefined
  } catch {
    return undefined
  }
}

function sepOf(
  sep: NonNullable<import('./policyPathFactStore').PolicyPathFacts['sep']>,
  targetRange: { lowerPercent: number; upperPercent: number } | undefined
): NonNullable<PolicyPathReading['sep']> {
  const year = sep.asOf.slice(0, 4)
  const medianCurrentYear = (sep.medianPath as Record<string, number | undefined>)[`y${year}`]
  const midpoint = targetRange ? (targetRange.lowerPercent + targetRange.upperPercent) / 2 : undefined
  const stepsFromCurrent = medianCurrentYear !== undefined && midpoint !== undefined
    ? Math.round((medianCurrentYear - midpoint) / 0.25)
    : undefined
  const previousStepsFromCurrent = sep.previousMedian !== undefined && midpoint !== undefined
    ? Math.round((sep.previousMedian - midpoint) / 0.25)
    : undefined
  return {
    asOf: sep.asOf,
    medianPath: sep.medianPath as Record<string, number>,
    ...(medianCurrentYear === undefined ? {} : { medianCurrentYear }),
    ...(sep.previousMedian === undefined ? {} : { previousMedian: sep.previousMedian }),
    ...(sep.rangeCurrentYear ? { rangeCurrentYear: sep.rangeCurrentYear } : {}),
    ...(stepsFromCurrent === undefined ? {} : { stepsFromCurrent }),
    ...(previousStepsFromCurrent === undefined ? {} : { previousStepsFromCurrent }),
    sourceUrl: sep.sourceUrl
  }
}

function probabilityOf(series: readonly PolicyPathObservation[], asOf: string): NonNullable<PolicyPathReading['probability']> {
  const latest = series[series.length - 1]!
  const { outcome, probability } = leadingOutcome(latest.values)
  const thinned = thinSeries(series, policyPathQueryPolicy.chartPoints)
  const previous = valueAtOrBefore(series, outcome, 24 * 60)
  // Thirty days is a time window, not a count: a paused collector would otherwise compare against
  // points older than a month and widen the range without saying so.
  const windowStart = Date.parse(asOf) - policyPathQueryPolicy.rangeDays * 86_400_000
  const window = series
    .filter((row) => !Number.isFinite(windowStart) || Date.parse(row.at) >= windowStart)
    .map((row) => row.values[outcome])
  return {
    venue: policyPathQueryPolicy.venue,
    asOf: latest.at,
    outcome,
    value: probability,
    ...(previous === undefined ? {} : { changeInPp24h: changeInPp(probability, previous) }),
    ...(window.length ? { range30d: { min: Math.min(...window), max: Math.max(...window) } } : {}),
    ...(latest.quote ? { quote: latest.quote } : {}),
    points: thinned.length
  }
}
