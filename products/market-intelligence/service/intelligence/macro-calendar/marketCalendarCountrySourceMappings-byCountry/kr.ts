import type { ZeroXRouterPeriodRule } from '../marketCalendarMetricIdentity'

/**
 * 按国家拆开的「源内 id → 码」映射（KR）。**数据型注册表，纯声明**：一行一个源内身份。
 *
 * 只收期次可定、测度一致的映射；目标码必须存在于码表（守卫在索引里断）。
 */
export const mapping_KR: Readonly<Record<string, Readonly<{ metricKey: string; periodRule: ZeroXRouterPeriodRule }>>> = Object.freeze({
  '213612': { metricKey: 'KR.TRADE_BALANCE.NONE.LEVEL', periodRule: 'month' },
  '213614': { metricKey: 'KR.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '213640': { metricKey: 'KR.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '213641': { metricKey: 'KR.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '213642': { metricKey: 'KR.CORE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '213890': { metricKey: 'KR.L_MONEY_SUPPLY.NONE.MOM', periodRule: 'month' },
  '213891': { metricKey: 'KR.L_MONEY_SUPPLY.NONE.YOY', periodRule: 'month' },
  '213892': { metricKey: 'KR.MONEY_SUPPLY_M2.NONE.MOM', periodRule: 'month' },
  '213945': { metricKey: 'KR.EXPORTS_PRICE.NONE.YOY', periodRule: 'month' },
  '213946': { metricKey: 'KR.IMPORTS_PRICE.NONE.YOY', periodRule: 'month' },
  '213950': { metricKey: 'KR.UNEMPLOYMENT.SA.MOM', periodRule: 'month' },
  '214065': { metricKey: 'KR.PRODUCER_PRICE.NONE.YOY', periodRule: 'month' },
  '214066': { metricKey: 'KR.PRODUCER_PRICE.NONE.MOM', periodRule: 'month' },
  '214211': { metricKey: 'KR.REAL_GDP.NONE.QOQ', periodRule: 'quarter' },
  '214212': { metricKey: 'KR.REAL_GDP.NONE.YOY', periodRule: 'month' },
  '214294': { metricKey: 'KR.INDUSTRIAL_OUTPUT.SA.MOM', periodRule: 'month' },
  '214295': { metricKey: 'KR.INDUSTRIAL_OUTPUT.NONE.YOY', periodRule: 'month' },
  '214357': { metricKey: 'KR.TRADE_BALANCE.NONE.LEVEL', periodRule: 'month' },
  '214376': { metricKey: 'KR.SP_MANUFACTURING_PMI.NONE.LEVEL', periodRule: 'month' },
  '214400': { metricKey: 'KR.CONSUMER_PRICE.NONE.MOM', periodRule: 'month' },
  '214401': { metricKey: 'KR.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214402': { metricKey: 'KR.CORE_CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214591': { metricKey: 'KR.UNEMPLOYMENT.SA.MOM', periodRule: 'month' },
  '214628': { metricKey: 'KR.EXPORTS_PRICE.NONE.YOY', periodRule: 'month' },
  '214629': { metricKey: 'KR.IMPORTS_PRICE.NONE.YOY', periodRule: 'month' },
  '214631': { metricKey: 'KR.L_MONEY_SUPPLY.NONE.MOM', periodRule: 'month' },
  '214632': { metricKey: 'KR.L_MONEY_SUPPLY.NONE.YOY', periodRule: 'month' },
  '214633': { metricKey: 'KR.MONEY_SUPPLY_M2.NONE.MOM', periodRule: 'month' },
  '214712': { metricKey: 'KR.IMPORTS.NONE.YOY', periodRule: 'month' },
  '214713': { metricKey: 'KR.IMPORTS.NONE.YOY', periodRule: 'month' },
  '214714': { metricKey: 'KR.EXPORTS.NONE.YOY', periodRule: 'month' },
  '214715': { metricKey: 'KR.EXPORTS.NONE.YOY', periodRule: 'month' },
  '214917': { metricKey: 'KR.PRODUCER_PRICE.NONE.YOY', periodRule: 'month' },
  '214918': { metricKey: 'KR.PRODUCER_PRICE.NONE.MOM', periodRule: 'month' },
})
