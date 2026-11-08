import { describe, expect, it, vi } from 'vitest'

import { isModuleSignal } from '../../../contracts/moduleSignal'
import { createCalendarSignalQuery, createEtfOutflowSignalQuery, createOpenInterestSignalQuery, withRuleWindow } from './moduleSignalQuery'

const asOf = '2026-10-31T14:45:00.000Z'

describe('module signal query', () => {
  it('asks the panel query once, for the window the card is showing', async () => {
    const readHistory = vi.fn(async () => ({
      state: 'available' as const, asOf, window: '24h' as const, btc: [], eth: [],
      liquidationHints: [{ observedAt: '2026-10-31T14:30:00.000Z', asset: 'btc' as const, direction: 'long' as const, dropPct: -2.6, volumeMultiple: 3.2, notionalUsd: 7.4e9 }],
      liquidationHintsState: 'available' as const
    }))
    const signals = await createOpenInterestSignalQuery({ readHistory }).query({ asOf }).then(entries => entries.map(entry => entry.signal))
    // 判定窗口固定 24 小时，不跟卡片页签（用户 2026-11-08 10:4x 定）。
    expect(readHistory).toHaveBeenCalledWith({ asOf, window: '24h' })
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({ ruleId: 'oi-liquidation-proxy', severity: 'high' })
    expect(isModuleSignal(signals[0])).toBe(true)
  })

  it('turns a thrown read into a failed-read signal, never into silence', async () => {
    const readHistory = vi.fn(async () => { throw new Error('store down') })
    const signals = await createOpenInterestSignalQuery({ readHistory }).query({ asOf }).then(entries => entries.map(entry => entry.signal))
    expect(signals).toHaveLength(2)
    expect(signals.every(signal => signal.readiness === 'unavailable')).toBe(true)
  })

  it('passes on a quiet market as no signals at all', async () => {
    const signals = await createOpenInterestSignalQuery({
      readHistory: async () => ({
        state: 'available', asOf, window: '24h', btc: [], eth: [], liquidationHintsState: 'available'
      })
    }).query({ asOf }).then(entries => entries.map(entry => entry.signal))
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
    const signals = await createCalendarSignalQuery({ readObservations: async () => [release()] }).query({ asOf }).then(entries => entries.map(entry => entry.signal))
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({ moduleId: 'macro-calendar', severity: 'high', triggerOwner: 'calendar.refresh' })
    expect(isModuleSignal(signals[0])).toBe(true)
  })

  it('does not replay an old release onto today', async () => {
    // Three weeks back: the analysis treats this as history, and the chip must not call it news.
    const signals = await createCalendarSignalQuery({
      readObservations: async () => [release({ scheduledAt: '2026-10-10T12:30:00.000Z', detectedAt: '2026-10-10T12:31:00.000Z' })]
    }).query({ asOf }).then(entries => entries.map(entry => entry.signal))
    expect(signals).toEqual([])
  })

  it('reports a failed read as unavailable instead of a quiet market', async () => {
    const signals = await createCalendarSignalQuery({
      readObservations: async () => { throw new Error('calendar down') }
    }).query({ asOf }).then(entries => entries.map(entry => entry.signal))
    expect(signals).toHaveLength(1)
    expect(signals[0]!.readiness).toBe('unavailable')
    expect(isModuleSignal(signals[0])).toBe(true)
  })
})

