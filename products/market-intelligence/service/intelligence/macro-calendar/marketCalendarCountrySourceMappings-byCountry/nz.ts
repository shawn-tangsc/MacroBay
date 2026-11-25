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
  '9063': { metricKey: 'NZ.CONSUMER_PRICE.NONE.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度消费者物价指数(季率)
  '9686': { metricKey: 'NZ.BUILDING_PERMITS.NONE.YOY', periodRule: 'month' },  // 1 行 · 9月营建许可(年率)
  '9687': { metricKey: 'NZ.CONSTRUCTION_PERMIT.NONE.MOM', periodRule: 'month' },  // 1 行 · 9月营建许可(月率)
  '9690': { metricKey: 'NZ.FOOD_PRICE.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月食品价格指数(年率) | 10月食品价格指数(年率)
  '9691': { metricKey: 'NZ.FOOD_PRICE.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月食品价格指数(月率) | 10月食品价格指数(月率)
  '9692': { metricKey: 'NZ.12_MONTH_TRADE_BALANCE.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 至9月12个月贸易帐(百万纽元) | 至10月12个月贸易帐(百万纽元)
  '9694': { metricKey: 'NZ.EXPORTS.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 9月出口(十亿纽元) | 10月出口(十亿纽元)
  '9695': { metricKey: 'NZ.IMPORTS.NONE.AMOUNT', periodRule: 'month' },  // 2 行 · 9月进口(十亿纽元) | 10月进口(十亿纽元)
  '9696': { metricKey: 'NZ.CONSUMER_PRICE.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度消费者物价指数(年率)
  '9697': { metricKey: 'NZ.HLFS_EMPLOYMENT_TRANSMUTATION.NONE.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度HLFS就业人数变化(季率)
  '9699': { metricKey: 'NZ.PRODUCER_PRICE_OUTPUT.NONE.QOQ', periodRule: 'quarter' },  // 2 行 · 第三季度生产者物价输出指数(季率)
  '9700': { metricKey: 'NZ.PRODUCER_PRICE_OUTPUT.NONE.YOY', periodRule: 'quarter' },  // 2 行 · 第三季度生产者物价输出指数(年率)
  '9701': { metricKey: 'NZ.PRODUCER_PRICE_INPUT.NONE.QOQ', periodRule: 'quarter' },  // 2 行 · 第三季度生产者物价输入指数(季率)
  '9702': { metricKey: 'NZ.PRODUCER_PRICE_INPUT.NONE.YOY', periodRule: 'quarter' },  // 2 行 · 第三季度生产者物价输入指数(年率)
  '9703': { metricKey: 'NZ.LABOR_COST.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度劳工成本指数(年率)
  '9704': { metricKey: 'NZ.LABOR_COST.NONE.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度劳工成本指数(季率)
  '9705': { metricKey: 'NZ.AHE.NONE.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度平均小时薪资(季率)
  '9714': { metricKey: 'NZ.RETAIL_SALES.NONE.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度零售销售(季率)
  '9715': { metricKey: 'NZ.RETAIL_SALES.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度零售销售(年率)
  '9861': { metricKey: 'NZ.MANUFACTURING.NONE.LEVEL', periodRule: 'month' },  // 2 行 · 9月制造业表现指数 | 10月制造业表现指数
  '9872': { metricKey: 'NZ.SERVICE_INDUSTRY_PERFORMANCE.NONE.LEVEL', periodRule: 'month' },  // 2 行 · 9月服务业表现指数 | 10月服务业表现指数
  '9892': { metricKey: 'NZ.UNEMPLOYMENT.NONE.RATE', periodRule: 'quarter' },  // 1 行 · 第三季度失业率
})
