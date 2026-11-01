import { describe, expect, it, vi } from 'vitest'

import { isModuleSignal } from '../../../contracts/moduleSignal'
import { createCalendarSignalQuery, createOpenInterestSignalQuery } from './moduleSignalQuery'

const asOf = '2026-10-31T14:45:00.000Z'

describe('module signal query', () => {
  it('asks the panel query once, for the window the rule needs', async () => {
    const readHistory = vi.fn(async () => ({
      state: 'available' as const, asOf, window: '24h' as const, btc: [], eth: [],
      liquidationHints: [{ observedAt: '2026-10-31T14:30:00.000Z', asset: 'btc' as const, dropPct: -2.6, volumeMultiple: 3.2, notionalUsd: 7.4e9 }],
      liquidationHintsState: 'available' as const
    }))
    const signals = await createOpenInterestSignalQuery({ readHistory }).query({ asOf })
    expect(readHistory).toHaveBeenCalledWith({ asOf, window: '24h' })
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({ ruleId: 'oi-liquidation-proxy', severity: 'high' })
    expect(isModuleSignal(signals[0])).toBe(true)
  })

  it('turns a thrown read into a failed-read signal, never into silence', async () => {
    const readHistory = vi.fn(async () => { throw new Error('store down') })
    const signals = await createOpenInterestSignalQuery({ readHistory }).query({ asOf })
    expect(signals).toHaveLength(2)
    expect(signals.every(signal => signal.readiness === 'unavailable')).toBe(true)
  })

  it('passes on a quiet market as no signals at all', async () => {
    const signals = await createOpenInterestSignalQuery({
      readHistory: async () => ({
        state: 'available', asOf, window: '24h', btc: [], eth: [], liquidationHintsState: 'available'
      })
    }).query({ asOf })
    expect(signals).toEqual([])
  })
})

describe('calendar signal query', () => {
  const release = (overrides: Record<string, unknown> = {}) => ({
    eventKey: 'us-ppi-yoy-2026-10', releaseGroupKey: 'us-ppi-yoy', eventFamily: 'economic-indicator',
    titleKey: 'ppi', countryCode: 'US', importance: 'high', periodKey: '2026-10',
    lifecycleState: 'released', coverage: 'available',
    scheduledDate: '2026-10-31', scheduledAt: '2026-10-31T12:30:00.000Z',
    releaseTimeSource: 'official', detectedAt: '2026-10-31T12:31:00.000Z',
    actual: { displayValue: '5.0%' }, previous: { displayValue: '4.8%' }, consensus: { displayValue: '4.4%' },
    consensusState: 'available', surprise: 'beat', providerIds: ['0xrouter'], caveats: [],
    ...overrides
  } as never)

  it('turns a release from this window into one signal that leaves the trigger with the calendar', async () => {
    const signals = await createCalendarSignalQuery({ readObservations: async () => [release()] }).query({ asOf })
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({ moduleId: 'macro-calendar', severity: 'high', triggerOwner: 'calendar.refresh' })
    expect(isModuleSignal(signals[0])).toBe(true)
  })

  it('does not replay an old release onto today', async () => {
    // Three weeks back: the analysis treats this as history, and the chip must not call it news.
    const signals = await createCalendarSignalQuery({
      readObservations: async () => [release({ scheduledAt: '2026-10-10T12:30:00.000Z', detectedAt: '2026-10-10T12:31:00.000Z' })]
    }).query({ asOf })
    expect(signals).toEqual([])
  })

  it('reports a failed read as unavailable instead of a quiet market', async () => {
    const signals = await createCalendarSignalQuery({
      readObservations: async () => { throw new Error('calendar down') }
    }).query({ asOf })
    expect(signals).toHaveLength(1)
    expect(signals[0]!.readiness).toBe('unavailable')
    expect(isModuleSignal(signals[0])).toBe(true)
  })
})
