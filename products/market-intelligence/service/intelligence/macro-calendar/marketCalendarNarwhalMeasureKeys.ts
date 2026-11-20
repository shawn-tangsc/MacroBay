/**
 * **Narwhal 的 `measure` → 规范指标键**：一张纯数据表，从 `marketCalendarMetricIdentity.ts`
 * 抽出来（2026-11-21 文件体积门禁：身份模块被它顶到 525 行）。
 *
 * 抽出的理由不是「大」而是「不同职责」：那个文件管**身份怎么算**（期次规则、国家归一、身份编解码），
 * 这张表只是**源内码怎么对照**。改这张表不该把人引到身份算法里去，反之亦然。
 *
 * 数据出处与红线照旧（下段原文），**只增不改**：改一条就要重跑身份守卫。
 */

/** Narwhal 的 `values[].measure` → 规范指标键（132 条，来自 16 号表；`measure ↔ metric_key` 双射）。
 * 这 132 条是**已见过的**，不是全量：以后每批冒出新的 measure 是正常的，落 `unknown-measure` 就该补。 */
export const narwhalMeasureMetricKeys: Readonly<Record<string, string>> = Object.freeze({
  adp_employment_change: 'US.ADP.SA.CHANGE',  // usa-employment-statistics
  average_hourly_earnings_mom: 'US.AHE.SA.MOM',  // usa-wages-and-earnings
  average_hourly_earnings_yoy: 'US.AHE.NSA.YOY',  // usa-wages-and-earnings
  building_permits: 'US.BUILDING_PERMITS.NONE.COUNT',  // usa-building-permits
  building_permits_mom: 'US.BUILDING_PERMITS.NONE.MOM',  // usa-building-permits
  business_inventories_mom: 'US.BUSINESS_INVENTORIES.SA.MOM',  // usa-business-inventories
  capacity_utilization: 'US.CAPACITY_UTILIZATION.SA.RATE',  // usa-industrial-production
  chicago_pmi: 'US.CHICAGO_PMI.SA.LEVEL',  // usa-chicago-pmi
  composite_pmi: 'US.SP_COMPOSITE_PMI.SA.LEVEL',  // usa-composite-pmi
  construction_spending_mom: 'US.CONSTRUCTION_SPENDING.SA.MOM',  // usa-construction-spending
  consumer_confidence: 'US.CONSUMER_CONFIDENCE.SA.LEVEL',  // usa-consumer-confidence
  consumer_confidence_index: 'US.CONFERENCE_BOARD_CONFIDENCE.NONE.LEVEL',  // usa-consumer-confidence
  consumer_credit_growth: 'US.CONSUMER_CREDIT.SA.CHANGE',  // usa-credit-statistics
  consumer_current_conditions_michigan: 'US.MICHIGAN_CURRENT.NONE.LEVEL',  // usa-consumer-confidence
  consumer_expectations_michigan: 'US.MICHIGAN_EXPECTATIONS.NONE.LEVEL',  // usa-consumer-confidence
  consumer_sentiment_michigan: 'US.MICHIGAN_SENTIMENT.NONE.LEVEL',  // usa-consumer-confidence
  continuing_claims: 'US.JOBLESS_CLAIMS_CONTINUING.SA.COUNT',  // usa-jobless-claims
  core_capital_goods_orders_mom: 'US.CORE_CAPEX_ORDERS.SA.MOM',  // usa-durable-goods-orders
  core_cpi_mom: 'US.CORE_CPI.SA.MOM',  // usa-consumer-prices
  core_cpi_yoy: 'US.CORE_CPI.NSA.YOY',  // usa-consumer-prices
  core_pce_price_index_mom: 'US.CORE_PCE.SA.MOM',  // usa-income-and-spending
  core_pce_price_index_yoy: 'US.CORE_PCE.SA.YOY',  // usa-income-and-spending
  core_producer_price_change_mom: 'US.CORE_PPI.SA.MOM',  // usa-producer-prices
  core_producer_price_change_yoy: 'US.CORE_PPI.NSA.YOY',  // usa-producer-prices
  corporate_profits_qoq: 'US.CORPORATE_PROFITS.SA.QOQ',  // usa-corporate-profits
  cpi_cleveland_mom: 'US.CPI_CLEVELAND.NONE.MOM',  // usa-consumer-prices
  cpi_mom: 'US.CPI.SA.MOM',  // usa-consumer-prices
  cpi_yoy: 'US.CPI.NSA.YOY',  // usa-consumer-prices
  current_account_balance: 'US.CURRENT_ACCOUNT.NONE.DIFF',  // usa-balance-of-payments
  dallas_fed_manufacturing: 'US.DALLAS_FED_MANUFACTURING.SA.LEVEL',  // usa-dallas-fed-manufacturing-survey
  dallas_fed_services: 'US.DALLAS_FED_SERVICES.SA.LEVEL',  // usa-dallas-fed-services-survey
  dallas_fed_services_revenues: 'US.DALLAS_FED_SERVICES_REVENUES.SA.LEVEL',  // usa-dallas-fed-services-survey
  durable_goods_orders_ex_defense_mom: 'US.DURABLE_GOODS_EX_DEFENSE.SA.MOM',  // usa-durable-goods-orders
  durable_goods_orders_ex_transport_mom: 'US.DURABLE_GOODS_EX_TRANSPORT.SA.MOM',  // usa-durable-goods-orders
  durable_goods_orders_mom: 'US.DURABLE_GOODS_ORDERS.SA.MOM',  // usa-durable-goods-orders
  empire_state_manufacturing: 'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL',  // usa-empire-state-manufacturing-survey
  employment_trends_index: 'US.LEI_EMPLOYMENT_TRENDS.NONE.LEVEL',  // usa-leading-indicators
  existing_home_sales: 'US.EXISTING_HOME_SALES.SA.COUNT',  // usa-existing-home-sales
  existing_home_sales_mom: 'US.EXISTING_HOME_SALES.SA.MOM',  // usa-existing-home-sales
  export_price_mom: 'US.EXPORT_PRICES.SA.MOM',  // usa-import-and-export-prices
  export_price_yoy: 'US.EXPORT_PRICES.NSA.YOY',  // usa-import-and-export-prices
  factory_orders_ex_transport_mom: 'US.FACTORY_ORDERS_EX_TRANSPORT.SA.MOM',  // usa-factory-orders
  factory_orders_mom: 'US.FACTORY_ORDERS.SA.MOM',  // usa-factory-orders
  federal_deficit: 'US.FEDERAL_BUDGET.NONE.DIFF',  // usa-public-finances
  gdp_nowcast_qoq_annualized: 'US.GDP_NOWCAST.SA.ANNUALIZED_QOQ',  // usa-gdp-nowcast
  government_payrolls_change: 'US.GOVERNMENT_PAYROLLS.SA.CHANGE',  // usa-payroll-employment
  home_price_composite_mom: 'US.CASE_SHILLER_COMPOSITE.SA.MOM',  // usa-house-prices
  home_price_composite_yoy: 'US.CASE_SHILLER_COMPOSITE.NSA.YOY',  // usa-house-prices
  house_price_index: 'US.FHFA_HOUSE_PRICE.SA.LEVEL',  // usa-house-prices
  house_price_index_mom: 'US.FHFA_HOUSE_PRICE.SA.MOM',  // usa-house-prices
  house_price_index_yoy: 'US.FHFA_HOUSE_PRICE.NSA.YOY',  // usa-house-prices
  housing_market_index: 'US.NAHB_HOUSING_MARKET.NONE.LEVEL',  // usa-housing-market-index
  housing_starts: 'US.HOUSING_STARTS.SA.COUNT',  // usa-housing-starts
  housing_starts_mom: 'US.HOUSING_STARTS.SA.MOM',  // usa-housing-starts
  import_price_mom: 'US.IMPORT_PRICES.SA.MOM',  // usa-import-and-export-prices
  import_price_yoy: 'US.IMPORT_PRICES.NSA.YOY',  // usa-import-and-export-prices
  industrial_production_mom: 'US.INDUSTRIAL_PRODUCTION.SA.MOM',  // usa-industrial-production
  industrial_production_yoy: 'US.INDUSTRIAL_PRODUCTION.NSA.YOY',  // usa-industrial-production
  inflation_expectations: 'US.INFLATION_EXPECTATIONS.NONE.LEVEL',  // usa-inflation-expectations
  inflation_expectations_1y: 'US.MICHIGAN_INFLATION_1Y.NONE.LEVEL',  // usa-consumer-confidence
  inflation_expectations_5y: 'US.MICHIGAN_INFLATION_5Y.NONE.LEVEL',  // usa-consumer-confidence
  initial_claims: 'US.JOBLESS_CLAIMS_INITIAL.SA.COUNT',  // usa-jobless-claims
  initial_claims_4w_average: 'US.JOBLESS_CLAIMS_4W_AVERAGE.SA.AVERAGE',  // usa-jobless-claims
  ism_manufacturing_employment: 'US.ISM_MANUFACTURING_EMPLOYMENT.SA.LEVEL',  // usa-ism-manufacturing-pmi
  ism_manufacturing_new_orders: 'US.ISM_MANUFACTURING_NEW_ORDERS.SA.LEVEL',  // usa-ism-manufacturing-pmi
  ism_manufacturing_pmi: 'US.ISM_MANUFACTURING.SA.LEVEL',  // usa-ism-manufacturing-pmi
  ism_manufacturing_prices: 'US.ISM_MANUFACTURING_PRICES.SA.LEVEL',  // usa-ism-manufacturing-pmi
  ism_services_business_activity: 'US.ISM_SERVICES_BUSINESS_ACTIVITY.SA.LEVEL',  // usa-ism-services-pmi
  ism_services_employment: 'US.ISM_SERVICES_EMPLOYMENT.SA.LEVEL',  // usa-ism-services-pmi
  ism_services_new_orders: 'US.ISM_SERVICES_NEW_ORDERS.SA.LEVEL',  // usa-ism-services-pmi
  ism_services_pmi: 'US.ISM_SERVICES.SA.LEVEL',  // usa-ism-services-pmi
  ism_services_prices: 'US.ISM_SERVICES_PRICES.SA.LEVEL',  // usa-ism-services-pmi
  job_openings: 'US.JOLTS_OPENINGS.SA.COUNT',  // usa-job-openings
  job_quits: 'US.JOLTS_QUITS.SA.COUNT',  // usa-job-openings
  kansas_fed_composite: 'US.KANSAS_FED_COMPOSITE.SA.LEVEL',  // usa-kansas-city-fed-manufacturing-survey
  kansas_fed_manufacturing: 'US.KANSAS_FED_MANUFACTURING.SA.LEVEL',  // usa-kansas-city-fed-manufacturing-survey
  leading_index_mom: 'US.LEI.SA.MOM',  // usa-leading-indicators
  logistics_managers_index: 'US.LOGISTICS_MANAGERS_INDEX.NONE.LEVEL',  // usa-logistics-managers-index
  manufacturing_payrolls_change: 'US.MANUFACTURING_PAYROLLS.SA.CHANGE',  // usa-payroll-employment
  manufacturing_pmi: 'US.SP_MANUFACTURING_PMI.SA.LEVEL',  // usa-manufacturing-pmi
  manufacturing_production_mom: 'US.MANUFACTURING_PRODUCTION.SA.MOM',  // usa-industrial-production
  manufacturing_production_yoy: 'US.MANUFACTURING_PRODUCTION.NSA.YOY',  // usa-manufacturing-output
  mortgage_rate_15y: 'US.MORTGAGE_RATE_15Y.NONE.RATE',  // usa-mortgage-rates
  mortgage_rate_30y: 'US.MORTGAGE_RATE_30Y.NONE.RATE',  // usa-mortgage-rates
  national_activity_index: 'US.CHICAGO_FED_NATIONAL_ACTIVITY.NONE.LEVEL',  // usa-chicago-fed-activity-index
  new_home_sales: 'US.NEW_HOME_SALES.SA.COUNT',  // usa-new-home-sales
  new_home_sales_mom: 'US.NEW_HOME_SALES.SA.MOM',  // usa-new-home-sales
  nonfarm_payrolls_change: 'US.NONFARM.SA.CHANGE',  // usa-employment-report
  nonfarm_productivity_qoq: 'US.PRODUCTIVITY.SA.QOQ',  // usa-productivity-and-costs
  participation_rate: 'US.PARTICIPATION_RATE.SA.RATE',  // usa-unemployment
  pce_price_index_mom: 'US.PCE.SA.MOM',  // usa-income-and-spending
  pce_price_index_yoy: 'US.PCE.SA.YOY',  // usa-income-and-spending
  pending_home_sales_mom: 'US.PENDING_HOME_SALES.SA.MOM',  // usa-pending-home-sales
  pending_home_sales_yoy: 'US.PENDING_HOME_SALES.NSA.YOY',  // usa-pending-home-sales
  personal_income_mom: 'US.PERSONAL_INCOME.SA.MOM',  // usa-income-and-spending
  personal_spending_mom: 'US.PERSONAL_SPENDING.SA.MOM',  // usa-income-and-spending
  philly_fed_business_conditions: 'US.PHILLY_FED_BUSINESS_CONDITIONS.SA.LEVEL',  // usa-philadelphia-fed-manufacturing-survey
  philly_fed_capex: 'US.PHILLY_FED_CAPEX.SA.LEVEL',  // usa-philadelphia-fed-manufacturing-survey
  philly_fed_employment: 'US.PHILLY_FED_EMPLOYMENT.SA.LEVEL',  // usa-philadelphia-fed-manufacturing-survey
  philly_fed_manufacturing: 'US.PHILLY_FED_MANUFACTURING.SA.LEVEL',  // usa-philadelphia-fed-manufacturing-survey
  philly_fed_new_orders: 'US.PHILLY_FED_NEW_ORDERS.SA.LEVEL',  // usa-philadelphia-fed-manufacturing-survey
  philly_fed_prices_paid: 'US.PHILLY_FED_PRICES_PAID.SA.LEVEL',  // usa-philadelphia-fed-manufacturing-survey
  private_payrolls_change: 'US.PRIVATE_PAYROLLS.SA.CHANGE',  // usa-payroll-employment
  producer_price_change_mom: 'US.PPI_FINAL_DEMAND.SA.MOM',  // usa-producer-prices
  producer_price_change_yoy: 'US.PPI_FINAL_DEMAND.NSA.YOY',  // usa-producer-prices
  producer_price_ex_food_energy_trade_change_mom: 'US.PPI_EX_FOOD_ENERGY_TRADE.SA.MOM',  // usa-producer-prices
  producer_price_ex_food_energy_trade_change_yoy: 'US.PPI_EX_FOOD_ENERGY_TRADE.NSA.YOY',  // usa-producer-prices
  producer_price_index: 'US.PPI.SA.LEVEL',  // usa-producer-prices
  producer_prices_mom: 'US.PPI.SA.MOM',  // usa-producer-prices
  producer_prices_yoy: 'US.PPI.NSA.YOY',  // usa-producer-prices
  real_average_hourly_earnings_mom: 'US.REAL_AHE.NONE.MOM',  // usa-wages-and-earnings
  real_average_hourly_earnings_yoy: 'US.REAL_AHE.NONE.YOY',  // usa-wages-and-earnings
  retail_inventories_ex_autos_mom: 'US.RETAIL_INVENTORIES_EX_AUTOS.SA.MOM',  // usa-business-inventories
  retail_sales_control_group_mom: 'US.RETAIL_SALES_CONTROL_GROUP.SA.MOM',  // usa-retail-sales
  retail_sales_ex_autos_mom: 'US.RETAIL_SALES_EX_AUTOS.SA.MOM',  // usa-retail-sales
  retail_sales_ex_gas_autos_mom: 'US.RETAIL_SALES_EX_GAS_AUTOS.SA.MOM',  // usa-retail-sales
  retail_sales_mom: 'US.RETAIL_SALES.SA.MOM',  // usa-retail-sales
  retail_sales_yoy: 'US.RETAIL_SALES.NSA.YOY',  // usa-retail-sales
  richmond_fed_manufacturing: 'US.RICHMOND_FED_MANUFACTURING.SA.LEVEL',  // usa-richmond-fed-manufacturing-survey
  richmond_fed_services: 'US.RICHMOND_FED_SERVICES.SA.LEVEL',  // usa-richmond-fed-services-survey
  richmond_fed_shipments: 'US.RICHMOND_FED_SHIPMENTS.SA.LEVEL',  // usa-richmond-fed-manufacturing-survey
  same_store_sales_yoy: 'US.REDBOOK_RETAIL_SALES.NONE.YOY',  // usa-retail-sales
  services_pmi: 'US.SP_SERVICES_PMI.SA.LEVEL',  // usa-services-pmi
  small_business_optimism: 'US.NFIB_OPTIMISM.NONE.LEVEL',  // usa-small-business-optimism
  trade_balance: 'US.TRADE_BALANCE.NONE.DIFF',  // usa-goods-and-services-trade
  unemployment_rate: 'US.UNEMPLOYMENT.SA.RATE',  // usa-employment-report
  unemployment_rate_u6: 'US.UNEMPLOYMENT_U6.SA.RATE',  // usa-unemployment
  used_car_prices_mom: 'US.USED_CAR_PRICES.NONE.MOM',  // usa-used-car-prices
  used_car_prices_yoy: 'US.USED_CAR_PRICES.NONE.YOY',  // usa-used-car-prices
  vehicle_sales_total: 'US.VEHICLE_SALES.SA.COUNT',  // usa-vehicle-sales
  wholesale_inventories_mom: 'US.WHOLESALE_INVENTORIES.SA.MOM',  // usa-business-inventories
  wholesale_sales_mom: 'US.WHOLESALE_SALES.SA.MOM',  // usa-wholesale-trade
})
