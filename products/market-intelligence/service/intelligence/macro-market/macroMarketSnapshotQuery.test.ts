import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { macroMarketSnapshotPublicPolicy } from '../../../contracts/macro/macroMarketSnapshotContracts'
import { macroMarketPolicy } from './macroMarketPolicy'
import { createMacroMarketSnapshotQuery } from './macroMarketSnapshotQuery'
import { createMacroMarketStore } from './macroMarketStore'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
const at = (minute: number) => Date.UTC(2026, 9, 14, 6, minute)

describe('the macro-market snapshot', () => {
  it('reports levels and only the windows the stored points can answer', () => {
    const directory = mkdtempSync(join(tmpdir(), 'macro-snapshot-')); directories.push(directory)
    const store = createMacroMarketStore(join(directory, 'macro-market.sqlite'))
    const series = macroMarketPolicy.series
    store.append([
      { series: series.dollarIndex, atMs: at(0), value: 101, observedAtMs: at(0) },
      { series: series.dollarIndex, atMs: at(15), value: 101.5, observedAtMs: at(15) },
      { series: series.dollarIndex, atMs: at(45), value: 101.8, observedAtMs: at(45) },
      { series: series.dollarIndex, atMs: at(60), value: 102, observedAtMs: at(60) },
      { series: series.gold, atMs: at(60), value: 4155.5, observedAtMs: at(60) }
    ])
    store.note('lastRunAtMs', String(at(60)))
    store.note('lastPlan', 'dollar-basket')
    const snapshot = createMacroMarketSnapshotQuery({ store, now: () => at(60) }).snapshot()

    expect(snapshot.state).toBe('available')
    expect(snapshot.lastPlan).toBe('dollar-basket')
    const dollar = snapshot.readings.find(reading => reading.seriesId === series.dollarIndex)!
    expect(dollar.level).toBe(102)
    expect(dollar.synthetic).toBe(true)
    // 15m and 1h are answerable; the store is an hour long, so 4h, 24h and 7d have no bar far enough
    // back. Every one of them stays an absent key rather than the return since whenever the last bar
    // happened to land.
    expect(dollar.returns['15m']).toBeCloseTo((102 / 101.8 - 1) * 100, 6)
    expect(dollar.returns['1h']).toBeCloseTo((102 / 101 - 1) * 100, 6)
    expect(dollar.returns['4h']).toBeUndefined()
    expect(dollar.returns['7d']).toBeUndefined()
    expect(dollar.returns['24h']).toBeUndefined()
    // Gold has one point: a level, and no window it could honestly answer.
    const gold = snapshot.readings.find(reading => reading.seriesId === series.gold)!
    expect(gold.level).toBe(4155.5)
    expect(gold.returns).toEqual({})
    expect(gold.synthetic).toBeUndefined()
    expect(snapshot.caveats).toContain(macroMarketPolicy.caveats.syntheticDollarIndex)
    expect(snapshot.caveats).toContain(macroMarketPolicy.caveats.providerTimeSeries)
    store.close()
  })

  it('says empty rather than inventing a level, and drops the synthetic caveat with it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'macro-snapshot-')); directories.push(directory)
    const store = createMacroMarketStore(join(directory, 'macro-market.sqlite'))
    const snapshot = createMacroMarketSnapshotQuery({ store, now: () => at(0) }).snapshot()
    expect(snapshot).toMatchObject({ state: 'empty', readings: [] })
    expect(snapshot.caveats).not.toContain(macroMarketPolicy.caveats.syntheticDollarIndex)
    store.close()
  })

  /**
   * 美元行取哪一条（读者 2026-10-17「这个美元这里怎么还有合成字样」）。
   *
   * 真实 DXY 来自 RealMarketAPI（`dxy-real`），合成篮子是十二数据的兜底（`dxy-synthetic`，只有本产品
   * 还在收它的时候才会更新——读者 2026-10-14 起把它关掉了）。旧规则把"超过 15 分钟没更新"当成"没有"，
   * 于是周末（FX 收盘，真实那条最后一根是周五 20:55）行里显示的是**两天前**的合成值，还挂着「合成」。
   *
   * 现在的口径：**兜底不能比被替换的那条更旧**。真实那条只要有点就显示它（哪怕旧）；只有合成确实
   * 更新时才算回退。
   */
  const dollarOf = (rows: readonly { series: string; atMs: number; value: number }[], nowMs: number) => {
    const directory = mkdtempSync(join(tmpdir(), 'macro-snapshot-')); directories.push(directory)
    const store = createMacroMarketStore(join(directory, 'macro-market.sqlite'))
    store.append(rows.map(row => ({ ...row, observedAtMs: row.atMs })))
    const snapshot = createMacroMarketSnapshotQuery({ store, now: () => nowMs }).snapshot()
    const dollar = snapshot.readings.find(reading => reading.seriesId.includes('dxy'))
    store.close()
    return { dollar, snapshot }
  }

  it('shows the licensed index while it is fresh, and never labels it as computed', () => {
    const { dollar, snapshot } = dollarOf([
      { series: macroMarketPolicy.series.dollarIndexReal, atMs: at(0), value: 102.1 },
      { series: macroMarketPolicy.series.dollarIndexReal, atMs: at(60), value: 102.2 },
      { series: macroMarketPolicy.series.dollarIndex, atMs: at(0), value: 101 },
      { series: macroMarketPolicy.series.dollarIndex, atMs: at(60), value: 101.5 }
    ], at(60))
    expect(dollar).toMatchObject({ seriesId: macroMarketPolicy.series.dollarIndexReal, level: 102.2 })
    expect(dollar?.synthetic).toBeUndefined()
    // The computed caveat belongs to the computed level: it travels with the synthesis, not the row.
    expect(snapshot.caveats).not.toContain(macroMarketPolicy.caveats.syntheticDollarIndex)
  })

  it('keeps the licensed index when the synthesis is not newer — the weekend case', () => {
    // 真实那条停在周五收盘，篮子两天前就停了：显示真实那条（2026-10-17 的实况形状）。
    const { dollar, snapshot } = dollarOf([
      { series: macroMarketPolicy.series.dollarIndexReal, atMs: at(60), value: 101.773 },
      { series: macroMarketPolicy.series.dollarIndex, atMs: at(0), value: 102.03 }
    ], at(60) + 6 * 60 * 60_000)
    expect(dollar).toMatchObject({ seriesId: macroMarketPolicy.series.dollarIndexReal, level: 101.773 })
    expect(dollar?.synthetic).toBeUndefined()
    expect(snapshot.caveats).not.toContain(macroMarketPolicy.caveats.syntheticDollarIndex)
  })

  it('falls back to the synthesis only while it is newer than the licensed index', () => {
    // 真实那条停住（key 被吊销/源被关）、篮子还在更新：这才叫"回退"，而且回退到的是更新的一条。
    const { dollar, snapshot } = dollarOf([
      { series: macroMarketPolicy.series.dollarIndexReal, atMs: at(0), value: 101 },
      { series: macroMarketPolicy.series.dollarIndex, atMs: at(0), value: 101 },
      { series: macroMarketPolicy.series.dollarIndex, atMs: at(60), value: 102 }
    ], at(60) + macroMarketSnapshotPublicPolicy.dollarIndexFreshnessMs + 1)
    expect(dollar).toMatchObject({ seriesId: macroMarketPolicy.series.dollarIndex, level: 102, synthetic: true })
    expect(snapshot.caveats).toContain(macroMarketPolicy.caveats.syntheticDollarIndex)
  })

  it('shows the last licensed close rather than nothing when it aged out', () => {
    const { dollar, snapshot } = dollarOf([
      { series: macroMarketPolicy.series.dollarIndexReal, atMs: at(0), value: 102.1 }
    ], at(0) + 8 * 60 * 60_000)
    expect(snapshot.state).toBe('available')
    expect(dollar).toMatchObject({ seriesId: macroMarketPolicy.series.dollarIndexReal, level: 102.1 })
    expect(snapshot.caveats).not.toContain(macroMarketPolicy.caveats.syntheticDollarIndex)
  })

  it('normalises the live price into the string the wire contract admits, and drops a non-price', () => {
    const directory = mkdtempSync(join(tmpdir(), 'macro-snapshot-')); directories.push(directory)
    const store = createMacroMarketStore(join(directory, 'macro-market.sqlite'))
    store.append([{ series: macroMarketPolicy.series.gold, atMs: at(60), value: 4155.5, observedAtMs: at(60) }])
    const goldOf = (live: Parameters<typeof createMacroMarketSnapshotQuery>[0]['live']) =>
      createMacroMarketSnapshotQuery({ store, now: () => at(60), live }).snapshot()
        .readings.find(reading => reading.seriesId === macroMarketPolicy.series.gold)!
    // The price socket's own shape: a JSON number. The snapshot carries the decimal string, because
    // normalisation happens on this side of the product boundary and the wire shape is unchanged.
    const numeric = goldOf(() => ({ state: 'live', tick: { price: 4144.04708, atMs: at(60) } }))
    expect(numeric.live).toEqual({ state: 'live', price: '4144.04708', atMs: at(60) })
    expect(typeof numeric.live?.price).toBe('string')
    // A figure that is not a price is dropped rather than repaired: the level stands, the badge goes.
    for (const price of [0, -1, Number.NaN, '0', '-1', 'three thousand', '1.9e3', '1'.repeat(25)]) {
      const reading = goldOf(() => ({ state: 'live', tick: { price, atMs: at(60) } }))
      expect(reading.live).toBeUndefined()
      expect(reading.level).toBe(4155.5)
    }
    store.close()
  })
})
