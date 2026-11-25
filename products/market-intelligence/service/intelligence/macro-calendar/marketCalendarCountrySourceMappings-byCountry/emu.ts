import type { ZeroXRouterPeriodRule } from '../marketCalendarMetricIdentity'

/**
 * 按国家拆开的「源内 id → 码」映射（EMU）。**数据型注册表，纯声明**：一行一个源内身份。
 *
 * 只收期次可定、测度一致的映射；目标码必须存在于码表（守卫在索引里断）。
 */
export const mapping_EMU: Readonly<Record<string, Readonly<{ metricKey: string; periodRule: ZeroXRouterPeriodRule }>>> = Object.freeze({
  '213625': { metricKey: 'EMU.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '213654': { metricKey: 'EMU.CORE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '213655': { metricKey: 'EMU.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '213656': { metricKey: 'EMU.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '213716': { metricKey: 'EMU.SP_COMPOSITE_PMI.NONE.LEVEL', periodRule: 'month' },
  '213717': { metricKey: 'EMU.SP_SERVICES_PMI.NONE.LEVEL', periodRule: 'month' },
  '213720': { metricKey: 'EMU.SENTIX_INVESTOR_CONFIDENCE.NONE.LEVEL', periodRule: 'month' },
  '213721': { metricKey: 'EMU.PRODUCER_PRICE.NONE.MOM', periodRule: 'month' },
  '213722': { metricKey: 'EMU.PRODUCER_PRICE.NONE.YOY', periodRule: 'month' },
  '213743': { metricKey: 'EMU.RETAIL_SALES.NONE.MOM', periodRule: 'month' },
  '213744': { metricKey: 'EMU.RETAIL_SALES.NONE.YOY', periodRule: 'month' },
  '213911': { metricKey: 'EMU.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },
  '213912': { metricKey: 'EMU.INDUSTRIAL_OUTPUT.NONE.MOM', periodRule: 'month' },
  '213957': { metricKey: 'EMU.CORE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '213958': { metricKey: 'EMU.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '213959': { metricKey: 'EMU.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '213964': { metricKey: 'EMU.TRADE_BALANCE.SA.LEVEL', periodRule: 'month' },
  '214051': { metricKey: 'EMU.CURRENT_ACCOUNT.NSA.LEVEL', periodRule: 'month' },
  '214054': { metricKey: 'EMU.CONSTRUCTION_OUTPUT.NONE.MOM', periodRule: 'month' },
  '214055': { metricKey: 'EMU.CONSTRUCTION_OUTPUT.NONE.YOY', periodRule: 'month' },
  '214058': { metricKey: 'EMU.ZEW_ECONOMIC_STATUS.NONE.LEVEL', periodRule: 'month' },
  '214137': { metricKey: 'EMU.SP_COMPOSITE_PMI.NONE.LEVEL', periodRule: 'month' },
  '214138': { metricKey: 'EMU.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '214139': { metricKey: 'EMU.SP_SERVICES_PMI.NONE.LEVEL', periodRule: 'month' },
  '214219': { metricKey: 'EMU.MONEY_SUPPLY_M3.NONE.YOY', periodRule: 'month' },
  '214220': { metricKey: 'EMU.THREE_MONTH_M3_MONEY_SUPPLY.NONE.YOY', periodRule: 'month' },
  '214270': { metricKey: 'EMU.BUSINESS_CLIMATE.NONE.LEVEL', periodRule: 'month' },
  '214272': { metricKey: 'EMU.ECONOMIC_CLIMATE.NONE.LEVEL', periodRule: 'month' },
  '214273': { metricKey: 'EMU.INDUSTRIAL_PROSPERITY.NONE.LEVEL', periodRule: 'month' },
  '214274': { metricKey: 'EMU.SERVICE_INDUSTRY_PROSPERITY.NONE.LEVEL', periodRule: 'month' },
  '214336': { metricKey: 'EMU.GDP.NONE.QOQ', periodRule: 'quarter' },
  '214337': { metricKey: 'EMU.GDP.NONE.YOY', periodRule: 'month' },
  '214387': { metricKey: 'EMU.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '214432': { metricKey: 'EMU.SP_COMPOSITE_PMI.NONE.LEVEL', periodRule: 'month' },
  '214433': { metricKey: 'EMU.SP_SERVICES_PMI.NONE.LEVEL', periodRule: 'month' },
  '214435': { metricKey: 'EMU.CORE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214436': { metricKey: 'EMU.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '214437': { metricKey: 'EMU.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214476': { metricKey: 'EMU.PRODUCER_PRICE.NONE.MOM', periodRule: 'month' },
  '214477': { metricKey: 'EMU.PRODUCER_PRICE.NONE.YOY', periodRule: 'month' },
  '214502': { metricKey: 'EMU.RETAIL_SALES.NONE.MOM', periodRule: 'month' },
  '214503': { metricKey: 'EMU.RETAIL_SALES.NONE.YOY', periodRule: 'month' },
  '214555': { metricKey: 'EMU.SENTIX_INVESTOR_CONFIDENCE.NONE.LEVEL', periodRule: 'month' },
  '214644': { metricKey: 'EMU.EMPLOYMENT.SA.QOQ', periodRule: 'quarter' },
  '214645': { metricKey: 'EMU.GDP.NONE.QOQ', periodRule: 'quarter' },
  '214646': { metricKey: 'EMU.GDP.NONE.YOY', periodRule: 'month' },
  '214647': { metricKey: 'EMU.TRADE_BALANCE.SA.LEVEL', periodRule: 'month' },
  '214667': { metricKey: 'EMU.CORE_CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '214782': { metricKey: 'EMU.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },
  '214783': { metricKey: 'EMU.INDUSTRIAL_OUTPUT.NONE.MOM', periodRule: 'month' },
  '214813': { metricKey: 'EMU.ZEW_ECONOMIC_STATUS.NONE.LEVEL', periodRule: 'month' },
  '214854': { metricKey: 'EMU.CORE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214855': { metricKey: 'EMU.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '214856': { metricKey: 'EMU.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214893': { metricKey: 'EMU.CURRENT_ACCOUNT.NSA.LEVEL', periodRule: 'month' },
  '214895': { metricKey: 'EMU.CONSTRUCTION_OUTPUT.NONE.MOM', periodRule: 'month' },
  '214896': { metricKey: 'EMU.CONSTRUCTION_OUTPUT.NONE.YOY', periodRule: 'month' },
  '214897': { metricKey: 'EMU.UNIT_LABOR_COSTS.NONE.YOY', periodRule: 'month' },
  '214949': { metricKey: 'EMU.BUSINESS_CLIMATE.NONE.LEVEL', periodRule: 'month' },
  '214963': { metricKey: 'EMU.ECONOMIC_CLIMATE.NONE.LEVEL', periodRule: 'month' },
  '214964': { metricKey: 'EMU.INDUSTRIAL_PROSPERITY.NONE.LEVEL', periodRule: 'month' },
  '214965': { metricKey: 'EMU.SERVICE_INDUSTRY_PROSPERITY.NONE.LEVEL', periodRule: 'month' },
  '214966': { metricKey: 'EMU.SP_COMPOSITE_PMI.NONE.LEVEL', periodRule: 'month' },
  '214967': { metricKey: 'EMU.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '214968': { metricKey: 'EMU.SP_SERVICES_PMI.NONE.LEVEL', periodRule: 'month' },
  '215043': { metricKey: 'EMU.MONEY_SUPPLY_M3.NONE.YOY', periodRule: 'month' },
  '215044': { metricKey: 'EMU.THREE_MONTH_M3_MONEY_SUPPLY.NONE.YOY', periodRule: 'month' },
  '10024': { metricKey: 'EMU.CORE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月核心消费者物价指数初值(年率) | 10月核心消费者物价指数初值(年率)
  '10026': { metricKey: 'EMU.CORE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月核心消费者物价指数终值(年率) | 10月核心消费者物价指数终值(年率)
  '10027': { metricKey: 'EMU.GDP.NONE.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度GDP初值(季率)
  '10028': { metricKey: 'EMU.GDP.NONE.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度GDP修正值(季率)
  '10095': { metricKey: 'EMU.CORE_CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月核心消费者物价指数终值(月率) | 10月核心消费者物价指数终值(月率)
  '10213': { metricKey: 'EMU.SP_COMPOSITE_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月综合采购经理人指数初值 | 11月综合采购经理人指数初值
  '10215': { metricKey: 'EMU.SP_COMPOSITE_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 9月综合采购经理人指数终值 | 10月综合采购经理人指数终值
  '10216': { metricKey: 'EMU.CONSUMER_CONFIDENCE.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月消费者信心指数初值 | 11月消费者信心指数初值
  '10218': { metricKey: 'EMU.CONSUMER_CONFIDENCE.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月消费者信心指数终值 | 11月消费者信心指数终值
  '10219': { metricKey: 'EMU.EMPLOYMENT.SA.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度季调后就业人数(季率)初值
  '10252': { metricKey: 'EMU.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月消费者物价指数初值(月率) | 10月消费者物价指数初值(月率)
  '10254': { metricKey: 'EMU.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月消费者物价指数终值(月率) | 10月消费者物价指数终值(月率)
  '10255': { metricKey: 'EMU.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月消费者物价指数初值(年率) | 10月消费者物价指数初值(年率)
  '10257': { metricKey: 'EMU.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月消费者物价指数终值(年率) | 10月消费者物价指数终值(年率)
  '4185': { metricKey: 'EMU.UNEMPLOYMENT.NONE.RATE', periodRule: 'month' },  // 2 行 · 8月失业率 | 9月失业率
  '4187': { metricKey: 'EMU.RETAIL_SALES.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月零售销售(月率) | 9月零售销售(月率)
  '4188': { metricKey: 'EMU.RETAIL_SALES.NONE.YOY', periodRule: 'month' },  // 2 行 · 8月零售销售(年率) | 9月零售销售(年率)
  '8794': { metricKey: 'EMU.ZEW_ECONOMIC_SENTIMENT.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月ZEW经济景气指数 | 11月ZEW经济景气指数
  '8795': { metricKey: 'EMU.ZEW_ECONOMIC_STATUS.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月ZEW经济现况指数 | 11月ZEW经济现况指数
  '8796': { metricKey: 'EMU.UNIT_LABOR_COSTS.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度劳动力成本(年率)
  '8797': { metricKey: 'EMU.UNSEASONALLY_TRADE_ACCOUNT.NSA.AMOUNT', periodRule: 'month' },  // 2 行 · 9月季调后贸易帐(十亿欧元) | 10月季调后贸易帐(十亿欧元)
  '8798': { metricKey: 'EMU.CURRENT_ACCOUNT.SA.AMOUNT', periodRule: 'month' },  // 2 行 · 8月季调后经常帐(十亿欧元) | 9月季调后经常帐(十亿欧元)
  '8799': { metricKey: 'EMU.MONEY_SUPPLY_M3.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月货币供应M3(年率) | 10月货币供应M3(年率)
  '9109': { metricKey: 'EMU.UNSEASONALLY_TRADE_ACCOUNT.NSA.AMOUNT', periodRule: 'month' },  // 2 行 · 8月未季调贸易帐(十亿欧元) | 9月未季调贸易帐(十亿欧元)
  '9110': { metricKey: 'EMU.CURRENT_ACCOUNT.SA.AMOUNT', periodRule: 'month' },  // 2 行 · 8月未季调经常帐(十亿欧元) | 9月未季调经常帐(十亿欧元)
  '9360': { metricKey: 'EMU.PRODUCER_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 8月生产者物价指数(年率) | 9月生产者物价指数(年率)
  '9361': { metricKey: 'EMU.PRODUCER_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月生产者物价指数(月率) | 9月生产者物价指数(月率)
  '9740': { metricKey: 'EMU.SENTIX_INVESTOR_CONFIDENCE.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月Sentix投资者信心指数 | 11月Sentix投资者信心指数
  '9741': { metricKey: 'EMU.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },  // 2 行 · 8月工业产出(年率) | 9月工业产出(年率)
  '9742': { metricKey: 'EMU.INDUSTRIAL_OUTPUT.NONE.MOM', periodRule: 'month' },  // 2 行 · 8月工业产出(月率) | 9月工业产出(月率)
  '9743': { metricKey: 'EMU.CONSTRUCTION_OUTPUT.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月建筑业产出(月率) | 10月建筑业产出(月率)
  '9744': { metricKey: 'EMU.CONSTRUCTION_OUTPUT.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月建筑业产出(年率) | 10月建筑业产出(年率)
  '9748': { metricKey: 'EMU.THREE_MONTH_M3_MONEY_SUPPLY.NONE.YOY', periodRule: 'month' },  // 2 行 · 至9月三个月货币供应M3(年率) | 至10月三个月货币供应M3(年率)
  '9749': { metricKey: 'EMU.BUSINESS_CLIMATE.NONE.LEVEL', periodRule: 'month' },  // 2 行 · 10月企业景气指数 | 11月企业景气指数
  '9750': { metricKey: 'EMU.SERVICE_INDUSTRY_PROSPERITY.NONE.LEVEL', periodRule: 'month' },  // 2 行 · 10月服务业景气指数 | 11月服务业景气指数
  '9751': { metricKey: 'EMU.INDUSTRIAL_PROSPERITY.NONE.LEVEL', periodRule: 'month' },  // 2 行 · 10月工业景气指数 | 11月工业景气指数
  '9790': { metricKey: 'EMU.ECONOMIC_CLIMATE.NONE.LEVEL', periodRule: 'month' },  // 2 行 · 10月经济景气指数 | 11月经济景气指数
  '9988': { metricKey: 'EMU.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月制造业采购经理人指数初值 | 11月制造业采购经理人指数初值
  '9990': { metricKey: 'EMU.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 9月制造业采购经理人指数终值 | 10月制造业采购经理人指数终值
  '9991': { metricKey: 'EMU.SP_SERVICES_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月服务业采购经理人指数初值 | 11月服务业采购经理人指数初值
  '9993': { metricKey: 'EMU.SP_SERVICES_PMI.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 9月服务业采购经理人指数终值 | 10月服务业采购经理人指数终值
  '9997': { metricKey: 'EMU.GDP.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度GDP初值(年率)
  '9998': { metricKey: 'EMU.GDP.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度GDP修正值(年率)
})
