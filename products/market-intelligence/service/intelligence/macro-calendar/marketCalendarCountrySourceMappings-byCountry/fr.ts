import type { ZeroXRouterPeriodRule } from '../marketCalendarMetricIdentity'

/**
 * 按国家拆开的「源内 id → 码」映射（FR）。**数据型注册表，纯声明**：一行一个源内身份。
 *
 * 只收期次可定、测度一致的映射；目标码必须存在于码表（守卫在索引里断）。
 */
export const mapping_FR: Readonly<Record<string, Readonly<{ metricKey: string; periodRule: ZeroXRouterPeriodRule }>>> = Object.freeze({
  '212201': { metricKey: 'FR.CDAF_SERVICES_PMI.NONE.LEVEL', periodRule: 'month' },
  '212403': { metricKey: 'FR.HARMONIZED_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '212404': { metricKey: 'FR.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '213622': { metricKey: 'FR.CDAF_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '213712': { metricKey: 'FR.CDAF_COMPOSITE_PMI.NONE.LEVEL', periodRule: 'month' },
  '213713': { metricKey: 'FR.CDAF_SERVICES_PMI.NONE.LEVEL', periodRule: 'month' },
  '213738': { metricKey: 'FR.GOVERNMENT_BUDGET.NONE.AMOUNT', periodRule: 'month' },
  '213767': { metricKey: 'FR.TRADE_BALANCE.NONE.LEVEL', periodRule: 'month' },
  '213908': { metricKey: 'FR.HARMONIZED_CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '213909': { metricKey: 'FR.HARMONIZED_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '213910': { metricKey: 'FR.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '214101': { metricKey: 'FR.INSEE_BUSINESS_CONFIDENCE.NONE.LEVEL', periodRule: 'month' },
  '214102': { metricKey: 'FR.INSEE_MANUFACTURING_CONFIDENCE.NONE.LEVEL', periodRule: 'month' },
  '214131': { metricKey: 'FR.CDAF_COMPOSITE_PMI.NONE.LEVEL', periodRule: 'month' },
  '214132': { metricKey: 'FR.CDAF_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '214133': { metricKey: 'FR.CDAF_SERVICES_PMI.NONE.LEVEL', periodRule: 'month' },
  '214218': { metricKey: 'FR.COMPOSITE_CONSUMER_CONFIDENCE.NONE.LEVEL', periodRule: 'month' },
  '214313': { metricKey: 'FR.GDP.NONE.QOQ', periodRule: 'quarter' },
  '214314': { metricKey: 'FR.GDP.NONE.YOY', periodRule: 'month' },
  '214321': { metricKey: 'FR.HARMONIZED_CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '214322': { metricKey: 'FR.HARMONIZED_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214323': { metricKey: 'FR.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '214324': { metricKey: 'FR.PRODUCER_PRICE.NONE.MOM', periodRule: 'month' },
  '214325': { metricKey: 'FR.PRODUCER_PRICE.NONE.YOY', periodRule: 'month' },
  '214326': { metricKey: 'FR.HOUSEHOLD_CONSUMPTION_EXPENDITURE.NONE.MOM', periodRule: 'month' },
  '214327': { metricKey: 'FR.HOUSEHOLD_CONSUMPTION_EXPENDITURE.NONE.YOY', periodRule: 'month' },
  '214385': { metricKey: 'FR.CDAF_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '214406': { metricKey: 'FR.GOVERNMENT_BUDGET.NONE.AMOUNT', periodRule: 'month' },
  '214428': { metricKey: 'FR.CDAF_COMPOSITE_PMI.NONE.LEVEL', periodRule: 'month' },
  '214429': { metricKey: 'FR.CDAF_SERVICES_PMI.NONE.LEVEL', periodRule: 'month' },
  '214461': { metricKey: 'FR.INDUSTRIAL_OUTPUT.NONE.MOM', periodRule: 'month' },
  '214462': { metricKey: 'FR.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },
  '214463': { metricKey: 'FR.MANUFACTURING_OUTPUT.NONE.MOM', periodRule: 'month' },
  '214464': { metricKey: 'FR.MANUFACTURING_OUTPUT.NONE.YOY', periodRule: 'month' },
  '214497': { metricKey: 'FR.TRADE_BALANCE.NONE.LEVEL', periodRule: 'month' },
  '214534': { metricKey: 'FR.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214548': { metricKey: 'FR.ILO_UNEMPLOYMENT.NONE.RATE', periodRule: 'month' },
  '214638': { metricKey: 'FR.HARMONIZED_CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '214639': { metricKey: 'FR.HARMONIZED_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214640': { metricKey: 'FR.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '214716': { metricKey: 'FR.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214933': { metricKey: 'FR.INSEE_BUSINESS_CONFIDENCE.NONE.LEVEL', periodRule: 'month' },
  '214934': { metricKey: 'FR.INSEE_MANUFACTURING_CONFIDENCE.NONE.LEVEL', periodRule: 'month' },
  '214956': { metricKey: 'FR.CDAF_COMPOSITE_PMI.NONE.LEVEL', periodRule: 'month' },
  '214957': { metricKey: 'FR.CDAF_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '214958': { metricKey: 'FR.CDAF_SERVICES_PMI.NONE.LEVEL', periodRule: 'month' },
  '215004': { metricKey: 'FR.COMPOSITE_CONSUMER_CONFIDENCE.NONE.LEVEL', periodRule: 'month' },
  '215038': { metricKey: 'FR.PRODUCER_PRICE.NONE.MOM', periodRule: 'month' },
  '215039': { metricKey: 'FR.PRODUCER_PRICE.NONE.YOY', periodRule: 'month' },
  '215057': { metricKey: 'FR.HARMONIZED_CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '215058': { metricKey: 'FR.HARMONIZED_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '215059': { metricKey: 'FR.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '215060': { metricKey: 'FR.GDP.NONE.QOQ', periodRule: 'quarter' },
  '215061': { metricKey: 'FR.GDP.NONE.YOY', periodRule: 'month' },
  '215062': { metricKey: 'FR.HOUSEHOLD_CONSUMPTION_EXPENDITURE.NONE.MOM', periodRule: 'month' },
  '215063': { metricKey: 'FR.HOUSEHOLD_CONSUMPTION_EXPENDITURE.NONE.YOY', periodRule: 'month' },
  '10081': { metricKey: 'FR.GDP.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度GDP初值(年率)
  '10083': { metricKey: 'FR.GDP.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度GDP终值(年率)
  '10153': { metricKey: 'FR.CDAF_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月制造业采购经理人指数初值 | 11月制造业采购经理人指数初值
  '10155': { metricKey: 'FR.CDAF_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 9月制造业采购经理人指数终值 | 10月制造业采购经理人指数终值
  '10156': { metricKey: 'FR.CDAF_SERVICES_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月服务业采购经理人指数初值 | 11月服务业采购经理人指数初值
  '10158': { metricKey: 'FR.CDAF_SERVICES_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 3 行 · 7月服务业采购经理人指数终值 | 9月服务业采购经理人指数终值
  '10222': { metricKey: 'FR.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 1 行 · 10月消费者物价指数(年率)初值
  '10224': { metricKey: 'FR.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 1 行 · 9月消费者物价指数(年率)终值
  '10225': { metricKey: 'FR.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 10月消费者物价指数(月率)初值 | 11月消费者物价指数(月率)初值
  '10227': { metricKey: 'FR.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },  // 3 行 · Consumer Price Index (MoM)(Final)(Jul) | 9月消
  '10228': { metricKey: 'FR.HARMONIZED_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 10月调和消费者物价指数(年率)初值 | 11月调和消费者物价指数(年率)初值
  '10230': { metricKey: 'FR.HARMONIZED_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 3 行 · 7月调和消费者物价指数(年率)终值 | 9月调和消费者物价指数(年率)终值
  '10231': { metricKey: 'FR.HARMONIZED_CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 10月调和消费者物价指数(月率)初值 | 11月调和消费者物价指数(月率)初值
  '10233': { metricKey: 'FR.HARMONIZED_CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月调和消费者物价指数(月率)终值 | 10月调和消费者物价指数(月率)终值
  '10243': { metricKey: 'FR.GDP.NONE.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度GDP初值(季率)
  '10245': { metricKey: 'FR.GDP.NONE.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度GDP终值(季率)
  '10270': { metricKey: 'FR.CDAF_COMPOSITE_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月综合采购经理人指数初值 | 11月综合采购经理人指数初值
  '10272': { metricKey: 'FR.CDAF_COMPOSITE_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 9月综合采购经理人指数终值 | 10月综合采购经理人指数终值
  '10288': { metricKey: 'FR.INSEE_MANUFACTURING_CONFIDENCE.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月INSEE制造业信心指数 | 11月INSEE制造业信心指数
  '4150': { metricKey: 'FR.EXPORTS.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 8月出口(亿欧元) | 9月出口(亿欧元)
  '4151': { metricKey: 'FR.IMPORTS.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 8月进口(亿欧元) | 9月进口(亿欧元)
  '9047': { metricKey: 'FR.CURRENT_ACCOUNT.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 8月经常帐(十亿欧元) | 9月经常帐(十亿欧元)
  '9564': { metricKey: 'FR.MANUFACTURING_OUTPUT.NONE.YOY', periodRule: 'month' },  // 1 行 · 9月制造业产出(年率)
  '9565': { metricKey: 'FR.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },  // 1 行 · 9月工业产出(年率)
  '9566': { metricKey: 'FR.GOVERNMENT_BUDGET.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 8月政府预算(十亿欧元) | 9月政府预算(十亿欧元)
  '9572': { metricKey: 'FR.INSEE_BUSINESS_CONFIDENCE.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月INSEE商业信心指数 | 11月INSEE商业信心指数
  '9573': { metricKey: 'FR.HOUSEHOLD_CONSUMPTION_EXPENDITURE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月家庭消费支出(年率) | 10月家庭消费支出(年率)
  '9574': { metricKey: 'FR.HOUSEHOLD_CONSUMPTION_EXPENDITURE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月家庭消费支出(月率) | 10月家庭消费支出(月率)
  '9575': { metricKey: 'FR.PRODUCER_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月生产者物价指数(年率) | 10月生产者物价指数(年率)
  '9576': { metricKey: 'FR.PRODUCER_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月生产者物价指数(月率) | 10月生产者物价指数(月率)
  '9577': { metricKey: 'FR.COMPOSITE_CONSUMER_CONFIDENCE.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月消费者综合信心指数 | 11月消费者综合信心指数
  '9778': { metricKey: 'FR.MANUFACTURING_OUTPUT.NONE.MOM', periodRule: 'month' },  // 1 行 · 9月制造业产出(月率)
  '9779': { metricKey: 'FR.INDUSTRIAL_OUTPUT.NONE.MOM', periodRule: 'month' },  // 1 行 · 9月工业产出(月率)
  '9854': { metricKey: 'FR.ILO_UNEMPLOYMENT.NONE.RATE', periodRule: 'quarter' },  // 1 行 · 第三季度ILO失业率
})
