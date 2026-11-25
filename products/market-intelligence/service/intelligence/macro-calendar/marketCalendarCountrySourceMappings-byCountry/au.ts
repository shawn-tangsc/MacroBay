import type { ZeroXRouterPeriodRule } from '../marketCalendarMetricIdentity'

/**
 * 按国家拆开的「源内 id → 码」映射（AU）。**数据型注册表，纯声明**：一行一个源内身份。
 *
 * 只收期次可定、测度一致的映射；目标码必须存在于码表（守卫在索引里断）。
 */
export const mapping_AU: Readonly<Record<string, Readonly<{ metricKey: string; periodRule: ZeroXRouterPeriodRule }>>> = Object.freeze({
  '4258': { metricKey: 'AU.POLICY_RATE.NONE.LEVEL', periodRule: 'month' },
  '212780': { metricKey: 'AU.LOANS_PRIVATE_BUSINESS.NONE.YOY', periodRule: 'month' },
  '212903': { metricKey: 'AU.GDP.NONE.YOY', periodRule: 'month' },
  '213734': { metricKey: 'AU.WEST_PACIFIC_MELBOURNE_CONSUMER_CONFIDENCE.NONE.MOM', periodRule: 'month' },
  '213754': { metricKey: 'AU.AIG_CONSTRUCTION_PERFORMANCE.NONE.LEVEL', periodRule: 'month' },
  '213755': { metricKey: 'AU.AIG_PWC_MANUFACTURING_PERFORMANCE.NONE.LEVEL', periodRule: 'month' },
  '213841': { metricKey: 'AU.NAB_BUSINESS_CLIMATE.NONE.LEVEL', periodRule: 'month' },
  '213842': { metricKey: 'AU.NAB_BUSINESS_CONFIDENCE.NONE.LEVEL', periodRule: 'month' },
  '213854': { metricKey: 'AU.WEST_PACIFIC_LEADING_METRIC.NONE.MOM', periodRule: 'month' },
  '213885': { metricKey: 'AU.CHANGES_MULTICLASSING_EMPLOYMENT_POPULATION.NONE.LEVEL', periodRule: 'month' },
  '213886': { metricKey: 'AU.CHANGE_FULL_TIME_EMPLOYMENT_POPULATION.NONE.LEVEL', periodRule: 'month' },
  '214010': { metricKey: 'AU.CONSUMER_PRICE.NONE.QOQ', periodRule: 'quarter' },
  '214011': { metricKey: 'AU.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214017': { metricKey: 'AU.TRADE_GOODS_SERVICES_ACCOUNT.SA.AMOUNT', periodRule: 'month' },
  '214018': { metricKey: 'AU.IMPORTS.NONE.MOM', periodRule: 'month' },
  '214019': { metricKey: 'AU.EXPORTS.NONE.MOM', periodRule: 'month' },
  '214162': { metricKey: 'AU.TD_MI_INFLATION.NONE.MOM', periodRule: 'month' },
  '214163': { metricKey: 'AU.TD_MI_INFLATION.NONE.YOY', periodRule: 'month' },
  '214259': { metricKey: 'AU.IMPORTS_PRICE.NONE.QOQ', periodRule: 'quarter' },
  '214260': { metricKey: 'AU.IMPORTS_PRICE.NONE.YOY', periodRule: 'month' },
  '214261': { metricKey: 'AU.EXPORTS_PRICE.NONE.QOQ', periodRule: 'quarter' },
  '214262': { metricKey: 'AU.EXPORTS_PRICE.NONE.YOY', periodRule: 'month' },
  '214306': { metricKey: 'AU.PRODUCER_PRICE.NONE.QOQ', periodRule: 'quarter' },
  '214307': { metricKey: 'AU.PRODUCER_PRICE.NONE.YOY', periodRule: 'month' },
  '214308': { metricKey: 'AU.PRIVATE_BUSINESS_LOANS.NONE.MOM', periodRule: 'month' },
  '214309': { metricKey: 'AU.LOANS_PRIVATE_BUSINESS.NONE.YOY', periodRule: 'month' },
  '214372': { metricKey: 'AU.SEASONAL_ADJUSTMENT_CONSTRUCTION_PERMITS.SA.MOM', periodRule: 'month' },
  '214373': { metricKey: 'AU.PRIVATE_BUILDING_PERMITS.SA.YOY', periodRule: 'month' },
  '214374': { metricKey: 'AU.SEASONAL_ADJUSTMENT_PRIVATE_CONSTRUCTION_PERMITS.SA.MOM', periodRule: 'month' },
  '214375': { metricKey: 'AU.BUILDING_PERMITS.SA.YOY', periodRule: 'month' },
  '214422': { metricKey: 'AU.AIG_CONSTRUCTION_PERFORMANCE.NONE.LEVEL', periodRule: 'month' },
  '214423': { metricKey: 'AU.AIG_PWC_MANUFACTURING_PERFORMANCE.NONE.LEVEL', periodRule: 'month' },
  '214560': { metricKey: 'AU.WEST_PACIFIC_MELBOURNE_CONSUMER_CONFIDENCE.NONE.MOM', periodRule: 'month' },
  '214567': { metricKey: 'AU.NAB_BUSINESS_CLIMATE.NONE.LEVEL', periodRule: 'month' },
  '214568': { metricKey: 'AU.NAB_BUSINESS_CONFIDENCE.NONE.LEVEL', periodRule: 'month' },
  '214717': { metricKey: 'AU.TD_MI_INFLATION.NONE.MOM', periodRule: 'month' },
  '214718': { metricKey: 'AU.TD_MI_INFLATION.NONE.YOY', periodRule: 'month' },
  '214837': { metricKey: 'AU.WEST_PACIFIC_LEADING_METRIC.NONE.MOM', periodRule: 'month' },
  '214838': { metricKey: 'AU.SALARY_PRICE.SA.QOQ', periodRule: 'quarter' },
  '214839': { metricKey: 'AU.SALARY_PRICE.SA.YOY', periodRule: 'month' },
  '214884': { metricKey: 'AU.CHANGES_MULTICLASSING_EMPLOYMENT_POPULATION.NONE.LEVEL', periodRule: 'month' },
  '214885': { metricKey: 'AU.CHANGE_FULL_TIME_EMPLOYMENT_POPULATION.NONE.LEVEL', periodRule: 'month' },
  '214999': { metricKey: 'AU.CONSTRUCTION_COMPLETION.NONE.QOQ', periodRule: 'quarter' },
  '215000': { metricKey: 'AU.CONSTRUCTION_COMPLETIONS.NONE.YOY', periodRule: 'month' },
  '215031': { metricKey: 'AU.PRIVATE_NEW_CAPITAL_EXPENDITURE.NONE.QOQ', periodRule: 'quarter' },
  '215032': { metricKey: 'AU.PRIVATE_NEW_CAPITAL_EXPENDITURE.NONE.YOY', periodRule: 'month' },
  '8640': { metricKey: 'AU.UNEMPLOYMENT.SA.RATE', periodRule: 'month' },  // 2 行 · 9月季调后失业率 | 10月季调后失业率
  '8641': { metricKey: 'AU.TRADE_GOODS_SERVICES_ACCOUNT.SA.AMOUNT', periodRule: 'month' },  // 1 行 · 8月季调后商品及服务贸易帐(百万澳元)
  '8924': { metricKey: 'AU.GDP.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第二季度GDP(年率)
  '8925': { metricKey: 'AU.PRODUCER_PRICE.NONE.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度生产者物价指数(季率)
  '8926': { metricKey: 'AU.PRODUCER_PRICE.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度生产者物价指数(年率)
  '8927': { metricKey: 'AU.CONSUMER_PRICE.NONE.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度消费者物价指数(季率)
  '8928': { metricKey: 'AU.CONSUMER_PRICE.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度消费者物价指数(年率)
  '9218': { metricKey: 'AU.PRIVATE_NEW_CAPITAL_EXPENDITURE.NONE.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度私人新增资本支出(季率)
  '9220': { metricKey: 'AU.PRIVATE_NEW_CAPITAL_EXPENDITURE.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度私人新增资本支出(年率)
  '9221': { metricKey: 'AU.CONSTRUCTION_COMPLETION.NONE.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度营建完工(季率)
  '9227': { metricKey: 'AU.NAB_BUSINESS_CLIMATE.NONE.LEVEL', periodRule: 'month' },  // 2 行 · 9月NAB商业景气指数 | 10月NAB商业景气指数
  '9228': { metricKey: 'AU.NAB_BUSINESS_CONFIDENCE.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 9月NAB商业信心指数 | 10月NAB商业信心指数
  '9230': { metricKey: 'AU.AIG_PWC_MANUFACTURING_PERFORMANCE.NONE.LEVEL', periodRule: 'month' },  // 2 行 · 9月AIG/PWC制造业表现指数 | 10月AIG/PWC制造业表现指数
  '9231': { metricKey: 'AU.AIG_CONSTRUCTION_PERFORMANCE.NONE.LEVEL', periodRule: 'month' },  // 2 行 · 9月AIG建筑业表现指数 | 10月AIG建筑业表现指数
  '9233': { metricKey: 'AU.TD_MI_INFLATION.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月TD-MI通胀指数(月率) | 10月TD-MI通胀指数(月率)
  '9234': { metricKey: 'AU.TD_MI_INFLATION.NONE.YOY', periodRule: 'month' },  // 2 行 · 9月TD-MI通胀指数(年率) | 10月TD-MI通胀指数(年率)
  '9235': { metricKey: 'AU.PRIVATE_BUSINESS_LOANS.NONE.MOM', periodRule: 'month' },  // 1 行 · 9月私营企业贷款(月率)
  '9236': { metricKey: 'AU.LOANS_PRIVATE_BUSINESS.NONE.YOY', periodRule: 'month' },  // 2 行 · 7月私营企业贷款(年率) | 9月私营企业贷款(年率)
  '9238': { metricKey: 'AU.SALARY_PRICE.SA.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度季调后薪资价格指数(季率)
  '9239': { metricKey: 'AU.WEST_PACIFIC_MELBOURNE_CONSUMER_CONFIDENCE.NONE.LEVEL', periodRule: 'current_month' },  // 2 行 · 10月西太平洋/墨尔本消费者信心指数 | 11月西太平洋/墨尔本消费者信心指数
  '9240': { metricKey: 'AU.WEST_PACIFIC_MELBOURNE_CONSUMER_CONFIDENCE.NONE.MOM', periodRule: 'current_month' },  // 2 行 · 10月西太平洋/墨尔本消费者信心指数(月率) | 11月西太平洋/墨尔本消费者信心指数(
  '9403': { metricKey: 'AU.IMPORTS.NONE.MOM', periodRule: 'month' },  // 1 行 · 8月进口(月率)
  '9404': { metricKey: 'AU.EXPORTS.NONE.MOM', periodRule: 'month' },  // 1 行 · 8月出口(月率)
  '9717': { metricKey: 'AU.BUILDING_PERMITS.SA.YOY', periodRule: 'month' },  // 1 行 · 9月季调营建许可(年率)
  '9718': { metricKey: 'AU.SEASONAL_ADJUSTMENT_CONSTRUCTION_PERMITS.SA.MOM', periodRule: 'month' },  // 1 行 · 9月季调营建许可(月率)
  '9719': { metricKey: 'AU.PRIVATE_BUILDING_PERMITS.SA.YOY', periodRule: 'month' },  // 1 行 · 9月季调私营营建许可(年率)
  '9720': { metricKey: 'AU.SEASONAL_ADJUSTMENT_PRIVATE_CONSTRUCTION_PERMITS.SA.MOM', periodRule: 'month' },  // 1 行 · 9月季调私营营建许可(月率)
  '9726': { metricKey: 'AU.WEST_PACIFIC_LEADING_METRIC.NONE.MOM', periodRule: 'month' },  // 2 行 · 9月西太平洋领先指标(月率) | 10月西太平洋领先指标(月率)
  '9727': { metricKey: 'AU.EXPORTS_PRICE.NONE.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度出口物价指数(季率)
  '9728': { metricKey: 'AU.EXPORTS_PRICE.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度出口物价指数(年率)
  '9729': { metricKey: 'AU.IMPORTS_PRICE.NONE.QOQ', periodRule: 'quarter' },  // 1 行 · 第三季度进口物价指数(季率)
  '9730': { metricKey: 'AU.IMPORTS_PRICE.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度进口物价指数(年率)
  '9733': { metricKey: 'AU.CONSTRUCTION_COMPLETIONS.NONE.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度营建完工(年率)
  '9738': { metricKey: 'AU.SALARY_PRICE.SA.YOY', periodRule: 'quarter' },  // 1 行 · 第三季度季调后薪资价格指数(年率)
})
