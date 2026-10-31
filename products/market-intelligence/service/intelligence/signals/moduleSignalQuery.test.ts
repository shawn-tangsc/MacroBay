import { describe, expect, it, vi } from 'vitest'

import { isModuleSignal } from '../../../contracts/moduleSignal'
import { createOpenInterestSignalQuery } from './moduleSignalQuery'

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
