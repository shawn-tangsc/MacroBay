import type { ZeroXRouterPeriodRule } from '../marketCalendarMetricIdentity'

/**
 * 按国家拆开的「源内 id → 码」映射（IT）。**数据型注册表，纯声明**：一行一个源内身份。
 *
 * 只收期次可定、测度一致的映射；目标码必须存在于码表（守卫在索引里断）。
 */
export const mapping_IT: Readonly<Record<string, Readonly<{ metricKey: string; periodRule: ZeroXRouterPeriodRule }>>> = Object.freeze({
  '211994': { metricKey: 'IT.GDP.NONE.QOQ', periodRule: 'quarter' },
  '212198': { metricKey: 'IT.ADACI_COMPOSITE_PMI.NONE.LEVEL', periodRule: 'month' },
  '212354': { metricKey: 'IT.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '212383': { metricKey: 'IT.TRADE_ACCOUNT_EU.NONE.AMOUNT', periodRule: 'month' },
  '213621': { metricKey: 'IT.ADACI_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '213649': { metricKey: 'IT.RETAIL_SALES.SA.MOM', periodRule: 'month' },
  '213650': { metricKey: 'IT.RETAIL_SALES.NONE.YOY', periodRule: 'month' },
  '213710': { metricKey: 'IT.ADACI_COMPOSITE_PMI.NONE.LEVEL', periodRule: 'month' },
  '213711': { metricKey: 'IT.ADACI_SERVICES_PMI.NONE.LEVEL', periodRule: 'month' },
  '213800': { metricKey: 'IT.INDUSTRIAL_OUTPUT.SA.MOM', periodRule: 'month' },
  '213801': { metricKey: 'IT.DAY_TUNER_INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },
  '213905': { metricKey: 'IT.TRADE_ACCOUNT_EU.NONE.AMOUNT', periodRule: 'month' },
  '213960': { metricKey: 'IT.HARMONIZED_CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '213961': { metricKey: 'IT.HARMONIZED_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '213962': { metricKey: 'IT.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '213963': { metricKey: 'IT.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '213966': { metricKey: 'IT.TRADE_BALANCE.NONE.AMOUNT', periodRule: 'month' },
  '213967': { metricKey: 'IT.TRADE_ACCOUNT_EU.NONE.AMOUNT', periodRule: 'month' },
  '214246': { metricKey: 'IT.UNADJUSTED_INDUSTRIAL_SALES.NSA.YOY', periodRule: 'month' },
  '214247': { metricKey: 'IT.INDUSTRIAL_SALES.SA.MOM', periodRule: 'month' },
  '214248': { metricKey: 'IT.PRODUCER_PRICE.NONE.MOM', periodRule: 'month' },
  '214249': { metricKey: 'IT.PRODUCER_PRICE.NONE.YOY', periodRule: 'month' },
  '214275': { metricKey: 'IT.ISTAT_BUSINESS_CONFIDENCE.NONE.LEVEL', periodRule: 'month' },
  '214276': { metricKey: 'IT.ISTAT_CONSUMER_CONFIDENCE.NONE.LEVEL', periodRule: 'month' },
  '214334': { metricKey: 'IT.GDP.NONE.QOQ', periodRule: 'quarter' },
  '214335': { metricKey: 'IT.GDP.NONE.YOY', periodRule: 'month' },
  '214338': { metricKey: 'IT.HARMONIZED_CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '214339': { metricKey: 'IT.HARMONIZED_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214340': { metricKey: 'IT.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '214341': { metricKey: 'IT.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214384': { metricKey: 'IT.ADACI_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '214426': { metricKey: 'IT.ADACI_COMPOSITE_PMI.NONE.LEVEL', periodRule: 'month' },
  '214427': { metricKey: 'IT.ADACI_SERVICES_PMI.NONE.LEVEL', periodRule: 'month' },
  '214470': { metricKey: 'IT.RETAIL_SALES.SA.MOM', periodRule: 'month' },
  '214471': { metricKey: 'IT.RETAIL_SALES.NONE.YOY', periodRule: 'month' },
  '214598': { metricKey: 'IT.INDUSTRIAL_OUTPUT.SA.MOM', periodRule: 'month' },
  '214599': { metricKey: 'IT.DAY_TUNER_INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },
  '214623': { metricKey: 'IT.TRADE_ACCOUNT_EU.NONE.AMOUNT', periodRule: 'month' },
  '214642': { metricKey: 'IT.TRADE_BALANCE.NONE.AMOUNT', periodRule: 'month' },
  '214643': { metricKey: 'IT.TRADE_ACCOUNT_EU.NONE.AMOUNT', periodRule: 'month' },
  '214806': { metricKey: 'IT.HARMONIZED_CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '214807': { metricKey: 'IT.HARMONIZED_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214808': { metricKey: 'IT.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '214809': { metricKey: 'IT.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '215068': { metricKey: 'IT.UNADJUSTED_INDUSTRIAL_SALES.NSA.YOY', periodRule: 'month' },
  '215069': { metricKey: 'IT.INDUSTRIAL_SALES.SA.MOM', periodRule: 'month' },
  '10084': { metricKey: 'IT.GDP.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度GDP初值(年率)
  '10087': { metricKey: 'IT.GDP.NONE.QOQ', periodRule: 'quarter' },  // 2 行 · GDP(QoQ)(Preliminary)(Q2) | 第三季度GDP初值(季率)
  '10159': { metricKey: 'IT.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 10月消费者物价指数初值(月率) | 11月消费者物价指数初值(月率)
  '10161': { metricKey: 'IT.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月消费者物价指数(月率)终值 | 10月消费者物价指数(月率)终值
  '10162': { metricKey: 'IT.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 10月消费者物价指数初值(年率) | 11月消费者物价指数初值(年率)
  '10164': { metricKey: 'IT.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 3 行 · 7月消费者物价指数(年率)终值 | 9月消费者物价指数(年率)终值
  '10165': { metricKey: 'IT.HARMONIZED_CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 10月调和消费者物价指数初值(月率) | 11月调和消费者物价指数初值(月率)
  '10167': { metricKey: 'IT.HARMONIZED_CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月调和消费者物价指数(月率)(终值) | 10月调和消费者物价指数(月率)(终值)
  '10168': { metricKey: 'IT.HARMONIZED_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 10月调和消费者物价指数初值(年率) | 11月调和消费者物价指数初值(年率)
  '10170': { metricKey: 'IT.HARMONIZED_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月调和消费者物价指数(年率)(终值) | 10月调和消费者物价指数(年率)(终值)
  '9578': { metricKey: 'IT.ADACI_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 9月制造业采购经理人指数 | 10月制造业采购经理人指数
  '9579': { metricKey: 'IT.ADACI_SERVICES_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 9月服务业采购经理人指数 | 10月服务业采购经理人指数
  '9584': { metricKey: 'IT.INDUSTRIAL_OUTPUT.SA.MOM', periodRule: 'month' },  // 2 行 · 8月季调后工业产出(月率) | 9月季调后工业产出(月率)
  '9585': { metricKey: 'IT.DAY_TUNER_INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },  // 2 行 · 8月工作日调整后工业产出(年率) | 9月工作日调整后工业产出(年率)
  '9586': { metricKey: 'IT.TRADE_BALANCE.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 8月贸易帐总值(百万欧元) | 9月贸易帐总值(百万欧元)
  '9588': { metricKey: 'IT.TRADE_ACCOUNT_EU.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 8月对欧盟贸易帐(百万欧元) | 9月对欧盟贸易帐(百万欧元)
  '9589': { metricKey: 'IT.INDUSTRIAL_SALES.SA.MOM', periodRule: 'month' },  // 2 行 · 8月季调后工业销售(月率) | 9月季调后工业销售(月率)
  '9590': { metricKey: 'IT.UNADJUSTED_INDUSTRIAL_SALES.NSA.YOY', periodRule: 'month' },  // 2 行 · 8月未季调工业销售(年率) | 9月未季调工业销售(年率)
  '9597': { metricKey: 'IT.RETAIL_SALES.NONE.YOY', periodRule: 'month' },  // 2 行 · 8月零售销售(年率) | 9月零售销售(年率)
  '9598': { metricKey: 'IT.RETAIL_SALES.SA.MOM', periodRule: 'month' },  // 2 行 · 8月季调后零售销售(月率) | 9月季调后零售销售(月率)
  '9609': { metricKey: 'IT.ISTAT_CONSUMER_CONFIDENCE.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月Istat消费者信心指数 | 11月Istat消费者信心指数
  '9612': { metricKey: 'IT.ISTAT_BUSINESS_CONFIDENCE.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月Istat商业信心指数 | 11月Istat商业信心指数
  '9621': { metricKey: 'IT.UNEMPLOYMENT.NONE.RATE', periodRule: 'month' },  // 2 行 · 8月失业率 | 9月失业率
  '9625': { metricKey: 'IT.PRODUCER_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月生产者物价指数(年率) | 10月生产者物价指数(年率)
  '9626': { metricKey: 'IT.PRODUCER_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月生产者物价指数(月率) | 10月生产者物价指数(月率)
  '9884': { metricKey: 'IT.ADACI_COMPOSITE_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 3 行 · 7月综合采购经理人指数 | 9月综合采购经理人指数
})
