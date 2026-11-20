import type { ZeroXRouterPeriodRule } from '../marketCalendarMetricIdentity'

/**
 * 按国家拆开的「源内 id → 码」映射（HK）。**数据型注册表，纯声明**：一行一个源内身份。
 *
 * 只收期次可定、测度一致的映射；目标码必须存在于码表（守卫在索引里断）。
 */
export const mapping_HK: Readonly<Record<string, Readonly<{ metricKey: string; periodRule: ZeroXRouterPeriodRule }>>> = Object.freeze({
  '213652': { metricKey: 'HK.RETAIL_SALES.NONE.YOY', periodRule: 'month' },
  '213653': { metricKey: 'HK.RETAIL_SALES.NONE.YOY', periodRule: 'month' },
  '214103': { metricKey: 'HK.COMPOSITE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214241': { metricKey: 'HK.TRADE_BALANCE.NONE.LEVEL', periodRule: 'month' },
  '214242': { metricKey: 'HK.EXPORTS.NONE.YOY', periodRule: 'month' },
  '214243': { metricKey: 'HK.IMPORTS.NONE.YOY', periodRule: 'month' },
  '214330': { metricKey: 'HK.MONEY_SUPPLY_M3.NONE.YOY', periodRule: 'month' },
  '214407': { metricKey: 'HK.REAL_GDP.NONE.YOY', periodRule: 'month' },
  '214408': { metricKey: 'HK.RETAIL_SALES.NONE.YOY', periodRule: 'month' },
  '214409': { metricKey: 'HK.RETAIL_SALES.NONE.YOY', periodRule: 'month' },
  '214641': { metricKey: 'HK.REAL_GDP.NONE.YOY', periodRule: 'month' },
  '214805': { metricKey: 'HK.THREE_MONTH_UNEMPLOYMENT.NONE.RATE', periodRule: 'month' },
  '214937': { metricKey: 'HK.COMPOSITE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '215040': { metricKey: 'HK.TRADE_BALANCE.NONE.LEVEL', periodRule: 'month' },
  '215041': { metricKey: 'HK.EXPORTS.NONE.YOY', periodRule: 'month' },
  '215042': { metricKey: 'HK.IMPORTS.NONE.YOY', periodRule: 'month' },
})
