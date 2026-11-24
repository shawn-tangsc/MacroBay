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
  '10277': { metricKey: 'CH.IMPORTS.SA.MOM', periodRule: 'month' },  // 2 行 · 9月季调后实际进口(月率) | 10月季调后实际进口(月率)
  '10278': { metricKey: 'CH.EXPORTS.SA.MOM', periodRule: 'month' },  // 2 行 · 9月季调后实际出口(月率) | 10月季调后实际出口(月率)
  '10291': { metricKey: 'CH.CONSUMER_CONFIDENCE.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 9月消费者信心指数 | 10月消费者信心指数
  '8818': { metricKey: 'CH.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度工业产出(年率)
  '8819': { metricKey: 'CH.UNEMPLOYMENT.SA.RATE', periodRule: 'month' },  // 2 行 · 9月季调后失业率 | 10月季调后失业率
  '8831': { metricKey: 'CH.ACTUAL_RETAIL_SALES.NONE.YOY', periodRule: 'month' },  // 2 行 · 8月实际零售销售(年率) | 9月实际零售销售(年率)
  '9138': { metricKey: 'CH.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月消费者物价指数(年率) | 10月消费者物价指数(年率)
  '9628': { metricKey: 'CH.SVME_PURCHASING_MANAGERS.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 9月SVME采购经理人指数 | 10月SVME采购经理人指数
  '9630': { metricKey: 'CH.UNSEASONALLY_UNEMPLOYMENT.NSA.RATE', periodRule: 'month' },  // 2 行 · 9月未季调失业率 | 10月未季调失业率
  '9631': { metricKey: 'CH.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月消费者物价指数(月率) | 10月消费者物价指数(月率)
  '9632': { metricKey: 'CH.PRODUCER_IMPORTS_PRICE.NONE.YOY', periodRule: 'month' },  // 3 行 · 7月生产者/进口物价指数(年率) | 9月生产者/进口物价指数(年率)
  '9633': { metricKey: 'CH.ZEW_INVESTOR_CONFIDENCE.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月ZEW投资者信心指数 | 11月ZEW投资者信心指数
  '9634': { metricKey: 'CH.ZEW_ECONOMIC_STATUS.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月ZEW经济现况指数 | 11月ZEW经济现况指数
  '9635': { metricKey: 'CH.KOF_LEADING_METRIC.NONE.LEVEL', periodRule: 'month' },  // 2 行 · 10月KOF领先指标 | 11月KOF领先指标
  '9780': { metricKey: 'CH.PRODUCER_IMPORTS_PRICE.NONE.MOM', periodRule: 'month' },  // 3 行 · 7月生产者/进口物价指数(月率) | 9月生产者/进口物价指数(月率)
  '9889': { metricKey: 'CH.FOREIGN_EXCHANGE_RESERVES.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 9月外汇储备(十亿瑞郎) | 10月外汇储备(十亿瑞郎)
})
