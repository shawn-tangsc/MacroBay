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
  '10201': { metricKey: 'HK.REAL_GDP.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度实际GDP(年率)初值
  '10203': { metricKey: 'HK.REAL_GDP.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度实际GDP(年率)终值
  '4164': { metricKey: 'HK.THREE_MONTH_UNEMPLOYMENT.NONE.RATE', periodRule: 'month' },  // 2 行 · 至9月的三个月失业率 | 至10月的三个月失业率
  '9649': { metricKey: 'HK.FOREIGN_EXCHANGE_RESERVES.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 9月外汇储备(十亿美元) | 10月外汇储备(十亿美元)
  '9650': { metricKey: 'HK.IMPORTS.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月进口(年率) | 10月进口(年率)
  '9651': { metricKey: 'HK.EXPORTS.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月出口(年率) | 10月出口(年率)
  '9652': { metricKey: 'HK.MONEY_SUPPLY_M3.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月货币供给M3(年率) | 10月货币供给M3(年率)
  '9653': { metricKey: 'HK.RETAIL_SALES.NONE.YOY', periodRule: 'month' },  // 2 行 · 8月零售销售量(年率) | 9月零售销售量(年率)
  '9654': { metricKey: 'HK.RETAIL_SALES.NONE.YOY', periodRule: 'month' },  // 2 行 · 8月零售销售额(年率) | 9月零售销售额(年率)
  '9814': { metricKey: 'HK.COMPOSITE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月综合消费者物价指数(年率) | 10月综合消费者物价指数(年率)
})
