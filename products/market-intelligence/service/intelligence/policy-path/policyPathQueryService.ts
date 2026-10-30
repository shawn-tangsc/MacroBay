import {
  changeInPp, decisionInstant, leadingOutcome, phaseAt, stalenessOf, thinSeries, valueAtOrBefore,
  type PolicyPathObservation, type PolicyPathOutcome, type PolicyPathPhase, type PolicyPathStaleness
} from '../../../contracts/policyPath'
import type { MacroEconomicCalendarQueryService } from '../macro-calendar/macroEconomicCalendarQueryService'
import type { PolicyPathFactStore } from './policyPathFactStore'
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
  targetRange?: Readonly<{ lowerPercent: number; upperPercent: number; source?: 'statement' | 'fred' }>
  sep?: Readonly<{
    asOf: string
    medianPath?: Readonly<Record<string, number>>
    medianCurrentYear?: number
    previousMedian?: number
    rangeCurrentYear?: Readonly<{ low: number; high: number }>
    /** What the median still implies against the current midpoint, in 25bp steps. */
    stepsFromCurrent?: number
    sourceUrl: string
  }>
  lastDecision?: Readonly<{
    vote?: Readonly<{ for: number; against: number }>
    dissents?: ReadonlyArray<Readonly<{ name: string; preferred: 'raise' | 'lower' | 'maintain' }>>
    statementUrl?: string
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
  facts: Pick<PolicyPathFactStore, 'read' | 'readLatestDecision' | 'readLatestSep'>
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
      return {
        meetingDate,
        daysUntilMeeting,
        hasProjectionMaterials: facts?.hasProjectionMaterials ?? false,
        phase: phaseOf({ asOf, meetingDate, decidedMeetingDate: decided?.targetRange ? decided.meetingDate : undefined }),
        ...(range === undefined ? {} : { targetRange: range }),
        ...(sepFact?.sep ? { sep: sepOf(sepFact.sep, sepFact.targetRange) } : {}),
        ...(decided && (decided.vote || decided.dissents || decided.statementUrl)
          ? { lastDecision: { ...(decided.vote ? { vote: decided.vote } : {}), ...(decided.dissents ? { dissents: decided.dissents } : {}), ...(decided.statementUrl ? { statementUrl: decided.statementUrl } : {}) } }
          : {}),
        ...(series.length ? { probability: probabilityOf(series, asOf) } : {}),
        staleness: series.length ? stalenessOf(series[series.length - 1]!.at, asOf) : 'unavailable'
      }
    }
  })
}

/**
 * The shape of the block at `asOf`.
 *
 * A meeting that just decided keeps the card through its settlement window and its three verdict
 * days, even after the calendar has moved on to the next meeting; outside those windows the next
 * meeting's own decision instant decides between the normal shape and the pre-meeting countdown.
 */
function phaseOf(input: Readonly<{ asOf: string; meetingDate: string; decidedMeetingDate?: string }>): PolicyPathPhase {
  const decidedAt = input.decidedMeetingDate ? decisionInstant(input.decidedMeetingDate) : undefined
  const decidedPhase = decidedAt ? phaseAt(decidedAt, input.asOf) : undefined
  if (decidedPhase?.kind === 'settlement' || decidedPhase?.kind === 'verdict') return decidedPhase
  const nextAt = decisionInstant(input.meetingDate)
  return nextAt ? phaseAt(nextAt, input.asOf) : { kind: 'normal' }
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
  return {
    asOf: sep.asOf,
    medianPath: sep.medianPath as Record<string, number>,
    ...(medianCurrentYear === undefined ? {} : { medianCurrentYear }),
    ...(sep.previousMedian === undefined ? {} : { previousMedian: sep.previousMedian }),
    ...(sep.rangeCurrentYear ? { rangeCurrentYear: sep.rangeCurrentYear } : {}),
    ...(stepsFromCurrent === undefined ? {} : { stepsFromCurrent }),
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
