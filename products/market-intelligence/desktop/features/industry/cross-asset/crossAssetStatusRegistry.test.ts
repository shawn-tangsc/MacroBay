import { describe, expect, it } from 'vitest'
import type { MacroMarketSnapshotReading } from '../../../../contracts/macro/macroMarketSnapshotContracts'
import { macroMarketSnapshotPublicPolicy } from '../../../../contracts/macro/macroMarketSnapshotContracts'
import {
  crossAssetMacroReading, crossAssetMacroSeriesIds, crossAssetStatusRows, plannedCrossAssetStatusIds, resolveCrossAssetStatusRows
} from './crossAssetStatusRegistry'

const reading = (seriesId: string, extra: Partial<MacroMarketSnapshotReading> = {}): MacroMarketSnapshotReading =>
  ({ seriesId, level: 101.42, atMs: 1, returns: { '15m': 0.1 }, ...extra })
const shape = (readings: MacroMarketSnapshotReading[]): string[] =>
  resolveCrossAssetStatusRows(readings).map(row => `${row.id}:${row.state}`)

describe('cross-asset status rows', () => {
  it('reads the macro drivers first, then the assets they move', () => {
    expect(crossAssetStatusRows.map(row => row.id)).toEqual(['dxy', 'gold', 'us10y', 'realRate', 'index', 'btc', 'eth'])
  })

  it('names the macro series that may fill a row, best candidate first', () => {
    expect(crossAssetMacroSeriesIds).toEqual({ dxy: ['dxy-real', 'dxy-synthetic'], gold: ['xau-usd'] })
    expect(crossAssetMacroSeriesIds.dxy).toEqual([...macroMarketSnapshotPublicPolicy.dollarIndexPreference])
    expect(crossAssetMacroSeriesIds.gold).not.toContain(macroMarketSnapshotPublicPolicy.series.dollarIndexReal)
  })

  it('promotes the dollar row from either candidate, and never from another symbol', () => {
    expect(shape([reading('dxy-real'), reading('xau-usd')])).toEqual([
      'dxy:connected', 'gold:connected', 'us10y:planned', 'realRate:planned', 'index:connected', 'btc:connected', 'eth:connected'
    ])
    expect(shape([reading('dxy-synthetic')])[0]).toBe('dxy:connected')
  })

  it('promotes the dollar and gold rows only when their series has a reading', () => {
    expect(shape([reading('dxy-synthetic'), reading('xau-usd')])).toEqual([
      'dxy:connected', 'gold:connected', 'us10y:planned', 'realRate:planned', 'index:connected', 'btc:connected', 'eth:connected'
    ])
    expect(shape([reading('dxy-synthetic')])).toEqual([
      'dxy:connected', 'gold:planned', 'us10y:planned', 'realRate:planned', 'index:connected', 'btc:connected', 'eth:connected'
    ])
    // A series the table does not show cannot promote either row back into a figure.
    expect(shape([reading('usd-cnh'), reading('usdt-usd')])).toEqual([
      'dxy:planned', 'gold:planned', 'us10y:planned', 'realRate:planned', 'index:connected', 'btc:connected', 'eth:connected'
    ])
  })

  it('promotes the two rate rows only from their own daily series', () => {
    const rates = (...seriesIds: string[]): string[] =>
      resolveCrossAssetStatusRows([], seriesIds.map(seriesId => ({ seriesId }))).map(row => `${row.id}:${row.state}`)

    expect(rates('DGS10', 'DFII10')).toEqual([
      'dxy:planned', 'gold:planned', 'us10y:connected', 'realRate:connected', 'index:connected', 'btc:connected', 'eth:connected'
    ])
    expect(rates('DGS10')).toEqual([
      'dxy:planned', 'gold:planned', 'us10y:connected', 'realRate:planned', 'index:connected', 'btc:connected', 'eth:connected'
    ])
    // The 2Y and the breakeven are context, not readings for either row.
    expect(rates('DGS2', 'T10YIE')).toEqual([
      'dxy:planned', 'gold:planned', 'us10y:planned', 'realRate:planned', 'index:connected', 'btc:connected', 'eth:connected'
    ])
    // A dollar series never fills a rate row, and the default call stays the no-data list.
    expect(rates('dxy-synthetic')).toEqual([
      'dxy:planned', 'gold:planned', 'us10y:planned', 'realRate:planned', 'index:connected', 'btc:connected', 'eth:connected'
    ])
    expect(shape([reading('dxy-synthetic')])).toEqual(resolveCrossAssetStatusRows([reading('dxy-synthetic')]).map(row => `${row.id}:${row.state}`))
  })

  it('reproduces the no-data list exactly when the snapshot is empty or unavailable', () => {
    expect(resolveCrossAssetStatusRows([])).toEqual(crossAssetStatusRows)
    expect(plannedCrossAssetStatusIds).toEqual(['dxy', 'gold', 'us10y', 'realRate'])
    expect(crossAssetStatusRows.filter(row => row.state === 'connected').map(row => row.id)).toEqual(['index', 'btc', 'eth'])
  })

  it('is frozen, so a row cannot be flipped to connected without touching the registry', () => {
    expect(Object.isFrozen(crossAssetStatusRows)).toBe(true)
    expect(crossAssetStatusRows.every(Object.isFrozen)).toBe(true)
    const resolved = resolveCrossAssetStatusRows([reading('dxy-synthetic')])
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(resolved.every(Object.isFrozen)).toBe(true)
  })
})

