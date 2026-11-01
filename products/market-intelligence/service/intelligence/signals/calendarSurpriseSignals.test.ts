import { describe, expect, it } from 'vitest'

import { isModuleSignal } from '../../../contracts/moduleSignal'
import type { MacroCalendarProviderObservation } from '../macro-calendar/marketCalendarObservationNormalization'
import { calendarSignalRule, calendarSurpriseSignals } from './calendarSurpriseSignals'

const asOf = '2026-10-31T14:00:00.000Z'

const observation = (overrides: Partial<MacroCalendarProviderObservation> = {}): MacroCalendarProviderObservation => ({
  eventKey: 'us-ppi-yoy-2026-10',
  releaseGroupKey: 'us-ppi-yoy',
  eventFamily: 'economic-indicator',
  titleKey: 'ppi',
  countryCode: 'US',
  importance: 'high',
  periodKey: '2026-10',
  lifecycleState: 'released',
  coverage: 'available',
  scheduledDate: '2026-10-31',
  scheduledAt: '2026-10-31T12:30:00.000Z',
  releaseTimeSource: 'official',
  detectedAt: '2026-10-31T12:31:00.000Z',
  actual: { displayValue: '5.0%' },
  previous: { displayValue: '4.8%' },
  consensus: { displayValue: '4.4%' },
  consensusState: 'available',
  surprise: 'beat',
  providerIds: ['0xrouter'],
  caveats: [],
  ...overrides
} as MacroCalendarProviderObservation)

const signalsFor = (rows: readonly MacroCalendarProviderObservation[]) =>
  calendarSurpriseSignals({ observations: rows, previous: null, previousAsOf: null, asOf })

describe('calendar surprise signals', () => {
  it('gives a surprise the shared shape without taking over its trigger', () => {
    const signals = signalsFor([observation()])
    expect(signals).toHaveLength(1)
    const [signal] = signals
    expect(signal).toMatchObject({
      moduleId: 'macro-calendar',
      ruleId: 'macro-surprise',
      asset: null,
      severity: 'high',
      // The release already causes a run under this key; a second key would spend two calls on one
      // number.
      triggerOwner: 'calendar.refresh'
    })
    expect(signal!.cadence).toEqual({ kind: 'trading-day' })
    expect(signal!.dedupeKey).toBe('macro-calendar:macro-surprise:market:2026-10-31')
    expect(isModuleSignal(signal)).toBe(true)
  })

  it('dates the signal by the release, not by when we noticed it', () => {
    const signals = signalsFor([observation({ scheduledAt: '2026-10-30T12:30:00.000Z', detectedAt: '2026-10-31T09:00:00.000Z' })])
    expect(signals[0]!.observedAt).toBe('2026-10-30T12:30:00.000Z')
    // A late arrival still belongs to the session it describes.
    expect(signals[0]!.dedupeKey.endsWith(':2026-10-30')).toBe(true)
  })

  it('says nothing about a release inside the surprise threshold', () => {
    expect(signalsFor([observation({ actual: { displayValue: '4.5%' } })])).toEqual([])
  })

  it('says nothing about releases the policy does not qualify', () => {
    // Not US, not high importance, not an economic indicator: each is a separate exit, and a
    // surprising number in any of them must not become a reason to run an analysis.
    expect(signalsFor([observation({ countryCode: 'DE' })])).toEqual([])
    expect(signalsFor([observation({ importance: 'medium' })])).toEqual([])
    expect(signalsFor([observation({ eventFamily: 'speech' })])).toEqual([])
  })

  it('says nothing when there is no consensus to be surprised by', () => {
    expect(signalsFor([observation({ consensus: null, consensusState: 'unavailable' })])).toEqual([])
  })

  it('keeps the rule identity stable so a chip and a trigger name the same thing', () => {
    expect(calendarSignalRule.triggerOwner).toBe('calendar.refresh')
    expect(calendarSignalRule.moduleId).toBe('macro-calendar')
  })
})
