import { describe, expect, it, vi } from 'vitest'
import { createCrossAssetSnapshotQuery } from './crossAssetSnapshotQuery'

const now = Date.parse('2026-09-14T12:00:00.000Z')
const histories = (symbol: string) => Array.from({ length: 289 }, (_, index) => ({
  symbol, barOpenMs: now - (289 - index) * 300_000, barEndMs: now - (288 - index) * 300_000,
  open: '100', high: '110', low: '90', close: String(100 + index / 100), volume: '1'
}))
/**
 * A store with no licensed-index history, which is the world this file already described: the index
 * row is answered by the tokenised proxy and its live quote reaches the snapshot. The real leg's own
 * cases live in `crossAssetSnapshotQuery.index.test.ts`.
 */
const binanceOnly = (input: { symbol: string; asOfMs: number }) =>
  input.symbol === 'USTEC' ? [] : histories(input.symbol).filter(bar => bar.barEndMs <= input.asOfMs)
const setup = () => {
  let clock = now
  let revision = 1
  const queryAt = vi.fn(binanceOnly)
  const live = vi.fn(() => ({ state: 'live', quotes: { index: { state: 'live', price: '103', tradedAtMs: now, receivedAtMs: now },
    btc: { state: 'missing' }, eth: { state: 'missing' } } }))
  const query = createCrossAssetSnapshotQuery({ now: () => clock, store: { get revision() { return revision }, queryAt }, live })
  return { query, queryAt, live, setNow: (value: number) => { clock = value }, bumpRevision: () => { revision++ } }
}

