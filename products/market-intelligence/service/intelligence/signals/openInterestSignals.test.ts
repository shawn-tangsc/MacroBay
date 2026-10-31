import { describe, expect, it } from 'vitest'

import { liquidationHintPolicy, type PositioningBar } from '../../../contracts/openInterestPositioning'
import { isModuleSignal } from '../../../contracts/moduleSignal'
import { openInterestSignals, openInterestSignalsFromHistory, openInterestSignalRule } from './openInterestSignals'

const bucket = 15 * 60_000
const start = Date.parse('2026-10-31T00:00:00.000Z')

/** Flat buckets with a stable volume, so the last one can be given a shape worth marking. */
function bars(count: number, last?: Partial<PositioningBar>): PositioningBar[] {
  const rows: PositioningBar[] = []
  for (let index = 0; index < count; index += 1) {
    rows.push({
      observedAt: new Date(start + index * bucket).toISOString(),
      notionalUsd: 1_000_000_000,
      volumeBase: 1_000,
      closePrice: 70_000,
      ...(index === count - 1 ? last : {})
    })
  }
  return rows
}

const asOf = new Date(start + 200 * bucket).toISOString()

describe('open interest signals', () => {
  it('turns a marked bucket into a signal carrying the numbers the mark used', () => {
    const signals = openInterestSignals({
      asset: 'btc',
      bars: bars(liquidationHintPolicy.lookbackBars + 1, { notionalUsd: 970_000_000, closePrice: 69_000, volumeBase: 2_500 }),
      asOf
    })
    expect(signals).toHaveLength(1)
    const [signal] = signals
    expect(signal).toMatchObject({ moduleId: 'open-interest', ruleId: 'oi-liquidation-proxy', asset: 'btc', readiness: 'available' })
    expect(signal!.cadence).toEqual({ kind: 'intraday', bucketMs: openInterestSignalRule.bucketMs })
    expect(signal!.values.dropPct).toBeLessThanOrEqual(liquidationHintPolicy.dropPct)
    expect(signal!.values.volumeMultiple).toBeGreaterThanOrEqual(liquidationHintPolicy.volumeMultiple)
    expect(isModuleSignal(signal)).toBe(true)
  })

  it('marks a worse drop as high using the policy line that already existed', () => {
    const strong = openInterestSignals({
      asset: 'btc',
      bars: bars(liquidationHintPolicy.lookbackBars + 1, { notionalUsd: 960_000_000, closePrice: 69_000, volumeBase: 2_500 }),
      asOf
    })
    const ordinary = openInterestSignals({
      asset: 'btc',
      bars: bars(liquidationHintPolicy.lookbackBars + 1, { notionalUsd: 980_000_000, closePrice: 69_400, volumeBase: 2_500 }),
      asOf
    })
    expect(strong[0]?.severity).toBe('high')
    expect(ordinary[0]?.severity).toBe('medium')
    // The line is the policy's, not a second number written here.
    expect(strong[0]!.values.dropPct).toBeLessThanOrEqual(liquidationHintPolicy.strongDropPct)
    expect(ordinary[0]!.values.dropPct).toBeGreaterThan(liquidationHintPolicy.strongDropPct)
  })

  it('says nothing when nothing looked like a liquidation', () => {
    const signals = openInterestSignals({ asset: 'btc', bars: bars(liquidationHintPolicy.lookbackBars + 5, { volumeBase: 2_500 }), asOf })
    expect(signals).toEqual([])
  })

  it('reports a read it could not make instead of an empty list', () => {
    const gaps = bars(liquidationHintPolicy.lookbackBars + 2).map(row => ({ ...row, volumeBase: null }))
    const signals = openInterestSignals({ asset: 'btc', bars: gaps, asOf })
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({ readiness: 'unavailable', ruleId: 'oi-liquidation-proxy' })
    expect(isModuleSignal(signals[0])).toBe(true)
  })

  it('keys each bucket once, so the same bucket cannot speak twice', () => {
    const input = () => bars(liquidationHintPolicy.lookbackBars + 1, { notionalUsd: 970_000_000, closePrice: 69_000, volumeBase: 2_500 })
    const first = openInterestSignals({ asset: 'btc', bars: input(), asOf })
    const again = openInterestSignals({ asset: 'btc', bars: input(), asOf })
    expect(first[0]!.dedupeKey).toBe(again[0]!.dedupeKey)
    expect(first[0]!.dedupeKey).toContain('open-interest:oi-liquidation-proxy:btc:')
  })
})

describe('signals read from the panel query', () => {
  const hint = (asset: 'btc' | 'eth', dropPct: number) => ({
    observedAt: '2026-10-31T14:30:00.000Z', asset, dropPct, volumeMultiple: 3.1, notionalUsd: 7.4e9
  })

  it('maps the hints the query already marked, without running the mark again', () => {
    const signals = openInterestSignalsFromHistory({
      state: 'available', asOf: '2026-10-31T14:45:00.000Z', window: '24h',
      btc: [], eth: [], liquidationHints: [hint('btc', -1.8), hint('eth', -2.9)], liquidationHintsState: 'available'
    }, '2026-10-31T14:45:00.000Z')
    expect(signals.map(signal => [signal.asset, signal.severity])).toEqual([['btc', 'medium'], ['eth', 'high']])
    expect(signals.every(signal => signal.readiness === 'available')).toBe(true)
  })

  it('does not read an unreadable volume leg as a quiet market', () => {
    const signals = openInterestSignalsFromHistory({
      state: 'available', asOf: '2026-10-31T14:45:00.000Z', window: '24h',
      btc: [], eth: [], liquidationHintsState: 'unavailable'
    }, '2026-10-31T14:45:00.000Z')
    expect(signals).toHaveLength(2)
    expect(signals.every(signal => signal.readiness === 'unavailable')).toBe(true)
  })

  it('reports a failed history read for both assets, since it cannot name one', () => {
    const signals = openInterestSignalsFromHistory({ state: 'unavailable', failureCode: 'open-interest-history-query-unavailable' }, '2026-10-31T14:45:00.000Z')
    expect(signals.map(signal => signal.asset)).toEqual(['btc', 'eth'])
    expect(signals.every(signal => signal.readiness === 'unavailable')).toBe(true)
  })

  it('keeps only the asset each hint belongs to', () => {
    const signals = openInterestSignalsFromHistory({
      state: 'available', asOf: '2026-10-31T14:45:00.000Z', window: '24h',
      btc: [], eth: [], liquidationHints: [hint('eth', -1.9)], liquidationHintsState: 'available'
    }, '2026-10-31T14:45:00.000Z')
    expect(signals.map(signal => signal.asset)).toEqual(['eth'])
  })
})
