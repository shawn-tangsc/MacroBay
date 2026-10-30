import {
  changeInPp, leadingOutcome, stalenessOf, thinSeries, valueAtOrBefore,
  type PolicyPathObservation, type PolicyPathOutcome, type PolicyPathStaleness
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
  targetRange?: Readonly<{ lowerPercent: number; upperPercent: number }>
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

export const policyPathQueryPolicy = {
  venue: 'polymarket',
  /** 30 days at the 10-minute collection cadence, before thinning. */
  seriesLookback: 4320,
  chartPoints: 120
} as const

export function createPolicyPathQueryService(deps: {
  calendar: Pick<MacroEconomicCalendarQueryService, 'nextFomcMeeting'>
  facts: Pick<PolicyPathFactStore, 'read' | 'readLatestDecision'>
  observations: Pick<PolicyPathObservationStore, 'list'>
}): PolicyPathQueryService {
  return Object.freeze({
    read({ asOf }) {
      const next = deps.calendar.nextFomcMeeting({ asOf })
      if (next.state !== 'available') return undefined
      const meetingDate = next.meeting.scheduledDate
      const facts = deps.facts.read(meetingDate)
      // The range, the vote and the latest SEP belong to the last meeting that has already decided;
      // the next meeting's row carries only its date and whether it will publish projections.
      const decided = facts?.targetRange ? facts : deps.facts.readLatestDecision(asOf)
      const daysUntilMeeting = Math.round((Date.parse(`${meetingDate}T00:00:00.000Z`) - Date.parse(asOf)) / 86_400_000)
      const series = deps.observations.list(meetingDate, policyPathQueryPolicy.seriesLookback)
      return {
        meetingDate,
        daysUntilMeeting,
        hasProjectionMaterials: facts?.hasProjectionMaterials ?? false,
        ...(decided?.targetRange ? { targetRange: decided.targetRange } : {}),
        ...(decided?.sep ? { sep: sepOf(decided.sep, decided.targetRange) } : {}),
        ...(decided && (decided.vote || decided.dissents || decided.statementUrl)
          ? { lastDecision: { ...(decided.vote ? { vote: decided.vote } : {}), ...(decided.dissents ? { dissents: decided.dissents } : {}), ...(decided.statementUrl ? { statementUrl: decided.statementUrl } : {}) } }
          : {}),
        ...(series.length ? { probability: probabilityOf(series, asOf) } : {}),
        staleness: series.length ? stalenessOf(series[series.length - 1]!.at, asOf) : 'unavailable'
      }
    }
  })
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
  const window = series.slice(-policyPathQueryPolicy.seriesLookback).map((row) => row.values[outcome])
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