describe('cross-asset bounded snapshot query', () => {
  it('projects admitted tick precision without exposing metadata or guessing missing precision', () => {
    const { query, live } = setup()
    live.mockReturnValue({ state: 'live', priceDecimals: { index: 2, btc: 1, eth: 2 }, quotes: {
      index: { state: 'live', price: '103.10000', tradedAtMs: now, receivedAtMs: now },
      btc: { state: 'missing' }, eth: { state: 'missing' }
    } } as never)
    expect(query.query({ range: '1h' }).quotes?.index).toMatchObject({ price: '103.10' })
    expect(query.query({ range: '1h' })).not.toHaveProperty('priceDecimals')
  })

  it('projects a current unclosed tail from a fresh trade without changing closed curves or metrics', () => {
    const { query, setNow, live } = setup()
    setNow(now + 1000)
    live.mockReturnValue({ state: 'live', quotes: { index: { state: 'live', price: '103', tradedAtMs: now + 1000, receivedAtMs: now + 1000 }, btc: { state: 'missing' }, eth: { state: 'missing' } } })
    const current = query.query({ range: '1h' })
    const closed = query.query({ range: '1h', asOf: new Date(now).toISOString() })
    expect(current.forming?.index).toEqual({ at: new Date(now + 1000).toISOString(), returnPercent: expect.closeTo(100 * (103 / 102.76 - 1)) })
    expect(current.forming?.btc).toBeNull()
    expect(current.curves).toEqual(closed.curves)
    expect(current.closedReturns).toEqual(closed.closedReturns)
    expect(closed).not.toHaveProperty('forming')
    expect(query.query({ range: '7d' }).forming).toEqual({ index: null, btc: null, eth: null })
    setNow(now + 16_001)
    expect(query.query({ range: '1h' }).forming?.index).toBeNull()
  })

  it('only emits current observation facts with live quotes and complete one-hour history', () => {
    const { query, live, setNow } = setup()
    const quote = { state: 'live', price: '103', tradedAtMs: now, receivedAtMs: now }
    live.mockReturnValue({ state: 'live', quotes: { index: quote, btc: quote, eth: quote } })
    expect(query.query({ range: '24h' }).observationKey).toEqual({ indexBtc: 'mixed', ethBtc: 'flat' })
    live.mockReturnValue({ state: 'disabled', quotes: { index: quote, btc: quote, eth: quote } })
    expect(query.query({ range: '24h' }).observationKey).toEqual({ indexBtc: 'unavailable', ethBtc: 'unavailable' })
    live.mockReturnValue({ state: 'live', quotes: { index: quote, btc: quote, eth: quote } })
    setNow(now + 15_001)
    expect(query.query({ range: '24h' }).observationKey.indexBtc).toBe('unavailable')
    expect(query.query({ range: '24h', asOf: new Date(now).toISOString() }).observationKey.indexBtc).toBe('unavailable')
  })
  it('expires missing endpoints after 90 seconds without rebuilding cached closed analysis', () => {
    let clock = now
    const read = vi.fn(input => input.symbol === 'USTEC' ? [] : histories(input.symbol).slice(0, -1))
    const query = createCrossAssetSnapshotQuery({ now: () => clock, store: { revision: 1, queryAt: read },
      live: () => ({ state: 'stale', quotes: { index: { state: 'missing' }, btc: { state: 'missing' }, eth: { state: 'missing' } } }) })
    expect(query.query({ range: '1h' }).correlations.indexBtc).toMatchObject({ reason: 'missing' })
    clock += 90_001
    expect(query.query({ range: '1h' }).correlations.indexBtc).toMatchObject({ reason: 'stale' })
    expect(read).toHaveBeenCalledTimes(12)
  })

  it('does not accept dependency quote payloads with nonfinite values or private fields', () => {
    const { query, live } = setup()
    live.mockReturnValue({ state: 'live', quotes: { index: { state: 'live', price: 'Infinity', tradedAtMs: now, receivedAtMs: now },
      btc: { state: 'missing' }, eth: { state: 'missing' } } })
    expect(() => query.query({ range: '1h' })).toThrow('snapshot-unavailable')
  })
  it('isolates historical results from current quotes and connection health', () => {
    const { query, live } = setup()
    const snapshot = query.query({ range: '1h', asOf: new Date(now).toISOString() })
    expect(snapshot).toMatchObject({ schemaVersion: 1, mode: 'historical', range: '1h', analysisEnd: new Date(now).toISOString() })
    expect(snapshot).not.toHaveProperty('sourceState')
    expect(snapshot).not.toHaveProperty('quotes')
    expect(snapshot).not.toHaveProperty('forming')
    expect(live).not.toHaveBeenCalled()
    expect(snapshot.curves.index).toHaveLength(13)
  })

  it('caches closed analysis across ticks, invalidates by store revision or 5m boundary, and returns safe copies', () => {
    const { query, queryAt, setNow, bumpRevision } = setup()
    const first = query.query({ range: '24h' })
    expect(first.mode).toBe('current')
    expect(queryAt).toHaveBeenCalledTimes(12)
    first.curves.index.length = 0
    setNow(now + 1000)
    expect(query.query({ range: '24h' }).curves.index).toHaveLength(289)
    expect(queryAt).toHaveBeenCalledTimes(12)
    bumpRevision()
    query.query({ range: '24h' })
    expect(queryAt).toHaveBeenCalledTimes(24)
    setNow(now + 300_000)
    query.query({ range: '24h' })
    expect(queryAt).toHaveBeenCalledTimes(36)
  })

  it('bounds store windows, validates inputs before touching dependencies, and never caches historical asOf', () => {
    const { query, queryAt, live } = setup()
    expect(() => query.query({ range: '1h', url: 'forbidden' } as never)).toThrow('invalid-query')
    expect(queryAt).not.toHaveBeenCalled()
    expect(live).not.toHaveBeenCalled()
    const input = { range: '7d' as const, asOf: new Date(now).toISOString() }
    query.query(input); query.query(input)
    expect(queryAt).toHaveBeenCalledTimes(24)
    // No single read may exceed the store's own cap; the 7d horizon is tiled by several of them.
    for (const [request] of queryAt.mock.calls) expect(request.toMs - request.fromMs).toBeLessThan(2017 * 300_000)
  })
})
