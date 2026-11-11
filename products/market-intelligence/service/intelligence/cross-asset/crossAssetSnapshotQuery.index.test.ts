import { describe, expect, it } from 'vitest'

import { createCrossAssetSnapshotQuery } from './crossAssetSnapshotQuery'
import type { CrossAssetIndexFeedState, CrossAssetLiveState } from './crossAssetIndexSource'

/**
 * The four states one Nasdaq 100 row can be in, read from the snapshot the panel is handed.
 *
 * The row **defaults to Binance's tokenised perpetual** (`QQQUSDT`): it streams, it never closes, and
 * it therefore answers with a live trade at any hour. The licensed Nasdaq 100 cash index (`USTEC`) is
 * the fallback, used only when that leg cannot answer — the source is switched off, the runtime is
 * unavailable, or no bar is stored for the contract. While the licensed index answers, a shut market is
 * a 休市 marker beside its last closed bar, never a reason to move the row again.
 */
const STEP = 300_000
const at = (iso: string) => Date.parse(iso)
const sessionOpenMs = at('2026-07-15T13:30:00.000Z') // 09:30 New York, summer
const sessionCloseMs = at('2026-07-15T20:00:00.000Z') // 16:00 New York
/** 22:00 New York: the cash market is shut while the perpetual keeps printing. */
const overnightMs = at('2026-07-16T02:00:00.000Z')
const bar = (symbol: string, barOpenMs: number, close: number) => ({
  symbol, barOpenMs, barEndMs: barOpenMs + STEP, open: String(close), high: String(close + 1), low: String(close - 1), close: String(close), volume: '1'
})
const grid = (fromMs: number, toMsExclusive: number) => {
  const instants: number[] = []
  for (let atMs = fromMs; atMs < toMsExclusive; atMs += STEP) instants.push(atMs)
  return instants
}
/** The whole cash session, one bar every five minutes. */
const sessionBars = grid(sessionOpenMs, sessionCloseMs).map((atMs, index) => bar('USTEC', atMs, 25_000 + index))
/** Two consecutive sessions with the overnight gap between them, up to `untilMs`. */
const twoSessions = (untilMs: number) => [
  ...sessionBars,
  ...grid(sessionOpenMs + 24 * 3_600_000, untilMs).map((atMs, index) => bar('USTEC', atMs, 26_000 + index))
]
/** A contract that never closes: bar closes run over the whole 24 hours ending at `endMs`. */
const cryptoBars = (symbol: string, endMs: number) =>
  grid(endMs - 289 * STEP, endMs).map((atMs, index) => bar(symbol, atMs, 100 + index / 100))

const liveFixture = (atMs: number) => ({ state: 'live' as const, quotes: {
  index: { state: 'live' as const, price: '710.55', tradedAtMs: atMs, receivedAtMs: atMs },
  btc: { state: 'missing' as const }, eth: { state: 'missing' as const }
} })

function snapshot(input: Readonly<{
  nowMs: number; range?: '1h' | '24h' | '7d'; bySymbol: Record<string, readonly unknown[]>
  feed: CrossAssetIndexFeedState; liveState?: CrossAssetLiveState
  /** A cutoff turns the read into the historical mode the daily brief always asks in. */
  asOf?: string; knowledgeAt?: string
}>) {
  const query = createCrossAssetSnapshotQuery({
    now: () => input.nowMs,
    store: {
      revision: 1,
      queryAt: (request: { symbol: string; fromMs: number; toMs: number; asOfMs: number }) =>
        ((input.bySymbol[request.symbol] ?? []) as ReturnType<typeof bar>[])
          .filter(entry => entry.barOpenMs >= request.fromMs && entry.barOpenMs <= request.toMs && entry.barEndMs <= request.asOfMs)
    } as never,
    live: () => ({ ...liveFixture(input.nowMs), state: input.liveState ?? 'live' }),
    indexFeed: () => ({ state: input.feed })
  })
  return query.query({
    range: input.range ?? '1h',
    ...(input.asOf === undefined ? {} : { asOf: input.asOf, knowledgeAt: input.knowledgeAt ?? input.asOf })
  })
}

/** One contract's continuous history plus the licensed session, which the default must ignore. */
const bothLegs = (nowMs: number) => ({
  USTEC: sessionBars, QQQUSDT: cryptoBars('QQQUSDT', nowMs),
  BTCUSDT: cryptoBars('BTCUSDT', nowMs), ETHUSDT: cryptoBars('ETHUSDT', nowMs)
})

