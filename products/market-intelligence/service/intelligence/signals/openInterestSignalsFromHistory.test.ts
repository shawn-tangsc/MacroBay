import { describe, expect, it } from 'vitest'

import { isModuleSignal } from '../../../contracts/moduleSignal'
import { openInterestSignalsFromHistory } from './openInterestSignals'

/**
 * The production mapping: the panel's query already marked the buckets, this only turns each mark
 * into the shared signal vocabulary.
 *
 * Every case here goes through the DTO the panel receives. The one shape that used to be tested
 * separately - detect from raw bars - was removed: it had no production caller since 0.3.0 and
 * hard-coded `direction: 'long'`, so wiring it would have silently dropped every short squeeze.
 */

const asOf = '2026-10-31T14:45:00.000Z'

/** A hint as the query hands it over: the direction travels with the mark, never guessed. */
const hint = (asset: 'btc' | 'eth', dropPct: number, extra: Record<string, unknown> = {}) => ({
  observedAt: '2026-10-31T14:30:00.000Z',
  asset,
  direction: 'long' as const,
  dropPct,
  volumeMultiple: 3.1,
  notionalUsd: 7.4e9,
  ...extra
})

const reading = (overrides: Record<string, unknown> = {}) => ({
  state: 'available' as const,
  asOf,
  window: '24h' as const,
  btc: [],
  eth: [],
  liquidationHintsState: 'available' as const,
  ...overrides
})

describe('signals read from the panel query', () => {
  it('maps the hints the query already marked, without running the mark again', () => {
    const signals = openInterestSignalsFromHistory(reading({ liquidationHints: [hint('btc', -1.8), hint('eth', -2.9)] }), asOf)
    expect(signals.map(signal => [signal.asset, signal.severity])).toEqual([['btc', 'medium'], ['eth', 'high']])
    expect(signals.every(signal => signal.readiness === 'available')).toBe(true)
  })

  it('does not read an unreadable volume leg as a quiet market', () => {
    const signals = openInterestSignalsFromHistory(reading({ liquidationHintsState: 'unavailable' }), asOf)
    expect(signals).toHaveLength(2)
    expect(signals.every(signal => signal.readiness === 'unavailable')).toBe(true)
  })

  it('reports a failed history read for both assets, since it cannot name one', () => {
    const signals = openInterestSignalsFromHistory({ state: 'unavailable', failureCode: 'open-interest-history-query-unavailable' }, asOf)
    expect(signals.map(signal => signal.asset)).toEqual(['btc', 'eth'])
    expect(signals.every(signal => signal.readiness === 'unavailable')).toBe(true)
    expect(signals.every(isModuleSignal)).toBe(true)
  })

  it('keeps only the asset each hint belongs to', () => {
    const signals = openInterestSignalsFromHistory(reading({ liquidationHints: [hint('eth', -1.9)] }), asOf)
    expect(signals.map(signal => signal.asset)).toEqual(['eth'])
  })

  it('says nothing when nothing looked like a liquidation', () => {
    // 读到了、判完了、一条没命中：空列表就是「没有」，不是「读不到」——后者走上面那两条 unavailable。
    expect(openInterestSignalsFromHistory(reading({ liquidationHints: [] }), asOf)).toEqual([])
  })

  it('keys each bucket once, so the same bucket cannot speak twice', () => {
    const input = () => reading({ liquidationHints: [hint('btc', -1.8)] })
    const first = openInterestSignalsFromHistory(input(), asOf)
    const again = openInterestSignalsFromHistory(input(), asOf)
    expect(first[0]!.dedupeKey).toBe(again[0]!.dedupeKey)
    expect(first[0]!.dedupeKey).toContain('open-interest:oi-liquidation-proxy:btc:')
  })
})

describe('the price the hit carried', () => {
  it('carries the signed move into the reading, and invents neither field', () => {
    const marked = openInterestSignalsFromHistory(reading({
      liquidationHints: [hint('btc', -2, { closePrice: 68_500, pricePct: -1.4 })]
    }), asOf)
    expect(marked[0]!.values).toMatchObject({ priceUsd: 68_500, priceChangePct: -1.4 })

    // 老读取没有价格这一格：不写、也不拿别的数补上。
    const legacy = openInterestSignalsFromHistory(reading({ liquidationHints: [hint('btc', -2)] }), asOf)
    expect(legacy[0]!.values).not.toHaveProperty('priceUsd')
    expect(legacy[0]!.values).not.toHaveProperty('priceChangePct')
  })
})
