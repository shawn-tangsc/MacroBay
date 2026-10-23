import { describe, expect, it } from 'vitest'

import { macroMarketPolicy } from '../../service/intelligence/macro-market/macroMarketPolicy'
import { realMarketApiPolicy } from '../../service/intelligence/macro-market/realMarketApiPolicy'
import { macroMarketWindows } from '../../service/intelligence/macro-market/macroMarketReturns'
import {
  isMacroMarketSnapshotQuery,
  macroMarketSnapshotPublicPolicy,
  parseMacroMarketSnapshot
} from './macroMarketSnapshotContracts'

const asOf = '2026-09-14T12:00:00.000Z'
const availableSource = { enabled: true, hasCredential: true }
const dollar = { seriesId: 'dxy-synthetic', level: 101.42, atMs: Date.parse(asOf), returns: { '15m': 0.1, '1h': -0.2, '24h': 0.4, '7d': 0.3 }, synthetic: true }
const gold = { seriesId: 'xau-usd', level: 3412.55, atMs: Date.parse(asOf), returns: { '15m': 0.05, '1h': 0.15, '24h': -0.4 } }
const snapshot = { state: 'available', asOf, source: availableSource, readings: [dollar, gold], caveats: ['synthetic-dollar-index', 'provider-time-series'] }
const empty = { state: 'empty', asOf, source: availableSource, readings: [], caveats: [] }

