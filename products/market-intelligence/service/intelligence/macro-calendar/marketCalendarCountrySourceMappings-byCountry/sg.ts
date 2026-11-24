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
  '10000': { metricKey: 'SG.GDP.SA.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度季调后GDP初值(季率)
  '10002': { metricKey: 'SG.GDP.SA.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度季调后GDP终值(季率)
  '10246': { metricKey: 'SG.GDP.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度GDP初值(年率)
  '10248': { metricKey: 'SG.GDP.NONE.YOY', periodRule: 'quarter' },  // 2 行 · 第三季度GDP终值(年率)
  '10292': { metricKey: 'SG.MONEY_SUPPLY_M2.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月货币供应M2(年率) | 10月货币供应M2(年率)
  '8916': { metricKey: 'SG.RETAIL_SALES.SA.MOM', periodRule: 'month' },  // 3 行 · 8月季调后零售销售(月率) | 9月季调后零售销售(月率)
  '8917': { metricKey: 'SG.RETAIL_SALES.NONE.YOY', periodRule: 'month' },  // 3 行 · 8月零售销售(年率) | 9月零售销售(年率)
  '8919': { metricKey: 'SG.PETROLEUM_PRODUCT_EXPORTS.SA.MOM', periodRule: 'month' },  // 2 行 · 9月季调后非石油产品出口(月率) | 10月季调后非石油产品出口(月率)
  '8920': { metricKey: 'SG.OIL_EXPORTS.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月非石油产品出口(年率) | 10月非石油产品出口(年率)
  '9665': { metricKey: 'SG.FOREIGN_EXCHANGE_RESERVES.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 9月外汇储备(十亿美元) | 10月外汇储备(十亿美元)
  '9668': { metricKey: 'SG.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月消费者物价指数(年率) | 10月消费者物价指数(年率)
  '9876': { metricKey: 'SG.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },  // 3 行 · Industrial Output (YoY)(Aug) | 9月工业产出(年率)
  '9877': { metricKey: 'SG.INDUSTRIAL_OUTPUT.SA.MOM', periodRule: 'month' },  // 2 行 · 9月季调后工业产出(月率) | 10月季调后工业产出(月率)
  '9896': { metricKey: 'SG.MONEY_SUPPLY_M1.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月货币供应M1(年率) | 10月货币供应M1(年率)
})
