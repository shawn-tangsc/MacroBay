import type { ZeroXRouterPeriodRule } from '../marketCalendarMetricIdentity'

/**
 * 按国家拆开的「源内 id → 码」映射（SG）。**数据型注册表，纯声明**：一行一个源内身份。
 *
 * 只收期次可定、测度一致的映射；目标码必须存在于码表（守卫在索引里断）。
 */
export const mapping_SG: Readonly<Record<string, Readonly<{ metricKey: string; periodRule: ZeroXRouterPeriodRule }>>> = Object.freeze({
  '213708': { metricKey: 'SG.RETAIL_SALES.NONE.YOY', periodRule: 'month' },
  '213709': { metricKey: 'SG.RETAIL_SALES.SA.MOM', periodRule: 'month' },
  '213855': { metricKey: 'SG.GDP.NONE.YOY', periodRule: 'month' },
  '213856': { metricKey: 'SG.GDP.SA.QOQ', periodRule: 'quarter' },
  '213955': { metricKey: 'SG.OIL_EXPORTS.NONE.YOY', periodRule: 'month' },
  '213956': { metricKey: 'SG.PETROLEUM_PRODUCT_EXPORTS.SA.MOM', periodRule: 'month' },
  '214005': { metricKey: 'SG.GDP.NONE.YOY', periodRule: 'month' },
  '214006': { metricKey: 'SG.GDP.SA.QOQ', periodRule: 'quarter' },
  '214126': { metricKey: 'SG.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214169': { metricKey: 'SG.MONEY_SUPPLY_M1.NONE.YOY', periodRule: 'month' },
  '214170': { metricKey: 'SG.MONEY_SUPPLY_M2.NONE.YOY', periodRule: 'month' },
  '214175': { metricKey: 'SG.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },
  '214490': { metricKey: 'SG.RETAIL_SALES.NONE.YOY', periodRule: 'month' },
  '214491': { metricKey: 'SG.RETAIL_SALES.SA.MOM', periodRule: 'month' },
  '214536': { metricKey: 'SG.GDP.NONE.YOY', periodRule: 'month' },
  '214693': { metricKey: 'SG.INDUSTRIAL_OUTPUT.SA.MOM', periodRule: 'month' },
  '214694': { metricKey: 'SG.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },
  '214739': { metricKey: 'SG.RETAIL_SALES.SA.MOM', periodRule: 'month' },
  '214740': { metricKey: 'SG.RETAIL_SALES.NONE.YOY', periodRule: 'month' },
  '214797': { metricKey: 'SG.OIL_EXPORTS.NONE.YOY', periodRule: 'month' },
  '214798': { metricKey: 'SG.PETROLEUM_PRODUCT_EXPORTS.SA.MOM', periodRule: 'month' },
  '214953': { metricKey: 'SG.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
})