describe('cross-asset Nasdaq 100 row', () => {
  it('answers from the tokenised perpetual by default, at an hour when the cash market is shut', () => {
    const result = snapshot({ nowMs: overnightMs, range: '24h', feed: 'ready', bySymbol: bothLegs(overnightMs) })

    expect(result.indexSource).toBe('proxy')
    // The perpetual trades around the clock, so there is no closure to report — the label is what
    // keeps a synthetic from being read as the standard index.
    expect(result.marketState?.index).toBe('open')
    expect(result.quotes?.index).toMatchObject({ state: 'live', price: '710.55' })
    // Every window the stored history can answer is answered at any hour. This fixture holds one
    // day of bars, so 7d has no bar seven days back and stays a stated gap — which is the honest
    // answer here rather than a reason to fail the row.
    for (const window of ['5m', '15m', '1h', '4h', '24h'] as const) {
      expect(result.closedReturns.index[window].state, window).toBe('available')
    }
    expect(result.closedReturns.index['7d']).toEqual({ state: 'unavailable', reason: 'missing' })
    // The licensed leg's stored session is not the reading this row shows.
    expect(result.lastClosed?.index?.close).toBe(cryptoBars('QQQUSDT', overnightMs).at(-1)!.close)
  })

  it('hands the row to the licensed index when the Binance source is switched off', () => {
    const result = snapshot({ nowMs: overnightMs, range: '1h', feed: 'ready', liveState: 'disabled', bySymbol: bothLegs(overnightMs) })

    expect(result.indexSource).toBe('real')
    // 22:00 New York: the cash session has closed, so the row keeps its real value and says 休市 —
    // it does not flip back to the perpetual merely because the clock passed 16:00.
    expect(result.marketState?.index).toBe('closed')
    expect(result.lastClosed?.index).toEqual({ at: new Date(sessionCloseMs).toISOString(), close: String(25_000 + sessionBars.length - 1) })
    // The real index has no live tick, so the row must not borrow the perpetual's trade.
    expect(result.quotes?.index).toEqual({ state: 'missing' })
    expect(result.forming?.index).toBeNull()
    // 分析瞬时那一桶没有收盘（现货已收市）时，窗口**回退到库里最近一根已入库的完整桶**，
    // 而不是整排变成 `—`（Chief 2026-11-11）。`atMs` 就是那一根的时刻，能看出真的换了。
    for (const window of ['5m', '15m', '1h', '4h'] as const) {
      const metric = result.closedReturns.index[window]
      expect(metric.state, window).toBe('available')
      expect(metric.state === 'available' ? metric.atMs : undefined, window).toBe(new Date(sessionCloseMs).toISOString())
    }
    // 这一屏只有一段现货时段的量：24h/7d 的回看端真的没有收盘对 → 仍然不可用（与「还没落库」分开）。
    expect(result.closedReturns.index['24h']).toEqual({ state: 'unavailable', reason: 'missing' })
    expect(result.closedReturns.index['7d']).toEqual({ state: 'unavailable', reason: 'missing' })
  })

  it('hands the row to the licensed index when no bar is stored for the contract', () => {
    const result = snapshot({
      nowMs: at('2026-07-15T15:00:00.000Z'), range: '24h', feed: 'ready',
      bySymbol: { USTEC: sessionBars, BTCUSDT: cryptoBars('BTCUSDT', at('2026-07-15T15:00:00.000Z')), ETHUSDT: cryptoBars('ETHUSDT', at('2026-07-15T15:00:00.000Z')) }
    })

    expect(result.indexSource).toBe('real')
    expect(result.marketState?.index).toBe('open')
    expect(result.lastClosed?.index?.close).toBe(String(25_000 + 17))
    expect(result.closedReturns.index['1h'].state).toBe('available')
  })

  it('does not move the row for a transient stream state', () => {
    for (const liveState of ['connecting', 'stale', 'limited'] as const) {
      expect(snapshot({ nowMs: overnightMs, feed: 'ready', liveState, bySymbol: bothLegs(overnightMs) }).indexSource).toBe('proxy')
    }
  })

  it('follows a source change that happens without a single new bar', () => {
    const bySymbol = bothLegs(overnightMs)
    expect(snapshot({ nowMs: overnightMs, feed: 'ready', bySymbol }).indexSource).toBe('proxy')
    // Same revision, same instant, same bars: only the proxy leg's own health changed, and the cached
    // analysis may not keep answering from a leg that stopped answering.
    expect(snapshot({ nowMs: overnightMs, feed: 'ready', liveState: 'unavailable', bySymbol }).indexSource).toBe('real')
  })

  it('says 未接入 with no reading at all when neither leg can answer', () => {
    const result = snapshot({ nowMs: overnightMs, range: '1h', feed: 'unavailable', liveState: 'disabled', bySymbol: {} })

    expect(result.indexSource).toBe('unavailable')
    expect(result.marketState?.index).toBe('unavailable')
    expect(result.lastClosed?.index).toBeNull()
    expect(result.quotes?.index).toEqual({ state: 'missing' })
    expect(result.historyCoverage.index.count).toBe(0)
    // The row is not silently rebuilt from the other assets' bars.
    expect(result.curves.index.every(point => point.returnPercent === null)).toBe(true)
  })

  it('carries the last closed bar on a historical read too, which is the only read the brief makes', () => {
    // The daily brief always asks with a cutoff, so its snapshot is always historical. While this field
    // existed only in current mode the row had no level to print — missing for a structural reason, not
    // because the market had no bar. Same analytics, same source, written out in both modes now.
    const historical = snapshot({ nowMs: overnightMs, range: '24h', feed: 'ready', liveState: 'disabled',
      bySymbol: bothLegs(overnightMs), asOf: new Date(overnightMs).toISOString() })

    expect(historical.mode).toBe('historical')
    expect(historical.lastClosed?.btc).toEqual({ at: new Date(overnightMs).toISOString(), close: '102.88' })
    expect(historical.lastClosed?.eth?.close).toBe('102.88')
    // The index row states the leg that answered and the level that leg closed on — never a curve point.
    expect(historical.indexSource).toBe('proxy')
    expect(historical.lastClosed?.index?.close).toBe('102.88')
    // Current mode is unchanged: same field, same values, read by the panel.
    const current = snapshot({ nowMs: overnightMs, range: '24h', feed: 'ready', bySymbol: bothLegs(overnightMs) })
    expect(current.mode).toBe('current')
    expect(current.lastClosed?.index?.close).toBe('102.88')
  })

  it('leaves the closed stretch of the licensed curve empty instead of flattening the last value', () => {
    // The licensed fallback, 11:00 New York on its second day: the 24h window opens inside the previous
    // session, so the common anchor exists and the overnight closure sits in the *middle* of the curve.
    const nowMs = at('2026-07-16T15:00:00.000Z')
    const result = snapshot({
      nowMs, range: '24h', feed: 'ready', liveState: 'disabled',
      bySymbol: { USTEC: twoSessions(nowMs), BTCUSDT: cryptoBars('BTCUSDT', nowMs), ETHUSDT: cryptoBars('ETHUSDT', nowMs) }
    })

    expect(result.indexSource).toBe('real')
    const points = result.curves.index
    expect(points.some(point => point.returnPercent !== null)).toBe(true)
    const gap = points.filter(point => Date.parse(point.at) > sessionCloseMs && Date.parse(point.at) < sessionOpenMs + 24 * 3_600_000)
    expect(gap.length).toBeGreaterThan(100)
    // Every point in the closure is missing, and not one repeats the last value: that repetition is
    // exactly the fabricated flat line this row must never print.
    expect(new Set(gap.map(point => point.returnPercent))).toEqual(new Set([null]))
    // The next session draws again, so the line breaks and resumes rather than ending.
    expect(points.at(-1)?.returnPercent).not.toBeNull()
    expect(result.curves.btc.every(point => point.returnPercent !== null)).toBe(true)
  })

  it('reports a licensed window that opens inside the closed stretch as no reading at all', () => {
    const result = snapshot({
      nowMs: overnightMs, range: '24h', feed: 'ready', liveState: 'disabled',
      bySymbol: { USTEC: sessionBars, BTCUSDT: cryptoBars('BTCUSDT', overnightMs), ETHUSDT: cryptoBars('ETHUSDT', overnightMs) }
    })

    expect(result.indexSource).toBe('real')
    expect(result.marketState?.index).toBe('closed')
    expect(result.lastClosed?.index?.at).toBe(new Date(sessionCloseMs).toISOString())
    // The 24h window opens at 02:00 the previous day, when the index was shut, so the common anchor
    // does not exist. The curve is empty rather than rebased onto another instant: the row's value is
    // still the last close, and no point claims a return the index never printed.
    expect(result.curves.index.every(point => point.returnPercent === null)).toBe(true)
    expect(result.curves.btc.some(point => point.returnPercent !== null)).toBe(true)
  })
})
