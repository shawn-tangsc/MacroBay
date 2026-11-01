import { describe, expect, it, vi } from 'vitest'

import type { PositioningStoredBar } from '../store/perpetualPositioningStore'
import { queryOpenInterestHistoryAsync } from './openInterestHistoryQuery'

const asOf = '2026-10-29T00:00:00.000Z'
const asOfMs = Date.parse(asOf)

/** `count` closed 15m buckets ending one bucket before `asOf`, flat open interest. */
function rows(count: number, change?: (index: number, bar: PositioningStoredBar) => PositioningStoredBar): PositioningStoredBar[] {
  const start = asOfMs - count * 900_000
  return Array.from({ length: count }, (_, index) => {
    const bar: PositioningStoredBar = {
      observedAt: new Date(start + index * 900_000).toISOString(),
      notionalUsd: 8_000_000_000,
      volumeBase: 1_000,
      closePrice: 79_000
    }
    return change ? change(index, bar) : bar
  })
}

const store = (btc: readonly PositioningStoredBar[], eth: readonly PositioningStoredBar[] = btc) => ({
  read: vi.fn(async () => ({ state: 'available' as const, btc, eth }))
})

describe('open interest query', () => {
  it('folds a full week into one point per hour, stamped at the hour', async () => {
    const result = await queryOpenInterestHistoryAsync({ asOf, window: '7d', store: store(rows(672)) })
    if (result.state !== 'available') throw new Error('expected available')
    expect(result.btc.length).toBe(168)
    for (const point of result.btc) expect(point.observedAt.endsWith(':00.000Z')).toBe(true)
  })

  it('keeps the native 15-minute points on the 24-hour window', async () => {
    const result = await queryOpenInterestHistoryAsync({ asOf, window: '24h', store: store(rows(96)) })
    if (result.state !== 'available') throw new Error('expected available')
    expect(result.btc).toHaveLength(96)
    expect(result.btc.at(-1)!.observedAt).toBe(new Date(asOfMs - 900_000).toISOString())
  })

  it('reads one extra lookback so a liquidation can be judged at the window edge', async () => {
    const s = store(rows(672))
    await queryOpenInterestHistoryAsync({ asOf, window: '7d', store: s })
    expect(s.read).toHaveBeenCalledWith({ asOf, bars: 672 + 96 })
    await queryOpenInterestHistoryAsync({ asOf, window: '24h', store: s })
    expect(s.read).toHaveBeenLastCalledWith({ asOf, bars: 96 + 96 })
  })

  it('computes changes from native buckets, not from folded points', async () => {
    const withDrop = rows(672, (index, bar) => index === 671 ? { ...bar, notionalUsd: 7_840_000_000 } : bar)
    const result = await queryOpenInterestHistoryAsync({ asOf, window: '7d', store: store(withDrop) })
    if (result.state !== 'available') throw new Error('expected available')
    expect(result.change!.btc).toEqual({ h1Pct: -2, h24Pct: -2 })
  })

  it('omits a change whose reference bucket is missing instead of writing zero', async () => {
    const sparse = rows(672).filter(bar => Date.parse(bar.observedAt) !== asOfMs - 86_400_000 - 900_000)
    const result = await queryOpenInterestHistoryAsync({ asOf, window: '7d', store: store(sparse) })
    if (result.state !== 'available') throw new Error('expected available')
    expect(result.change!.btc.h24Pct).toBeUndefined()
    expect(result.change!.btc.h1Pct).toBeDefined()
  })

  it('marks a 15-minute collapse inside the window and keeps it out of the next one', async () => {
    const at = 500
    const collapse = rows(672, (index, bar) => index < at ? bar : index === at
      ? { ...bar, notionalUsd: 7_840_000_000, closePrice: 78_000, volumeBase: 3_000 }
      : bar)
    const weekly = await queryOpenInterestHistoryAsync({ asOf, window: '7d', store: store(collapse) })
    if (weekly.state !== 'available') throw new Error('expected available')
    expect(weekly.liquidationHintsState).toBe('available')
    expect(weekly.liquidationHints?.length).toBeGreaterThan(0)

    const daily = await queryOpenInterestHistoryAsync({ asOf, window: '24h', store: store(collapse) })
    if (daily.state !== 'available') throw new Error('expected available')
    expect(daily.liquidationHints).toBeUndefined()
  })

  it('reports marks unavailable when the volume leg is missing, without blanking the series', async () => {
    const halfVolume = rows(672, (index, bar) => index % 2 === 0 ? { ...bar, volumeBase: null, closePrice: null } : bar)
    const result = await queryOpenInterestHistoryAsync({ asOf, window: '7d', store: store(halfVolume) })
    if (result.state !== 'available') throw new Error('expected available')
    expect(result.liquidationHintsState).toBe('unavailable')
    expect(result.liquidationHints).toBeUndefined()
    expect(result.btc.length).toBe(168)
  })

  it('returns empty when the store has nothing', async () => {
    await expect(queryOpenInterestHistoryAsync({ asOf, window: '7d', store: { read: vi.fn(async () => ({ state: 'empty' as const })) } }))
      .resolves.toEqual({ state: 'empty', asOf, window: '7d' })
  })

  it('refuses a bad instant, a bad window, or an unusable store', async () => {
    const unavailable = { state: 'unavailable', failureCode: 'open-interest-history-query-unavailable' }
    await expect(queryOpenInterestHistoryAsync({ asOf: '2026-10-29 00:00', window: '7d', store: store([]) })).resolves.toEqual(unavailable)
    await expect(queryOpenInterestHistoryAsync({ asOf, window: '30d', store: store([]) })).resolves.toEqual(unavailable)
    await expect(queryOpenInterestHistoryAsync({ asOf, window: '7d', store: { read: vi.fn(async () => ({ state: 'unavailable' as const })) } })).resolves.toEqual(unavailable)
  })

  it('refuses a series that is not strictly ascending rather than sorting it', async () => {
    const broken = [...rows(24)].reverse()
    await expect(queryOpenInterestHistoryAsync({ asOf, window: '24h', store: store(broken) })).resolves.toEqual({
      state: 'unavailable', failureCode: 'open-interest-history-query-unavailable'
    })
  })

  it('stays inside the DTO byte budget', async () => {
    const result = await queryOpenInterestHistoryAsync({ asOf, window: '7d', store: store(rows(672)) })
    if (result.state !== 'available') throw new Error('expected available')
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(32 * 1024)
  })
})
