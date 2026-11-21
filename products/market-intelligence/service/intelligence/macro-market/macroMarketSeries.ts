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
 * 国债档位：3 个月、2 年、5 年、10 年、30 年，加上 10 年期实际利率（TIPS）与 10 年期通胀补偿
 * （盈亏平衡）。键是供应商的序列代码，值是落库用的品种名；映射在 `fredRatesHistory` 里被逐日解析。
 *
 * **历史长度不是缺陷，是各自的开端**：3M 从 1982 年、2Y 从 1976 年、5Y 从 1962 年、10Y 从 1962 年
 * 有连续日值，而 30Y 要到 1977 年才开始——20Y（DGS20）1993 年才有、2012–2020 还停发过，本产品没有
 * 采集它。所以同一张图上拉长历史时，长端会先断档：那是序列自己的历史，不是丢数，不要拿短端的连续
 * 去要求长端。缺的那天照旧**没有行**，不补 0、不插值。
 */
export const macroMarketRatesSeries = Object.freeze({
  DGS3MO: 'ust-3m', DGS2: 'ust-2y', DGS5: 'ust-5y', DGS10: 'ust-10y', DGS30: 'ust-30y',
  DFII10: 'ust-10y-real', T10YIE: 'ust-10y-breakeven'
} as const)

export const macroMarketBarSeriesIds: readonly string[] = Object.freeze(Object.values(macroMarketBarSeries))

export const macroMarketRatesSeriesIds: readonly string[] = Object.freeze(Object.values(macroMarketRatesSeries))