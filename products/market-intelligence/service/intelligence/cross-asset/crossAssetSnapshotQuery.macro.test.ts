import { describe, expect, it } from 'vitest'

import { parseCrossAssetSnapshot } from '../../../contracts/crossAssetObservationContracts'
import { createCrossAssetSnapshotQuery } from './crossAssetSnapshotQuery'

/**
 * The dollar and gold lines inside the cross-asset snapshot.
 *
 * They are read from the macro store rather than from the cross-asset one: another database, another
 * cadence, and — unlike the three crypto rows — a history assembled from several time frames, which is
 * why the lines are anchored on the window start and then read as the last close at or before each
 * instant. What this file pins is the wiring: the field appears when the macro store is handed in, it
 * is absent when it is not, and what it carries survives the wire contract.
 */
const STEP = 300_000
const hour = 3_600_000
const nowMs = Date.UTC(2026, 9, 15, 12, 0, 0)
const windowStartMs = nowMs - 12 * STEP

/** Five-minute closes over the last day, ending on the analysis instant. */
const macroSeries = (endMs: number, startValue: number) =>
  Array.from({ length: 289 }, (_, index) => ({ atMs: endMs - (288 - index) * STEP, value: startValue + index / 100 }))

function snapshot(input: Readonly<{
  range?: '1h' | '24h' | '7d'
  asOf?: string
  macroSeries?: (seriesId: string, fromMs: number, toMs: number) => readonly { atMs: number; value: number }[]
}>) {
  const query = createCrossAssetSnapshotQuery({
    now: () => nowMs,
    store: {
      revision: 1,
      queryAt: () => []
    } as never,
    // Every row's quote is stated, missing included: the snapshot's live overlay reads one per asset.
    live: () => ({ state: 'live', quotes: {
      index: { state: 'missing' }, btc: { state: 'missing' }, eth: { state: 'missing' }
    } }) as never,
    indexFeed: () => ({ state: 'pending' }) as never,
    ...(input.macroSeries ? { macroSeries: input.macroSeries } : {})
  })
  return query.query(input.asOf === undefined ? { range: input.range ?? '1h' } : { range: input.range ?? '1h', asOf: input.asOf })
}

describe('the macro lines in the cross-asset snapshot', () => {
  it('carries the dollar and gold on the crypto curves own grid, anchored at the window start', () => {
    const result = snapshot({
      macroSeries: (seriesId, fromMs, toMs) => {
        if (seriesId === 'dxy-real') return macroSeries(nowMs, 102)
        if (seriesId === 'xau-usd') return macroSeries(nowMs, 4100).filter((_, index) => index % 3 === 0)
        return []
      }
    })

    expect(result.macroCurves?.dxy).toHaveLength(13)
    expect(result.macroCurves?.gold).toHaveLength(13)
    expect(result.macroCurves?.dxy[0]).toEqual({ at: new Date(windowStartMs).toISOString(), returnPercent: 0 })
    // Gold is stored every fifteen minutes here: the hourly-adjacent instants carry the last close, so
    // the line exists rather than turning into a dashed one over history that is really there.
    expect(result.macroCurves?.gold.every(point => point.returnPercent !== null)).toBe(true)
    // The same wire contract the renderer validates, on the same grid as the crypto curves.
    expect(parseCrossAssetSnapshot(structuredClone(result))).toBeDefined()
    expect(result.curves.index).toHaveLength(13)
  })

  it('satisfies the wire contract on the seven-day range, where the window and the return anchor differ', () => {
    // Eight days of hourly closes: a week-long window needs a base before it opens, which is exactly the
    // case the seven-day range exists for.
    const hourly = Array.from({ length: 192 }, (_, index) => ({ atMs: nowMs - (191 - index) * hour, value: 102 + index / 100 }))
    const result = snapshot({ range: '7d', macroSeries: (seriesId) => seriesId === 'dxy-real' ? hourly : [] })

    // The contract's own window: seven days, endpoints inclusive. A main process that opened it one
    // interval early produced a snapshot the renderer refused — the whole block, not just one line.
    expect(result.curves.index).toHaveLength(169)
    expect(Date.parse(result.analysisEnd) - Date.parse(result.windowStart)).toBe(2016 * STEP)
    expect(result.macroCurves?.dxy).toHaveLength(169)
    expect(parseCrossAssetSnapshot(structuredClone(result))).toBeDefined()
  })

  it('sends no macro lines at all when this build has no macro store to read', () => {
    const result = snapshot({})
    expect(result.macroCurves).toBeUndefined()
    expect(parseCrossAssetSnapshot(structuredClone(result))).toBeDefined()
  })

  it('draws nothing for a line whose series cannot anchor the window', () => {
    const result = snapshot({
      // Gold's history begins inside the window: there is no base before it, and a line that started
      // mid-window would not be on the same anchor as the rows it is compared with.
      macroSeries: (seriesId, fromMs, toMs) => seriesId === 'xau-usd'
        ? [{ atMs: windowStartMs + 2 * hour, value: 4100 }, { atMs: toMs, value: 4110 }]
        : []
    })
    expect(result.macroCurves?.gold).toEqual([])
    expect(parseCrossAssetSnapshot(structuredClone(result))).toBeDefined()
  })
})

/**
 * 跨市场判读在快照里的接线（设计 142）。
 *
 * 这里只钉"取数来源"和"拒绝时说清是哪条腿"：四条腿分别来自宏观曲线与已闭合 24h 收益，因此本文件的
 * 夹具（没有加密 K 线）恰好能证明宏观两条腿确实是从曲线上读来的——若非如此，先缺的会是美元而不是纳指。
 */
describe('the cross-market reading in the snapshot', () => {
  const fullMacro = (seriesId: string) => seriesId === 'dxy-real' ? macroSeries(nowMs, 102)
    : seriesId === 'xau-usd' ? macroSeries(nowMs, 4100) : []

  it('takes the macro legs from the curves, and names the first leg that has no value', () => {
    expect(snapshot({ range: '24h', macroSeries: fullMacro }).reading)
      .toEqual({ state: 'undetermined', reason: 'legs-missing', leg: 'index', refuted: [] })
  })

  it('refuses when the macro reader is absent, starting with the dollar', () => {
    const result = snapshot({ range: '24h' })
    expect(result.macroCurves).toBeUndefined()
    expect(result.reading).toEqual({ state: 'undetermined', reason: 'legs-missing', leg: 'dxy', refuted: [] })
  })

  it('judges nothing outside 24h and states no reading at all for a past instant', () => {
    expect(snapshot({ range: '1h', macroSeries: fullMacro }).reading)
      .toEqual({ state: 'undetermined', reason: 'window-not-judged', refuted: [] })
    // 历史快照回答"当时图长什么样"，判读是关于"现在"的陈述：过去不发明一个。
    expect(snapshot({ range: '24h', asOf: new Date(nowMs - 6 * hour).toISOString(), macroSeries: fullMacro }))
      .not.toHaveProperty('reading')
  })
})
