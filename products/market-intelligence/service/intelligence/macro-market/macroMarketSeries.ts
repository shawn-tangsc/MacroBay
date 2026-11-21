/**
 * 宏观市场存储里的两族序列：分钟级行情（bar）与日频官方收盘。
 *
 * 名字一律用**品种**，不用供应商：`dxy-real` / `xau-usd` 本来就是这个规矩，而把供应商写进标识符
 * 会在换源时被迫改名，等于让同一条事实背上两个名字。来源记在记录自己的 `sourceId` 上。
 *
 * 两族的区别不是精度，是**保留期**：bar 按 `barRetentionPolicy` 折叠、超期删除；日频收盘是官方
 * 发布的一天一个点，整段历史就是它的价值，剪掉等于删数据。所以这张表放在存储旁边，由存储自己
 * 决定哪一族不剪，而不是让每个调用点各自记得传一个豁免名单。
 */
export const macroMarketBarSeries = Object.freeze({
  dollarIndex: 'dxy-synthetic', gold: 'xau-usd', offshoreYuan: 'usd-cnh', stablecoinPeg: 'usdt-usd',
  /** The licensed ICE index, written to this same store by the RealMarketAPI collector. */
  dollarIndexReal: 'dxy-real'
} as const)

export type MacroRateSeriesKind = 'nominal' | 'real' | 'inflation'

export type MacroRateSeriesRow = Readonly<{
  /** 供应商的序列代码。只用于取数，不进标识符。 */
  providerSeriesId: string
  /** 落库用的品种名（`ust-10y`），与 DXY、金价同一族命名。 */
  series: string
  /** 名义利率 / 实际利率（TIPS）/ 通胀预期。 */
  kind: MacroRateSeriesKind
  tenor: string
  /** 指标事件的键：分析、日历与面板按它指认一条事实。 */
  metricKey: string
  metricName: string
  /** FRED 上这一条的**第一个有值日**（2026-11-22 实测，不是估计）。 */
  historyStart: string
  /** 实测的结构性断档；空串＝除周末与假期外没有断档。 */
  gap: string
}>

/**
 * 国债曲线登记表——**一条序列一行**，品种名、期限、FRED 上的历史起点与断档都写在这一行里。
 *
 * 两条实测事实与常识不同，别按记忆改回去：
 * - **20Y 不是 1993 年才开始**：FRED 的 DGS20 从 1962-01-02 就有值，1987 年初到 1993-09 断了
 *   （2466 天），1993-10-01 恢复后一直连续到今。所以拉长窗口时它是「两段 + 中间一个洞」，
 *   不是「晚开始」。
 * - **30Y 在这条序列上没有断档**：DGS30 从 1977-02-15 起每年约 250 个值，2002–2006 那次停发在
 *   FRED 的日度序列里也是连续有值的（实测，不是推断）。
 *
 * 缺的那天照旧**没有行**：不补 0、不插值、不沿用前一天。断档是这一条自己的历史，不是丢数。
 *
 * 同一源扩了 12 条序列（7 → 19）：不是新数据源，`sourceCatalog` / `providerRegistry` 不动。
 */
export const macroRateSeriesRegistry: readonly MacroRateSeriesRow[] = Object.freeze([
  row('DGS1MO', 'ust-1m', 'nominal', '1M', 'US_1M_YIELD', 'US 1M Treasury Yield', '2001-07-31'),
  row('DGS3MO', 'ust-3m', 'nominal', '3M', 'US_3M_YIELD', 'US 3M Treasury Yield', '1981-09-01'),
  row('DGS6MO', 'ust-6m', 'nominal', '6M', 'US_6M_YIELD', 'US 6M Treasury Yield', '1981-09-01'),
  row('DGS1', 'ust-1y', 'nominal', '1Y', 'US_1Y_YIELD', 'US 1Y Treasury Yield', '1962-01-02'),
  row('DGS2', 'ust-2y', 'nominal', '2Y', 'US_2Y_YIELD', 'US 2Y Treasury Yield', '1976-06-01'),
  row('DGS3', 'ust-3y', 'nominal', '3Y', 'US_3Y_YIELD', 'US 3Y Treasury Yield', '1962-01-02'),
  row('DGS5', 'ust-5y', 'nominal', '5Y', 'US_5Y_YIELD', 'US 5Y Treasury Yield', '1962-01-02'),
  row('DGS7', 'ust-7y', 'nominal', '7Y', 'US_7Y_YIELD', 'US 7Y Treasury Yield', '1969-07-01'),
  row('DGS10', 'ust-10y', 'nominal', '10Y', 'US_10Y_YIELD', 'US 10Y Treasury Yield', '1962-01-02'),
  row('DGS20', 'ust-20y', 'nominal', '20Y', 'US_20Y_YIELD', 'US 20Y Treasury Yield', '1962-01-02',
    '1986-12-31→1993-10-01（2466 天）'),
  row('DGS30', 'ust-30y', 'nominal', '30Y', 'US_30Y_YIELD', 'US 30Y Treasury Yield', '1977-02-15'),
  row('DFII5', 'ust-5y-real', 'real', '5Y', 'US_5Y_REAL_YIELD', 'US 5Y Real Yield', '2003-01-02'),
  row('DFII7', 'ust-7y-real', 'real', '7Y', 'US_7Y_REAL_YIELD', 'US 7Y Real Yield', '2003-01-02'),
  row('DFII10', 'ust-10y-real', 'real', '10Y', 'US_REAL_YIELD_10Y', 'US 10Y Real Yield', '2003-01-02'),
  row('DFII20', 'ust-20y-real', 'real', '20Y', 'US_20Y_REAL_YIELD', 'US 20Y Real Yield', '2004-07-27'),
  row('DFII30', 'ust-30y-real', 'real', '30Y', 'US_30Y_REAL_YIELD', 'US 30Y Real Yield', '2010-02-22'),
  row('T5YIE', 'ust-5y-breakeven', 'inflation', '5Y', 'US_5Y_BREAKEVEN_INFLATION', 'US 5Y Breakeven Inflation', '2003-01-02'),
  row('T10YIE', 'ust-10y-breakeven', 'inflation', '10Y', 'US_10Y_BREAKEVEN_INFLATION', 'US 10Y Breakeven Inflation', '2003-01-02'),
  // 5 年 5 年远期通胀预期：FRED 用 TIPS 曲线算出来的，不是某一只 TIPS 的收盘。
  row('T5YIFR', 'ust-5y5y-forward', 'inflation', '5Y5Y', 'US_5Y5Y_FORWARD_INFLATION', 'US 5Y5Y Forward Inflation', '2003-01-02')
])

function row(
  providerSeriesId: string, series: string, kind: MacroRateSeriesKind, tenor: string,
  metricKey: string, metricName: string, historyStart: string, gap = ''
): MacroRateSeriesRow {
  return Object.freeze({ providerSeriesId, series, kind, tenor, metricKey, metricName, historyStart, gap })
}

/** 供应商代码 → 落库品种名。历史写入按这张映射逐日解析。 */
export const macroMarketRatesSeries: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(macroRateSeriesRegistry.map((entry) => [entry.providerSeriesId, entry.series]))
)

export const macroMarketBarSeriesIds: readonly string[] = Object.freeze(Object.values(macroMarketBarSeries))

export const macroMarketRatesSeriesIds: readonly string[] = Object.freeze(
  macroRateSeriesRegistry.map((entry) => entry.series)
)
