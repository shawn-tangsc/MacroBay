import type { ZeroXRouterPeriodRule } from '../marketCalendarMetricIdentity'

/**
 * 按国家拆开的「源内 id → 码」映射（NZ）。**数据型注册表，纯声明**：一行一个源内身份。
 *
 * 只收期次可定、测度一致的映射；目标码必须存在于码表（守卫在索引里断）。
 */
export const mapping_NZ: Readonly<Record<string, Readonly<{ metricKey: string; periodRule: ZeroXRouterPeriodRule }>>> = Object.freeze({
  '9064': { metricKey: 'NZ.POLICY_RATE.NONE.LEVEL', periodRule: 'month' },
  '213947': { metricKey: 'NZ.MANUFACTURING.NONE.LEVEL', periodRule: 'month' },
  '213948': { metricKey: 'NZ.FOOD_PRICE.NONE.MOM', periodRule: 'month' },
  '213949': { metricKey: 'NZ.FOOD_PRICE.NONE.YOY', periodRule: 'month' },
  '214020': { metricKey: 'NZ.SERVICE_INDUSTRY_PERFORMANCE.NONE.LEVEL', periodRule: 'month' },
  '214021': { metricKey: 'NZ.TRADE_BALANCE.NONE.LEVEL', periodRule: 'month' },
  '214022': { metricKey: 'NZ.12_MONTH_TRADE_BALANCE.NONE.AMOUNT', periodRule: 'month' },
  '214095': { metricKey: 'NZ.CONSUMER_PRICE.NONE.QOQ', periodRule: 'quarter' },
  '214096': { metricKey: 'NZ.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214398': { metricKey: 'NZ.CONSTRUCTION_PERMIT.NONE.MOM', periodRule: 'month' },
  '214399': { metricKey: 'NZ.BUILDING_PERMITS.NONE.YOY', periodRule: 'month' },
  '214416': { metricKey: 'NZ.AHE.NONE.QOQ', periodRule: 'quarter' },
  '214417': { metricKey: 'NZ.LABOR_COST.NONE.QOQ', periodRule: 'quarter' },
  '214418': { metricKey: 'NZ.LABOR_COST.NONE.YOY', periodRule: 'month' },
  '214420': { metricKey: 'NZ.HLFS_EMPLOYMENT_TRANSMUTATION.NONE.QOQ', periodRule: 'quarter' },
  '214630': { metricKey: 'NZ.MANUFACTURING.NONE.LEVEL', periodRule: 'month' },
  '214757': { metricKey: 'NZ.SERVICE_INDUSTRY_PERFORMANCE.NONE.LEVEL', periodRule: 'month' },
  '214795': { metricKey: 'NZ.FOOD_PRICE.NONE.MOM', periodRule: 'month' },
  '214796': { metricKey: 'NZ.FOOD_PRICE.NONE.YOY', periodRule: 'month' },
  '214870': { metricKey: 'NZ.TRADE_BALANCE.NONE.LEVEL', periodRule: 'month' },
  '214874': { metricKey: 'NZ.PRODUCER_PRICE_INPUT.NONE.QOQ', periodRule: 'quarter' },
  '214875': { metricKey: 'NZ.PRODUCER_PRICE_INPUT.NONE.YOY', periodRule: 'month' },
  '214876': { metricKey: 'NZ.PRODUCER_PRICE_OUTPUT.NONE.QOQ', periodRule: 'quarter' },
  '214877': { metricKey: 'NZ.PRODUCER_PRICE_OUTPUT.NONE.YOY', periodRule: 'month' },
  '214950': { metricKey: 'NZ.RETAIL_SALES.NONE.QOQ', periodRule: 'quarter' },
  '214951': { metricKey: 'NZ.RETAIL_SALES.NONE.YOY', periodRule: 'month' },
})
