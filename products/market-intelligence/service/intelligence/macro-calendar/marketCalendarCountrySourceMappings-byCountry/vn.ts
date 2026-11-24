import type { ZeroXRouterPeriodRule } from '../marketCalendarMetricIdentity'

/**
 * 按国家拆开的「源内 id → 码」映射（VN）。**数据型注册表，纯声明**：一行一个源内身份。
 *
 * 只收期次可定、测度一致的映射；目标码必须存在于码表（守卫在索引里断）。
 */
export const mapping_VN: Readonly<Record<string, Readonly<{ metricKey: string; periodRule: ZeroXRouterPeriodRule }>>> = Object.freeze({
  '213616': { metricKey: 'VN.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '214156': { metricKey: 'VN.EXPORTS.NONE.YOY', periodRule: 'month' },
  '214157': { metricKey: 'VN.IMPORTS.NONE.YOY', periodRule: 'month' },
  '214158': { metricKey: 'VN.RETAIL_SALES.NONE.YOY', periodRule: 'month' },
  '214159': { metricKey: 'VN.TRADE_BALANCE.NONE.LEVEL', periodRule: 'month' },
  '214160': { metricKey: 'VN.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },
  '214161': { metricKey: 'VN.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214378': { metricKey: 'VN.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '9901': { metricKey: 'VN.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 9月标普全球制造业采购经理人指数 | 10月标普全球制造业采购经理人指数
  '9903': { metricKey: 'VN.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 1 行 · 9月消费者物价指数(年率)
  '9904': { metricKey: 'VN.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },  // 1 行 · 9月工业产出(年率)
  '9905': { metricKey: 'VN.RETAIL_SALES.NONE.YOY', periodRule: 'month' },  // 1 行 · 9月零售销售(年率)
  '9907': { metricKey: 'VN.IMPORTS.NONE.YOY', periodRule: 'month' },  // 1 行 · 9月进口(年率)
  '9908': { metricKey: 'VN.EXPORTS.NONE.YOY', periodRule: 'month' },  // 1 行 · 9月出口(年率)
})
