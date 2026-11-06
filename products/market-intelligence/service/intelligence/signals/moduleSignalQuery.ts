import type { OpenInterestHistoryResult, OpenInterestWindow } from '../../../contracts/openInterestHistory'
import type { CapitalConditionsSnapshotResult } from '../../../contracts/intelligenceQueryContracts'
import { signalWindow, type ModuleSignal } from '../../../contracts/moduleSignal'
import type { SignalWithWindow } from '../../../contracts/moduleSignalEvidence'
import type { MacroCalendarProviderObservation } from '../macro-calendar/marketCalendarObservationNormalization'
import { firstSeenReleaseWindowMs } from '../analysis/significanceChangeMatcher'
import { calendarSurpriseSignals, calendarUnavailableSignals } from './calendarSurpriseSignals'
import { buildEtfOutflowSignal, etfOutflowUnavailableSignals } from './etfOutflowSignal'
import { etfFlowPolicy } from '../../../contracts/etfFlows'
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
  query: (input: Readonly<{ asOf: string }>) => Promise<readonly SignalWithWindow[]>
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
        return withRuleWindow(openInterestSignalsFromHistory(reading, input.asOf), 1)
      } catch {
        // A thrown read is a failed read, not a quiet market: it must reach the card as `unavailable`
        // instead of an empty list, which is what a reader would read as "nothing happened".
        return withRuleWindow(openInterestSignalsFromHistory({ state: 'unavailable', failureCode: 'open-interest-history-query-unavailable' }, input.asOf), 1)
      }
    }
  }
}

/**
 * The ETF leg, read at one instant.
 *
 * Its input is the same capital-conditions snapshot the panel reads: the panel's five- and
 * twenty-day rows and this three-day rule come from one store read, so the chip and the table
 * cannot describe different days. The rule itself is not reimplemented here — this producer maps
 * the snapshot onto the rule's own input and returns what the rule says.
 *
 * A failed read is `unavailable`, never an empty list: "we could not look" and "nothing happened"
 * are different facts, and the chip has to be able to say the first one.
 */
export function createEtfOutflowSignalQuery(deps: Readonly<{
  readSnapshot: (input: Readonly<{ asOf: string }>) => Promise<CapitalConditionsSnapshotResult>
}>): ModuleSignalQuery {
  return {
    async query(input) {
      try {
        const snapshot = await deps.readSnapshot({ asOf: input.asOf })
        if (snapshot.state !== 'available' || snapshot.etf.state !== 'available') {
          return withRuleWindow(etfOutflowUnavailableSignals(input.asOf), etfFlowPolicy.signalWindowDays)
        }
        const etf = snapshot.etf
        return withRuleWindow((['btc', 'eth'] as const).flatMap(asset => {
          const signal = buildEtfOutflowSignal({ asset, rows: etf[asset].rows, asOf: input.asOf })
          return signal ? [signal] : []
        }), etfFlowPolicy.signalWindowDays)
      } catch {
        return withRuleWindow(etfOutflowUnavailableSignals(input.asOf), etfFlowPolicy.signalWindowDays)
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
        return withRuleWindow(calendarSurpriseSignals({ observations: recent, previous: null, previousAsOf: null, asOf: input.asOf }), 1)
      } catch {
        // A failed read is reported as failed; an empty list would claim the market was quiet.
        return withRuleWindow(calendarUnavailableSignals(input.asOf), 1)
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

/**
 * Pairs each signal with the window its own rule read.
 *
 * The scan never invents a window: a signal whose cadence cannot express the rule's amount is
 * dropped rather than queued under a default (`?? 这几个桶`), because a default is how the window
 * silently stops matching the rule that produced it.
 */
export function withRuleWindow(signals: readonly ModuleSignal[], amount: number): readonly SignalWithWindow[] {
  return signals.flatMap(signal => {
    const window = signalWindow(signal.cadence, amount)
    return window ? [{ signal, window }] : []
  })
}
