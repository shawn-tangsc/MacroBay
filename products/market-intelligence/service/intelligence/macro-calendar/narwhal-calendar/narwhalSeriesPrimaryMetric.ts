/**
 * 源里的 `series_id` → **该发布组的主测度码**（从 16 号 measure 表 + 19 号发布组表生成）。
 *
 * 干什么用：来源有时**只给日程、不给任何 measure**（实测 11+12 月美国 21 条）。这种发布按
 * measure 拆行无从拆起，但读者仍要知道「这天有这个发布」。于是按**同一个发布组的主测度**给它
 * 一条身份——和官方日程展开是同一套规则，不为它发明第二种身份。
 *
 * 两条边界：
 * 1. **只收组唯一的 series**。一个 series 映射到两个组的（`usa-consumer-prices` 同时有 CPI 与
 *    CPI 即时预测这种）**故意不收**：那时「按哪个组给身份」只能猜，猜错就把两个组混成一行。
 *    落到这些 series 上就照旧记 `no-values`，等来源给出 measure 再说。
 * 2. 这张表**同时是那道门**：在表里＝「这个 series 有 measure 依据」，可以给它指标身份；
 *    不在表里＝没有依据，只有来源明确「已发布」时才允许退成事件型行（见构造器注释）。
 *    所以别为了「多显示一行」往里塞没依据的 series。
 *
 * 表是数据：由 16/19 号 CSV 生成，运行时**不读** `docs-private`。改表要重新生成并跑守卫用例。
 */
export const narwhalPrimaryMetricBySeriesId: Readonly<Record<string, string>> = Object.freeze({
  'usa-balance-of-payments': 'US.CURRENT_ACCOUNT.NONE.DIFF',
  'usa-building-permits': 'US.HOUSING_STARTS.SA.COUNT',
  'usa-business-inventories': 'US.BUSINESS_INVENTORIES.SA.MOM',
  'usa-chicago-fed-activity-index': 'US.CHICAGO_FED_NATIONAL_ACTIVITY.NONE.LEVEL',
  'usa-chicago-pmi': 'US.CHICAGO_PMI.SA.LEVEL',
  'usa-composite-pmi': 'US.SP_COMPOSITE_PMI.SA.LEVEL',
  'usa-construction-spending': 'US.CONSTRUCTION_SPENDING.SA.MOM',
  'usa-corporate-profits': 'US.CORPORATE_PROFITS.SA.QOQ',
  'usa-credit-statistics': 'US.CONSUMER_CREDIT.SA.CHANGE',
  'usa-dallas-fed-manufacturing-survey': 'US.DALLAS_FED_MANUFACTURING.SA.LEVEL',
  'usa-dallas-fed-services-survey': 'US.DALLAS_FED_MANUFACTURING.SA.LEVEL',
  'usa-durable-goods-orders': 'US.DURABLE_GOODS_ORDERS.SA.MOM',
  'usa-empire-state-manufacturing-survey': 'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL',
  'usa-employment-report': 'US.NONFARM.SA.CHANGE',
  'usa-employment-statistics': 'US.ADP.SA.CHANGE',
  'usa-existing-home-sales': 'US.EXISTING_HOME_SALES.SA.COUNT',
  'usa-factory-orders': 'US.FACTORY_ORDERS.SA.MOM',
  'usa-gdp-nowcast': 'US.GDP_NOWCAST.SA.ANNUALIZED_QOQ',
  'usa-goods-and-services-trade': 'US.TRADE_BALANCE.NONE.DIFF',
  'usa-housing-market-index': 'US.NAHB_HOUSING_MARKET.NONE.LEVEL',
  'usa-housing-starts': 'US.HOUSING_STARTS.SA.COUNT',
  'usa-import-and-export-prices': 'US.IMPORT_PRICES.SA.MOM',
  'usa-income-and-spending': 'US.CORE_PCE.NSA.YOY',
  'usa-industrial-production': 'US.INDUSTRIAL_PRODUCTION.SA.MOM',
  'usa-inflation-expectations': 'US.INFLATION_EXPECTATIONS.NONE.LEVEL',
  'usa-ism-manufacturing-pmi': 'US.ISM_MANUFACTURING.SA.LEVEL',
  'usa-ism-services-pmi': 'US.ISM_SERVICES.SA.LEVEL',
  'usa-job-openings': 'US.JOLTS_OPENINGS.SA.COUNT',
  'usa-job-vacancies': 'US.JOLTS_OPENINGS.SA.COUNT',
  'usa-jobless-claims': 'US.JOBLESS_CLAIMS_INITIAL.SA.COUNT',
  'usa-kansas-city-fed-manufacturing-survey': 'US.KANSAS_FED_COMPOSITE.SA.LEVEL',
  'usa-leading-indicators': 'US.LEI.SA.MOM',
  'usa-logistics-managers-index': 'US.LOGISTICS_MANAGERS_INDEX.NONE.LEVEL',
  'usa-manufacturing-output': 'US.INDUSTRIAL_PRODUCTION.SA.MOM',
  'usa-manufacturing-pmi': 'US.SP_COMPOSITE_PMI.SA.LEVEL',
  'usa-mortgage-rates': 'US.MORTGAGE_RATE_30Y.NONE.RATE',
  'usa-new-home-sales': 'US.NEW_HOME_SALES.SA.COUNT',
  'usa-payroll-employment': 'US.NONFARM.SA.CHANGE',
  'usa-pending-home-sales': 'US.PENDING_HOME_SALES.SA.MOM',
  'usa-philadelphia-fed-manufacturing-survey': 'US.PHILLY_FED_MANUFACTURING.SA.LEVEL',
  'usa-producer-prices': 'US.PPI.NSA.YOY',
  'usa-productivity-and-costs': 'US.PRODUCTIVITY.SA.QOQ',
  'usa-public-finances': 'US.FEDERAL_BUDGET.NONE.DIFF',
  'usa-richmond-fed-manufacturing-survey': 'US.RICHMOND_FED_MANUFACTURING.SA.LEVEL',
  'usa-richmond-fed-services-survey': 'US.RICHMOND_FED_MANUFACTURING.SA.LEVEL',
  'usa-services-pmi': 'US.SP_COMPOSITE_PMI.SA.LEVEL',
  'usa-small-business-optimism': 'US.NFIB_OPTIMISM.NONE.LEVEL',
  'usa-unemployment': 'US.NONFARM.SA.CHANGE',
  'usa-used-car-prices': 'US.USED_CAR_PRICES.NONE.MOM',
  'usa-vehicle-sales': 'US.VEHICLE_SALES.SA.COUNT',
  'usa-wages-and-earnings': 'US.NONFARM.SA.CHANGE',
  'usa-wholesale-trade': 'US.BUSINESS_INVENTORIES.SA.MOM',
})

/** 故意不收的多组 series：按名字猜组会把两个组混成一行。 */
export const narwhalAmbiguousSeriesIds: readonly string[] = Object.freeze([
  'usa-consumer-confidence',
  'usa-consumer-prices',
  'usa-house-prices',
  'usa-retail-sales',
])