/**
 * The three states the dollar row can be in, and the one rule that keeps them honest: the licensed
 * index when it is arriving, the product's own synthesis — label and all — when it is not, and no
 * level at all when neither is stored. The threshold is the wire's, so the renderer and the main
 * process cannot disagree about which of the two the reader is looking at.
 */
/**
 * 美元那一行取哪条读数（读者 2026-10-17「这个美元这里怎么还有合成字样」）。
 *
 * 线上每条快照只带**一条**美元读数——主进程已经按"兜底不能比被替换的那条更旧"选好了。所以这一层
 * 不再自带一份新鲜度规则（它以前重复了主进程那条，还会在真实那条过期时把整行判成没有读数）；两条都在
 * 时它只做一件事：取更新的一条。
 */
describe('the dollar row reading', () => {
  const asOf = Date.UTC(2026, 9, 14, 12, 0)
  const freshnessMs = macroMarketSnapshotPublicPolicy.dollarIndexFreshnessMs
  const real = (atMs: number) => reading('dxy-real', { level: 102.237, atMs })
  const synthetic = (atMs = asOf) => reading('dxy-synthetic', { level: 101.42, atMs, synthetic: true })

  it('takes the licensed index and never labels it as computed', () => {
    const chosen = crossAssetMacroReading([real(asOf - 60_000)], 'dxy')
    expect(chosen?.seriesId).toBe('dxy-real')
    expect(chosen?.level).toBe(102.237)
    expect(chosen?.synthetic).toBeUndefined()
  })

  it('keeps showing the licensed index after it aged out — the weekend case', () => {
    // 周末 FX 收盘：真实那条的最后一根是周五，合成那条两天前就停了。显示真实那条，不带合成标签。
    const stale = real(asOf - 6 * 60 * 60_000)
    const older = synthetic(asOf - 2 * 24 * 60 * 60_000)
    expect(crossAssetMacroReading([stale, older], 'dxy')).toBe(stale)
    // 只有真实一条（快照的正常形状）也一样：不许因为"旧"就把整行判成没有读数。
    expect(crossAssetMacroReading([real(asOf - freshnessMs - 1)], 'dxy')?.seriesId).toBe('dxy-real')
  })

  it('takes the synthesis only while it is the newer of the two', () => {
    const newer = synthetic()
    expect(crossAssetMacroReading([real(asOf - 30 * 60_000), newer], 'dxy')).toBe(newer)
    // 反过来（合成更旧）就留真实那条：回退到一个更旧的值不叫回退。
    expect(crossAssetMacroReading([real(asOf - 60_000), synthetic(asOf - 30 * 60_000)], 'dxy')?.seriesId).toBe('dxy-real')
  })

  it('takes the synthesis when there is no licensed reading at all, and nothing when neither exists', () => {
    const onlySynthetic = synthetic()
    expect(crossAssetMacroReading([onlySynthetic], 'dxy')).toBe(onlySynthetic)
    expect(crossAssetMacroReading([reading('usd-cnh'), reading('usdt-usd')], 'dxy')).toBeUndefined()
  })

  it('leaves gold, the series it does not own, exactly where it was', () => {
    expect(crossAssetMacroReading([reading('xau-usd', { level: 3412.55 })], 'gold')?.level).toBe(3412.55)
    expect(crossAssetMacroReading([real(asOf)], 'gold')).toBeUndefined()
  })

})
