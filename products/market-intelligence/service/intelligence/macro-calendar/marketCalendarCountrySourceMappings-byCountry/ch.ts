import type { ZeroXRouterPeriodRule } from '../marketCalendarMetricIdentity'

/**
 * 按国家拆开的「源内 id → 码」映射（CH）。**数据型注册表，纯声明**：一行一个源内身份。
 *
 * 只收期次可定、测度一致的映射；目标码必须存在于码表（守卫在索引里断）。
 */
export const mapping_CH: Readonly<Record<string, Readonly<{ metricKey: string; periodRule: ZeroXRouterPeriodRule }>>> = Object.freeze({
  '212384': { metricKey: 'CH.PRODUCER_IMPORTS_PRICE.NONE.MOM', periodRule: 'month' },
  '212385': { metricKey: 'CH.PRODUCER_IMPORTS_PRICE.NONE.YOY', periodRule: 'month' },
  '213617': { metricKey: 'CH.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '213618': { metricKey: 'CH.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '213619': { metricKey: 'CH.ACTUAL_RETAIL_SALES.NONE.YOY', periodRule: 'month' },
  '213620': { metricKey: 'CH.SVME_PURCHASING_MANAGERS.NONE.LEVEL', periodRule: 'month' },
  '213906': { metricKey: 'CH.PRODUCER_IMPORTS_PRICE.NONE.MOM', periodRule: 'month' },
  '213907': { metricKey: 'CH.PRODUCER_IMPORTS_PRICE.NONE.YOY', periodRule: 'month' },
  '214048': { metricKey: 'CH.EXPORTS.SA.MOM', periodRule: 'month' },
  '214049': { metricKey: 'CH.TRADE_BALANCE.NONE.LEVEL', periodRule: 'month' },
  '214050': { metricKey: 'CH.IMPORTS.SA.MOM', periodRule: 'month' },
  '214244': { metricKey: 'CH.ZEW_INVESTOR_CONFIDENCE.NONE.LEVEL', periodRule: 'month' },
  '214245': { metricKey: 'CH.ZEW_ECONOMIC_STATUS.NONE.LEVEL', periodRule: 'month' },
  '214328': { metricKey: 'CH.KOF_LEADING_METRIC.NONE.LEVEL', periodRule: 'month' },
  '214358': { metricKey: 'CH.ACTUAL_RETAIL_SALES.NONE.YOY', periodRule: 'month' },
  '214382': { metricKey: 'CH.SVME_PURCHASING_MANAGERS.NONE.LEVEL', periodRule: 'month' },
  '214404': { metricKey: 'CH.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '214405': { metricKey: 'CH.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214636': { metricKey: 'CH.PRODUCER_IMPORTS_PRICE.NONE.MOM', periodRule: 'month' },
  '214637': { metricKey: 'CH.PRODUCER_IMPORTS_PRICE.NONE.YOY', periodRule: 'month' },
  '214889': { metricKey: 'CH.EXPORTS.SA.MOM', periodRule: 'month' },
  '214890': { metricKey: 'CH.TRADE_BALANCE.NONE.LEVEL', periodRule: 'month' },
  '214891': { metricKey: 'CH.IMPORTS.SA.MOM', periodRule: 'month' },
  '214892': { metricKey: 'CH.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },
  '215005': { metricKey: 'CH.ZEW_INVESTOR_CONFIDENCE.NONE.LEVEL', periodRule: 'month' },
  '215006': { metricKey: 'CH.ZEW_ECONOMIC_STATUS.NONE.LEVEL', periodRule: 'month' },
})