describe('ETF outflow signal query', () => {
  const day = (index: number) => `2026-10-${String(26 + index).padStart(2, '0')}`
  const rows = (values: readonly number[]) => values.map((netFlowUsd, index) => ({
    tradingDate: day(index), netFlowUsd, observedAt: `${day(index)}T00:00:00.000Z`
  }))
  const snapshot = (btc: readonly number[], eth: readonly number[]) => ({
    state: 'available' as const,
    asOf,
    etf: {
      state: 'available' as const,
      schemaVersion: 1 as const,
      sourceId: '0xrouter' as const,
      windowEnd: day(btc.length - 1),
      verifiedAt: asOf,
      btc: { asset: 'BTC' as const, rows: rows(btc) },
      eth: { asset: 'ETH' as const, rows: rows(eth) }
    },
    coreStablecoins: {},
    conclusion: 'partial' as const
  } as never)

  // 牌子与表格读同一份快照：这条腿judge的就是面板画的那些行，不另开一次读。
  it('judges the same snapshot the card draws, one signal per asset', async () => {
    const readSnapshot = vi.fn(async () => snapshot([-40_000_000, -50_000_000, -60_000_000], [10_000_000, -20_000_000, -30_000_000]))
    const signals = await createEtfOutflowSignalQuery({ readSnapshot }).query({ asOf }).then(entries => entries.map(entry => entry.signal))

    expect(readSnapshot).toHaveBeenCalledWith({ asOf })
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({ moduleId: 'etf-flows', ruleId: 'etf-outflow-3d', asset: 'btc', severity: 'medium', readiness: 'available' })
    // 信号描述的是流水所属的交易日，不是这次读取发生的时刻。
    expect(signals[0]).toMatchObject({ observedAt: `${day(2)}T00:00:00.000Z` })
    expect(isModuleSignal(signals[0])).toBe(true)

    // 同一交易日再读一次：还是那一条，去重键不变——不会因为读了两遍就多出一次信号。
    const again = await createEtfOutflowSignalQuery({ readSnapshot }).query({ asOf }).then(entries => entries.map(entry => entry.signal))
    expect(again.filter(signal => signal.asset === 'btc')).toHaveLength(1)
    expect(again.map(signal => signal.dedupeKey)).toEqual(signals.map(signal => signal.dedupeKey))
  })

  it('says the window is not complete instead of calling two days a three-day reading', async () => {
    const signals = await createEtfOutflowSignalQuery({
      readSnapshot: async () => snapshot([-40_000_000, -50_000_000], [-40_000_000, -50_000_000])
    }).query({ asOf }).then(entries => entries.map(entry => entry.signal))

    expect(signals).toHaveLength(2)
    expect(signals.every(signal => signal.readiness === 'unavailable')).toBe(true)
    // 两天的和可以带着，但分母必须说 2/3：把两天写成「三日」才是错的。
    expect(signals.every(signal => signal.values.coveredDays === 2 && signal.values.requiredDays === 3)).toBe(true)
  })

  it('turns a failed read into unavailable signals, never into a quiet market', async () => {
    const signals = await createEtfOutflowSignalQuery({
      readSnapshot: async () => { throw new Error('store down') }
    }).query({ asOf }).then(entries => entries.map(entry => entry.signal))

    expect(signals).toHaveLength(2)
    expect(signals.every(signal => signal.readiness === 'unavailable')).toBe(true)
    expect(signals.every(signal => signal.values.coveredDays === 0)).toBe(true)
  })

  it('reports an unavailable ETF snapshot as unreadable, not as silence', async () => {
    const signals = await createEtfOutflowSignalQuery({
      readSnapshot: async () => ({ state: 'available', asOf, etf: { state: 'unavailable' }, coreStablecoins: {}, conclusion: 'unavailable' } as never)
    }).query({ asOf }).then(entries => entries.map(entry => entry.signal))

    expect(signals).toHaveLength(2)
    expect(signals.every(signal => signal.readiness === 'unavailable')).toBe(true)
  })
})

describe('the window travels with the signal', () => {
  it('gives each leg its own rule window, never a default', async () => {
    const oi = await createOpenInterestSignalQuery({
      readHistory: async () => ({
        state: 'available', asOf, window: '24h', btc: [], eth: [],
        liquidationHints: [{ observedAt: '2026-10-31T14:30:00.000Z', asset: 'btc' as const, direction: 'long' as const, dropPct: -2.6, volumeMultiple: 3.2, notionalUsd: 7.4e9 }],
        liquidationHintsState: 'available' as const
      })
    }).query({ asOf })
    expect(oi[0]!.window).toEqual({ unit: 'buckets', amount: 1, bucketMs: 15 * 60 * 1_000, upperBoundMs: 15 * 60 * 1_000 })

    const etf = await createEtfOutflowSignalQuery({
      readSnapshot: async () => ({ state: 'unavailable', reason: 'store-error' } as never)
    }).query({ asOf })
    // Even an unreadable snapshot keeps the rule's own window: the chip says which period it failed
    // to read, and a default window would quietly change that sentence.
    expect(etf.length).toBeGreaterThan(0)
    expect(etf.every(entry => entry.window.unit === 'trading-days' && entry.window.amount === 3)).toBe(true)
  })

  it('drops a signal whose cadence cannot express the rule amount instead of inventing a window', async () => {
    const broken = [{ version: '1', moduleId: 'open-interest' as const, ruleId: 'oi-liquidation-proxy', asset: 'btc' as const, severity: 'high' as const, observedAt: asOf, cadence: { kind: 'intraday' as const, bucketMs: 0 }, values: {}, dedupeKey: 'k', readiness: 'available' as const, triggerOwner: 'module-signal' as const }]
    expect(withRuleWindow(broken, 1)).toEqual([])
  })
})
