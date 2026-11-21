import { describe, expect, it } from 'vitest'

import { macroMarketRatesSeries, macroMarketRatesSeriesIds, macroRateSeriesRegistry } from './macroMarketSeries'

/**
 * 国债曲线登记表：19 条序列，一条一行。
 *
 * 这张表是「采哪些、叫什么、从哪天开始、哪里有洞」的唯一出处——采集清单（`FRED_MACRO_SERIES`）与
 * 落库/读数（`macroMarketRatesSeries`、契约）都从它派生。所以这里先钉数量，再逐条钉名字与实测事实。
 */
describe('macro rate series registry', () => {
  it('registers the whole curve: eleven nominal, five real, three inflation series', () => {
    expect(macroRateSeriesRegistry).toHaveLength(19)
    const byKind = (kind: string) => macroRateSeriesRegistry.filter((entry) => entry.kind === kind).map((entry) => entry.providerSeriesId)
    expect(byKind('nominal')).toEqual([
      'DGS1MO', 'DGS3MO', 'DGS6MO', 'DGS1', 'DGS2', 'DGS3', 'DGS5', 'DGS7', 'DGS10', 'DGS20', 'DGS30'
    ])
    expect(byKind('real')).toEqual(['DFII5', 'DFII7', 'DFII10', 'DFII20', 'DFII30'])
    expect(byKind('inflation')).toEqual(['T5YIE', 'T10YIE', 'T5YIFR'])
  })

  it('names every series after the instrument, never after the provider', () => {
    const series = macroRateSeriesRegistry.map((entry) => entry.series)
    expect(new Set(series).size).toBe(series.length)
    expect(series).toEqual([
      'ust-1m', 'ust-3m', 'ust-6m', 'ust-1y', 'ust-2y', 'ust-3y', 'ust-5y', 'ust-7y', 'ust-10y', 'ust-20y', 'ust-30y',
      'ust-5y-real', 'ust-7y-real', 'ust-10y-real', 'ust-20y-real', 'ust-30y-real',
      'ust-5y-breakeven', 'ust-10y-breakeven', 'ust-5y5y-forward'
    ])
    expect(series.some((name) => /fred|dgs|dfii|t5y/i.test(name))).toBe(false)
    // 落库映射就是这张表的另一面，不多不少。
    expect(Object.keys(macroMarketRatesSeries)).toEqual(macroRateSeriesRegistry.map((entry) => entry.providerSeriesId))
    expect(macroMarketRatesSeriesIds).toEqual(series)
  })

  it('records each series\' own history start, measured against the provider', () => {
    const start = (providerSeriesId: string) => macroRateSeriesRegistry.find((entry) => entry.providerSeriesId === providerSeriesId)?.historyStart
    expect(start('DGS1MO')).toBe('2001-07-31')
    expect(start('DGS10')).toBe('1962-01-02')
    expect(start('DFII10')).toBe('2003-01-02')
    expect(start('DFII30')).toBe('2010-02-22')
    expect(start('T5YIFR')).toBe('2003-01-02')
    for (const entry of macroRateSeriesRegistry) {
      expect(entry.historyStart, entry.providerSeriesId).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isFinite(Date.parse(`${entry.historyStart}T00:00:00.000Z`))).toBe(true)
    }
  })

  it('records the one structural hole as a fact, and leaves the rest empty', () => {
    const withGap = macroRateSeriesRegistry.filter((entry) => entry.gap !== '')
    // 只有 20Y 有洞：1987 年初到 1993-09 没发 20 年，1993-10 恢复。缺的天没有行，不插值。
    expect(withGap.map((entry) => entry.providerSeriesId)).toEqual(['DGS20'])
    expect(withGap[0]?.gap).toContain('1986-12-31→1993-10-01')
  })

})
