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

/**
 * 国债四档：2 年期、10 年期、10 年期实际利率（TIPS）与 10 年期通胀补偿（盈亏平衡）。
 * 键是供应商的序列代码，值是落库用的品种名；映射在 `fredRatesHistory` 里被逐日解析。
 */
export const macroMarketRatesSeries = Object.freeze({
  DGS2: 'ust-2y', DGS10: 'ust-10y', DFII10: 'ust-10y-real', T10YIE: 'ust-10y-breakeven'
} as const)

export const macroMarketBarSeriesIds: readonly string[] = Object.freeze(Object.values(macroMarketBarSeries))

export const macroMarketRatesSeriesIds: readonly string[] = Object.freeze(Object.values(macroMarketRatesSeries))