describe('macro market snapshot contract', () => {
  it('keeps the wire windows, series and caveats identical to the service policy', () => {
    // One list, not two opinions: the service must *be* this array, not a copy of it. An equal-looking
    // second literal is what produced the 未接入 regression — the main process kept emitting `4h` from
    // its own copy while the renderer's copy had narrowed to 15m/1h/24h/7d, and the whole snapshot
    // failed closed.
    expect(macroMarketWindows).toBe(macroMarketSnapshotPublicPolicy.windows)
    expect([...macroMarketSnapshotPublicPolicy.windows]).toEqual([...macroMarketWindows])
    expect(macroMarketSnapshotPublicPolicy.series).toEqual(macroMarketPolicy.series)
    expect(macroMarketSnapshotPublicPolicy.caveats).toEqual(macroMarketPolicy.caveats)
    expect(macroMarketSnapshotPublicPolicy.syntheticSeriesId).toBe(macroMarketPolicy.series.dollarIndex)
    // The licensed index is the newer half of the same list: one literal for the series id and one
    // freshness window, which is three collection cycles of the source that writes it.
    expect(macroMarketSnapshotPublicPolicy.series.dollarIndexReal).toBe(macroMarketPolicy.series.dollarIndexReal)
    expect(realMarketApiPolicy.series.dollarIndex).toBe(macroMarketPolicy.series.dollarIndexReal)
    expect(macroMarketSnapshotPublicPolicy.dollarIndexPreference).toEqual([
      macroMarketPolicy.series.dollarIndexReal, macroMarketPolicy.series.dollarIndex
    ])
    expect(macroMarketSnapshotPublicPolicy.dollarIndexFreshnessMs).toBe(3 * realMarketApiPolicy.intervalMs)
  })

  it('admits the producer ladder, prints four of its windows, and still refuses 5m', () => {
    // The producer answers 4h from the same fifteen-minute series and the analysis reads it, so it
    // belongs on the wire even though the table has no 4h column.
    expect([...macroMarketSnapshotPublicPolicy.windows]).toEqual(['15m', '1h', '4h', '24h', '7d'])
    const withFourHours = { seriesId: 'dxy-real', level: 102.237, atMs: Date.parse(asOf), returns: { '4h': 0.3 } }
    const view = parseMacroMarketSnapshot({ ...snapshot, readings: [withFourHours, gold], caveats: ['provider-time-series'] })
    expect(view && 'readings' in view && view.readings[0].returns).toEqual({ '4h': 0.3 })
    // 5m is not a narrower window this series cannot serve — it is one a fifteen-minute series can
    // never serve, and admitting it would admit a figure that was never measured.
    expect(parseMacroMarketSnapshot({ ...snapshot, readings: [{ ...withFourHours, returns: { '5m': 0.3 } }] })).toBeUndefined()
  })

  it('admits the licensed index without the computed label, and refuses the label on it', () => {
    const realDollar = { seriesId: 'dxy-real', level: 102.237, atMs: Date.parse(asOf), returns: { '15m': 0.1 } }
    const view = parseMacroMarketSnapshot({ ...snapshot, readings: [realDollar, gold], caveats: ['provider-time-series'] })
    expect(view && 'readings' in view && view.readings[0]).toEqual(realDollar)
    // `synthetic` means "this product computed it". On the licensed series it is a violation, not an
    // extra field to ignore — otherwise the tag would drift away from the level it describes.
    expect(parseMacroMarketSnapshot({ ...snapshot, readings: [realDollar, { ...realDollar, synthetic: true }] })).toBeUndefined()
  })

  it('admits only the empty request object and never runs a caller accessor', () => {
    expect(isMacroMarketSnapshotQuery({})).toBe(true)
    for (const bad of [undefined, null, [], { asOf }, { range: '24h' }, Object.create(null)]) {
      expect(isMacroMarketSnapshotQuery(bad)).toBe(false)
    }
    let reads = 0
    const accessor = {}
    Object.defineProperty(accessor, 'token', { enumerable: true, get() { reads++; return 'private' } })
    expect(isMacroMarketSnapshotQuery(accessor)).toBe(false)
    expect(reads).toBe(0)
  })

  it('sanitises the service snapshot and drops the internal plan fields', () => {
    const view = parseMacroMarketSnapshot({ ...snapshot, lastRunAtMs: Date.parse(asOf), lastPlan: 'basket-tick' })
    expect(view).toEqual(snapshot)
    expect(view && 'readings' in view && view.readings[0]).toEqual(dollar)
    expect(view && 'source' in view && view.source).toEqual(availableSource)
    expect(view && 'lastRunAtMs' in view).toBe(false)
    expect(view && 'lastPlan' in view).toBe(false)
  })

  it('accepts an empty snapshot and an unavailable answer, and rejects a claim with no reading', () => {
    expect(parseMacroMarketSnapshot(empty)).toEqual(empty)
    expect(parseMacroMarketSnapshot({ state: 'unavailable' })).toEqual({ state: 'unavailable' })
    // An empty store must never be dressed as available, and an "available" answer must carry a level.
    expect(parseMacroMarketSnapshot({ ...snapshot, readings: [] })).toBeUndefined()
    expect(parseMacroMarketSnapshot({ ...empty, readings: [dollar] })).toBeUndefined()
    expect(parseMacroMarketSnapshot({ state: 'unavailable', asOf })).toBeUndefined()
  })

  it('carries the enabled/credential facts the 来源状态 strip needs, and nothing else', () => {
    expect(parseMacroMarketSnapshot({ ...empty, source: { enabled: true, hasCredential: false } })).toEqual({ ...empty, source: { enabled: true, hasCredential: false } })
    for (const source of [
      undefined, null, {}, { enabled: true }, { enabled: 'yes', hasCredential: true },
      { enabled: true, hasCredential: true, maskedPreview: 'xx****yy' }, { enabled: true, hasCredential: 1 }
    ]) {
      expect(parseMacroMarketSnapshot({ ...empty, source })).toBeUndefined()
      expect(parseMacroMarketSnapshot({ ...snapshot, source })).toBeUndefined()
    }
  })

  it('rejects invented identities, values or fields instead of forwarding them', () => {
    const bad: unknown[] = [
      { ...snapshot, asOf: '2026-09-14T12:00:00Z' },
      { ...snapshot, readings: [{ ...dollar, seriesId: 'DX=F' }] },
      { ...snapshot, readings: [{ ...dollar, level: Number.NaN }] },
      { ...snapshot, readings: [{ ...dollar, level: 1e12 }] },
      { ...snapshot, readings: [{ ...dollar, atMs: -1 }] },
      { ...snapshot, readings: [{ ...dollar, returns: { '5m': 0.1 } }] },
      { ...snapshot, readings: [{ ...dollar, returns: { '15m': null } }] },
      { ...snapshot, readings: [{ ...dollar, synthetic: false }] },
      { ...snapshot, readings: [{ ...gold, synthetic: true }] },
      { ...snapshot, caveats: ['provider-time-series', 'internal-note'] },
      { ...snapshot, lastRunAtMs: -1 },
      { ...snapshot, lastPlan: 'x'.repeat(65) },
      { ...snapshot, rawRecordId: 'private' }
    ]
    for (const value of bad) expect(parseMacroMarketSnapshot(value)).toBeUndefined()
  })

  it('reads a hole in one window as an absent key, not as a zero', () => {
    const view = parseMacroMarketSnapshot({ ...snapshot, readings: [gold], caveats: [] })
    expect(view && 'readings' in view && view.readings[0].returns).toEqual({ '15m': 0.05, '1h': 0.15, '24h': -0.4 })
    expect(view && 'readings' in view && Object.hasOwn(view.readings[0].returns, '7d')).toBe(false)
  })

  it('rejects sparse or accessor-backed arrays', () => {
    const sparse: unknown[] = []
    sparse.length = 1
    expect(parseMacroMarketSnapshot({ ...snapshot, readings: sparse })).toBeUndefined()
    let reads = 0
    const accessor = [dollar]
    Object.defineProperty(accessor, '0', { get() { reads++; return dollar } })
    expect(parseMacroMarketSnapshot({ ...snapshot, readings: accessor })).toBeUndefined()
    expect(reads).toBe(0)
  })

  // The live leg is the one field that says "this figure is not a closed bar". It belongs to gold
  // alone, and anything the contract does not recognise has to fail closed rather than be ignored.
  describe('the gold live tick', () => {
    const live = { state: 'live', price: '3412.55', atMs: Date.parse(asOf) }
    const withLive = (tick: unknown) => ({ ...snapshot, readings: [dollar, { ...gold, live: tick }] })

    it('admits the live tick on gold and keeps it frozen and exact', () => {
      const view = parseMacroMarketSnapshot(withLive(live))
      expect(view && 'readings' in view && view.readings[1].live).toEqual(live)
      expect(view && 'readings' in view && Object.isFrozen(view.readings[1].live)).toBe(true)
      // The live price is a separate fact from the level: the collected value is untouched.
      expect(view && 'readings' in view && view.readings[1].level).toBe(gold.level)
      for (const state of macroMarketSnapshotPublicPolicy.live.states) {
        expect(parseMacroMarketSnapshot(withLive({ ...live, state }))).toBeDefined()
      }
      // A tick is optional: an absent live field stays absent, and the row keeps its stored level.
      expect(parseMacroMarketSnapshot({ ...snapshot, readings: [dollar, gold] })).toEqual(snapshot)
      expect(macroMarketSnapshotPublicPolicy.live.seriesId).toBe(gold.seriesId)
    })

    it.each([
      ['a state outside the vocabulary', { ...live, state: 'realtime' }],
      ['no state', { price: '3412.55', atMs: Date.parse(asOf) }],
      ['a numeric price', { ...live, price: 3412.55 }],
      ['a price with a leading plus', { ...live, price: '+3412.55' }],
      ['an exponent price', { ...live, price: '3.41255e3' }],
      ['a zero price', { ...live, price: '0' }],
      ['a negative price', { ...live, price: '-1' }],
      ['a price longer than the bound', { ...live, price: `1${'0'.repeat(macroMarketSnapshotPublicPolicy.live.maxPriceLength)}` }],
      ['an empty price', { ...live, price: '' }],
      ['a non-finite price', { ...live, price: 'NaN' }],
      ['a negative instant', { ...live, atMs: -1 }],
      ['a fractional instant', { ...live, atMs: Date.parse(asOf) + 0.5 }],
      ['a missing instant', { state: 'live', price: '3412.55' }],
      ['an extra field', { ...live, source: 'twelve-data' }],
      ['a credential preview', { ...live, apiKey: 'xx****yy' }],
      ['an undefined tick', undefined],
      ['a null tick', null],
      ['a string tick', 'live']
    ])('rejects %s rather than forwarding it', (_label, tick) => {
      expect(parseMacroMarketSnapshot(withLive(tick))).toBeUndefined()
    })

    it('refuses a live tick anywhere but gold', () => {
      for (const reading of [
        { ...dollar, live },
        { seriesId: 'usd-cnh', level: 7.1, atMs: Date.parse(asOf), returns: {}, live },
        { seriesId: 'usdt-usd', level: 1, atMs: Date.parse(asOf), returns: {}, live }
      ]) {
        expect(parseMacroMarketSnapshot({ ...snapshot, readings: [reading] })).toBeUndefined()
      }
    })
  })
})
