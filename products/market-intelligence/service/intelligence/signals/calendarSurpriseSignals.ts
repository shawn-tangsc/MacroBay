import { buildSignalDedupeKey, isModuleSignal, moduleSignalPolicy, type ModuleSignal } from '../../../contracts/moduleSignal'
import type { MacroCalendarProviderObservation } from '../macro-calendar/marketCalendarObservationNormalization'
import { providerReleaseSurprises } from '../analysis/providerReleaseSurprisePolicy'
import type { PreviousFactKey } from '../analysis/significanceChangeMatcher'

/**
 * The calendar leg: a release that landed far enough from consensus to explain, as a signal.
 *
 * It does **not** trigger anything. `providerReleaseSurprisePolicy` already causes a run under the
 * `calendar.refresh` trigger key, so this leg carries `triggerOwner: 'calendar.refresh'` and exists
 * only so the chip and the analysis name the same event the same way. A second trigger key for one
 * release would spend two calls explaining one number.
 *
 * Nothing is re-thresholded here either: `providerReleaseSurprises` is the only place that decides
 * what counts as a surprise, and this module only gives one a shape.
 */
export const calendarSignalRule = Object.freeze({
  moduleId: 'macro-calendar' as const,
  ruleId: 'macro-surprise',
  severity: 'high' as const,
  /** The key that already owns this event, so `signal.*` must not claim it too. */
  triggerOwner: 'calendar.refresh'
})

export function calendarSurpriseSignals(input: Readonly<{
  observations: readonly MacroCalendarProviderObservation[]
  previous: ReadonlyMap<PreviousFactKey, string | null> | null
  previousAsOf: string | null
  asOf: string
}>): readonly ModuleSignal[] {
  const surprises = providerReleaseSurprises(input)
  if (surprises.length === 0) return Object.freeze([])
  const byEventKey = new Map(input.observations.map(observation => [observation.eventKey, observation]))
  const signals: ModuleSignal[] = []
  for (const surprise of surprises) {
    const observation = byEventKey.get(surprise.eventKey)
    // The instant the data describes, not the instant we noticed the row: a release that arrives
    // late still belongs to its own release time.
    const observedAt = observation?.scheduledAt ?? observation?.detectedAt
    if (!observedAt) continue
    const cadence = Object.freeze({ kind: 'trading-day' as const })
    const dedupeKey = buildSignalDedupeKey({
      moduleId: calendarSignalRule.moduleId,
      ruleId: calendarSignalRule.ruleId,
      asset: null,
      observedAt,
      cadence
    })
    if (!dedupeKey) continue
    const signal: ModuleSignal = Object.freeze({
      version: moduleSignalPolicy.version,
      moduleId: calendarSignalRule.moduleId,
      ruleId: calendarSignalRule.ruleId,
      asset: null,
      severity: calendarSignalRule.severity,
      observedAt,
      cadence,
      // The two numbers a reader needs to judge the gap themselves; the display values stay on the
      // calendar row, which is where a formatted percent belongs.
      values: Object.freeze({
        difference: surprise.difference,
        ...(surprise.relative === undefined ? {} : { relative: surprise.relative })
      }),
      dedupeKey,
      readiness: 'available' as const,
      triggerOwner: calendarSignalRule.triggerOwner
    })
    if (isModuleSignal(signal)) signals.push(signal)
  }
  return Object.freeze(signals)
}

/**
 * The calendar could not be read at all.
 *
 * Silence here would read as "no release surprised the market" — the one thing a failed read
 * cannot know. The chip says the leg is unavailable instead, exactly like the open-interest leg.
 */
export function calendarUnavailableSignals(asOf: string): readonly ModuleSignal[] {
  const cadence = Object.freeze({ kind: 'trading-day' as const })
  const dedupeKey = buildSignalDedupeKey({
    moduleId: calendarSignalRule.moduleId,
    ruleId: calendarSignalRule.ruleId,
    asset: null,
    observedAt: asOf,
    cadence
  })
  if (!dedupeKey) return Object.freeze([])
  const signal: ModuleSignal = Object.freeze({
    version: moduleSignalPolicy.version,
    moduleId: calendarSignalRule.moduleId,
    ruleId: calendarSignalRule.ruleId,
    asset: null,
    severity: calendarSignalRule.severity,
    observedAt: asOf,
    cadence,
    values: Object.freeze({}),
    dedupeKey,
    readiness: 'unavailable' as const,
    triggerOwner: calendarSignalRule.triggerOwner
  })
  return Object.freeze(isModuleSignal(signal) ? [signal] : [])
}
