import type { OpenInterestHistoryResult, OpenInterestWindow } from '../../../contracts/openInterestHistory'
import type { ModuleSignal } from '../../../contracts/moduleSignal'
import type { MacroCalendarProviderObservation } from '../macro-calendar/marketCalendarObservationNormalization'
import { firstSeenReleaseWindowMs } from '../analysis/significanceChangeMatcher'
import { calendarSurpriseSignals, calendarUnavailableSignals } from './calendarSurpriseSignals'
import { openInterestSignalsFromHistory } from './openInterestSignals'

/**
 * The signal reads the dashboard will call, one per leg that can answer today.
 *
 * It owns no rule of its own: it asks the same `queryOpenInterestHistory` the panel asks, so the
 * chip and the mark are computed from one read and cannot describe different buckets. When Q-1b
 * lands its ETF leg and the calendar leg gets its baseline, they join this list — the shape is a
 * list of signals for one instant, not a per-module tree.
 */
export type ModuleSignalQuery = Readonly<{
  query: (input: Readonly<{ asOf: string }>) => Promise<readonly ModuleSignal[]>
}>

/**
 * One leg's producer.
 *
 * The public query holds a list of these rather than a per-module tree, so a new leg is an
 * addition to that list and not a change to the shape the page reads. The list starts with the
 * only leg that can answer today; a leg joins it when it can answer, never as an empty stub.
 */
export type ModuleSignalProducer = ModuleSignalQuery

export function createOpenInterestSignalQuery(deps: Readonly<{
  readHistory: (input: Readonly<{ asOf: string; window: OpenInterestWindow }>) => Promise<OpenInterestHistoryResult>
}>): ModuleSignalQuery {
  return {
    async query(input) {
      try {
        const reading = await deps.readHistory({ asOf: input.asOf, window: '24h' })
        return openInterestSignalsFromHistory(reading, input.asOf)
      } catch {
        // A thrown read is a failed read, not a quiet market: it must reach the card as `unavailable`
        // instead of an empty list, which is what a reader would read as "nothing happened".
        return openInterestSignalsFromHistory({ state: 'unavailable', failureCode: 'open-interest-history-query-unavailable' }, input.asOf)
      }
    }
  }
}

/**
 * The calendar leg, read at one instant.
 *
 * Two things are deliberately not decided here. Which releases count as a surprise stays with
 * `providerReleaseSurprisePolicy`, and which of them is "this time's" stays with the same 24-hour
 * bound the analysis uses to call a release new — a first sync of a month must not replay three
 * weeks of surprises onto today's chip, and a second number for that bound is how the two would
 * drift apart.
 *
 * The baseline is `null` on purpose: this read has no previous snapshot to compare against, and
 * `providerReleaseSurprises` treats a missing baseline as "not judged yet" rather than as "changed".
 */
export function createCalendarSignalQuery(deps: Readonly<{
  readObservations: (input: Readonly<{ asOf: string }>) => Promise<readonly MacroCalendarProviderObservation[]>
}>): ModuleSignalQuery {
  return {
    async query(input) {
      try {
        const observations = await deps.readObservations({ asOf: input.asOf })
        const recent = observations.filter(observation => isRecentRelease(observation, input.asOf))
        return calendarSurpriseSignals({ observations: recent, previous: null, previousAsOf: null, asOf: input.asOf })
      } catch {
        // A failed read is reported as failed; an empty list would claim the market was quiet.
        return calendarUnavailableSignals(input.asOf)
      }
    }
  }
}

/** The same window the analysis uses to decide a release is new, not a second number. */
function isRecentRelease(observation: MacroCalendarProviderObservation, asOf: string): boolean {
  const scheduledAt = Date.parse(observation.scheduledAt ?? '')
  if (!Number.isFinite(scheduledAt)) return false
  return Math.abs(Date.parse(asOf) - scheduledAt) <= firstSeenReleaseWindowMs
}
