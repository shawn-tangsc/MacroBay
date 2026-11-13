/**
 * 跨源规范身份的**数据常量**：源内码 → `metric_key`。
 *
 * 数据出处（只增不改，改一条就要重跑身份守卫）：
 * - `docs-private/iterations/0.4.4-calendar-sources/14-映射表-美国202611-新源.csv`（Narwhal 70 条）
 * - `docs-private/iterations/0.4.4-calendar-sources/14-映射表-美国202611-旧源.csv`（0xRouter 85 条）
 *
 * 红线：**名字绝不参与匹配**。这里的键是「换语言后不变」的源内码（Narwhal 的
 * `measure`、0xRouter 的 `indicator_id` 数字），映射表里那些人读文案只用于人工复核。
 * 对不上的一律 `unmapped`——不猜、不按相似度、不拿名字兜底。
 */

/** Narwhal 的 `values[].measure` → 规范指标键。70 条，一一对应，无重复值。 */
export const narwhalMeasureMetricKeys: Readonly<Record<string, string>> = Object.freeze({
  adp_employment_change: 'US.ADP.SA.CHANGE',
  average_hourly_earnings_mom: 'US.AHE.SA.MOM',
  average_hourly_earnings_yoy: 'US.AHE.NSA.YOY',
  composite_pmi: 'US.SP_COMPOSITE_PMI.SA.LEVEL',
  construction_spending_mom: 'US.CONSTRUCTION_SPENDING.SA.MOM',
  consumer_confidence: 'US.CONSUMER_CONFIDENCE.SA.LEVEL',
  consumer_credit_growth: 'US.CONSUMER_CREDIT.GROWTH',
  consumer_current_conditions_mich: 'US.MICHIGAN_CURRENT.NONE.LEVEL',
  consumer_expectations_michigan: 'US.MICHIGAN_EXPECTATIONS.NONE.LEVEL',
  consumer_sentiment_michigan: 'US.MICHIGAN_SENTIMENT.NONE.LEVEL',
  continuing_claims: 'US.JOBLESS_CLAIMS_CONTINUING.SA.COUNT',
  core_cpi_mom: 'US.CORE_CPI.SA.MOM',
  core_cpi_yoy: 'US.CORE_CPI.NSA.YOY',
  core_producer_price_change_mom: 'US.CORE_PPI.SA.MOM',
  core_producer_price_change_yoy: 'US.CORE_PPI.NSA.YOY',
  cpi_cleveland_mom: 'US.CPI_CLEVELAND.NONE.MOM',
  cpi_mom: 'US.CPI.SA.MOM',
  cpi_yoy: 'US.CPI.NSA.YOY',
  employment_trends_index: 'US.LEI_EMPLOYMENT_TRENDS.NONE.LEVEL',
  existing_home_sales: 'US.EXISTING_HOME_SALES.SA.COUNT',
  existing_home_sales_mom: 'US.EXISTING_HOME_SALES.SA.MOM',
  factory_orders_ex_transport_mom: 'US.FACTORY_ORDERS_EX_TRANSPORT.SA.MOM',
  factory_orders_mom: 'US.FACTORY_ORDERS.SA.MOM',
  federal_deficit: 'US.FEDERAL_BUDGET.NONE.DIFF',
  gdp_nowcast_qoq_annualized: 'US.GDP_NOWCAST.SA.ANNUALIZED_QOQ',
  government_payrolls_change: 'US.GOVERNMENT_PAYROLLS.SA.CHANGE',
  inflation_expectations: 'US.INFLATION_EXPECTATIONS.NONE.LEVEL',
  inflation_expectations_1y: 'US.MICHIGAN_INFLATION_1Y.NONE.LEVEL',
  inflation_expectations_5y: 'US.MICHIGAN_INFLATION_5Y.NONE.LEVEL',
  initial_claims: 'US.JOBLESS_CLAIMS_INITIAL.SA.COUNT',
  initial_claims_4w_average: 'US.JOBLESS_CLAIMS_4W_AVERAGE.SA.AVERAGE',
  ism_manufacturing_employment: 'US.ISM_MANUFACTURING_EMPLOYMENT.SA.LEVEL',
  ism_manufacturing_new_orders: 'US.ISM_MANUFACTURING_NEW_ORDERS.SA.LEVEL',
  ism_manufacturing_pmi: 'US.ISM_MANUFACTURING.SA.LEVEL',
  ism_manufacturing_prices: 'US.ISM_MANUFACTURING_PRICES.SA.LEVEL',
  ism_services_business_activity: 'US.ISM_SERVICES_BUSINESS_ACTIVITY.SA.LEVEL',
  ism_services_employment: 'US.ISM_SERVICES_EMPLOYMENT.SA.LEVEL',
  ism_services_new_orders: 'US.ISM_SERVICES_NEW_ORDERS.SA.LEVEL',
  ism_services_pmi: 'US.ISM_SERVICES.SA.LEVEL',
  ism_services_prices: 'US.ISM_SERVICES_PRICES.SA.LEVEL',
  job_openings: 'US.JOLTS_OPENINGS.SA.COUNT',
  job_quits: 'US.JOLTS_QUITS.SA.COUNT',
  logistics_managers_index: 'US.LOGISTICS_MANAGERS_INDEX.NONE.LEVEL',
  manufacturing_payrolls_change: 'US.MANUFACTURING_PAYROLLS.SA.CHANGE',
  manufacturing_pmi: 'US.SP_MANUFACTURING_PMI.SA.LEVEL',
  mortgage_rate_15y: 'US.MORTGAGE_RATE_15Y.NONE.RATE',
  mortgage_rate_30y: 'US.MORTGAGE_RATE_30Y.NONE.RATE',
  nonfarm_payrolls_change: 'US.NONFARM.SA.CHANGE',
  participation_rate: 'US.PARTICIPATION_RATE.SA.RATE',
  private_payrolls_change: 'US.PRIVATE_PAYROLLS.SA.CHANGE',
  producer_price_change_mom: 'US.PPI_FINAL_DEMAND.SA.MOM',
  producer_price_change_yoy: 'US.PPI_FINAL_DEMAND.NSA.YOY',
  producer_price_ex_food_energy_trade_change_mom: 'US.PPI_EX_FOOD_ENERGY_TRADE.SA.MOM',
  producer_price_ex_food_energy_trade_change_yoy: 'US.PPI_EX_FOOD_ENERGY_TRADE.NSA.YOY',
  producer_price_index: 'US.PPI.SA.LEVEL',
  producer_prices_mom: 'US.PPI.SA.MOM',
  producer_prices_yoy: 'US.PPI.NSA.YOY',
  real_average_hourly_earnings_mom: 'US.REAL_AHE.NONE.MOM',
  real_average_hourly_earnings_yoy: 'US.REAL_AHE.NONE.YOY',
  same_store_sales_yoy: 'US.REDBOOK_RETAIL_SALES.NONE.YOY',
  services_pmi: 'US.SP_SERVICES_PMI.SA.LEVEL',
  small_business_optimism: 'US.NFIB_OPTIMISM.NONE.LEVEL',
  trade_balance: 'US.TRADE_BALANCE.NONE.DIFF',
  unemployment_rate: 'US.UNEMPLOYMENT.SA.RATE',
  unemployment_rate_u6: 'US.UNEMPLOYMENT_U6.SA.RATE',
  used_car_prices_mom: 'US.USED_CAR_PRICES.NONE.MOM',
  used_car_prices_yoy: 'US.USED_CAR_PRICES.NONE.YOY',
  vehicle_sales_total: 'US.VEHICLE_SALES.SA.COUNT',
  wholesale_inventories_mom: 'US.WHOLESALE_INVENTORIES.SA.MOM',
  wholesale_sales_mom: 'US.WHOLESALE_SALES.SA.MOM',
})

/** 0xRouter 的 `indicator_id`（已落库的 `indicator_id` 列）→ 规范指标键与期间规则。 */
export type ZeroXRouterPeriodRule = 'month' | 'week_end' | 'quarter'
export type ZeroXRouterIdentityEntry = Readonly<{ metricKey: string; periodRule: ZeroXRouterPeriodRule }>
export const zeroXRouterIndicatorIdentities: Readonly<Record<string, ZeroXRouterIdentityEntry>> = Object.freeze({
  '10098': { metricKey: 'US.SP_MANUFACTURING_PMI.SA.LEVEL', periodRule: 'month' },
  '9413': { metricKey: 'US.CONSTRUCTION_SPENDING.SA.MOM', periodRule: 'month' },
  '4013': { metricKey: 'US.ISM_MANUFACTURING.SA.LEVEL', periodRule: 'month' },
  '9260': { metricKey: 'US.ISM_MANUFACTURING_PRODUCTION.SA.LEVEL', periodRule: 'month' },
  '9258': { metricKey: 'US.ISM_MANUFACTURING_INVENTORIES.SA.LEVEL', periodRule: 'month' },
  '9256': { metricKey: 'US.ISM_MANUFACTURING_PRICES.SA.LEVEL', periodRule: 'month' },
  '9252': { metricKey: 'US.ISM_MANUFACTURING_EMPLOYMENT.SA.LEVEL', periodRule: 'month' },
  '9259': { metricKey: 'US.ISM_MANUFACTURING_NEW_ORDERS.SA.LEVEL', periodRule: 'month' },
  '10100': { metricKey: 'US.DURABLE_GOODS_EX_TRANSPORT.SA.MOM', periodRule: 'month' },
  '10106': { metricKey: 'US.DURABLE_GOODS_EX_DEFENSE.SA.MOM', periodRule: 'month' },
  '9417': { metricKey: 'US.REDBOOK_RETAIL_SALES.NONE.YOY', periodRule: 'week_end' },
  '10235': { metricKey: 'US.DURABLE_GOODS_ORDERS.SA.MOM', periodRule: 'month' },
  '10103': { metricKey: 'US.CORE_CAPEX_ORDERS.SA.MOM', periodRule: 'month' },
  '9436': { metricKey: 'US.FACTORY_ORDERS.SA.MOM', periodRule: 'month' },
  '10290': { metricKey: 'US.JOLTS_OPENINGS.SA.COUNT', periodRule: 'month' },
  '9424': { metricKey: 'US.API_CRUDE_STOCKS.NONE.CHANGE', periodRule: 'week_end' },
  '9423': { metricKey: 'US.API_GASOLINE_STOCKS.NONE.CHANGE', periodRule: 'week_end' },
  '9422': { metricKey: 'US.API_DISTILLATE_STOCKS.NONE.CHANGE', periodRule: 'week_end' },
  '9831': { metricKey: 'US.API_CUSHING_STOCKS.NONE.CHANGE', periodRule: 'week_end' },
  '9420': { metricKey: 'US.MBA_PURCHASE_INDEX.NONE.LEVEL', periodRule: 'week_end' },
  '9418': { metricKey: 'US.MBA_REFINANCE_INDEX.NONE.LEVEL', periodRule: 'week_end' },
  '9419': { metricKey: 'US.MBA_APPLICATIONS.NONE.LEVEL', periodRule: 'week_end' },
  '9421': { metricKey: 'US.MBA_RATE_30Y.NONE.RATE', periodRule: 'week_end' },
  '9106': { metricKey: 'US.ADP.SA.CHANGE', periodRule: 'month' },
  '4022': { metricKey: 'US.TRADE_BALANCE.NONE.DIFF', periodRule: 'month' },
  '8791': { metricKey: 'US.EXPORTS.NONE.AMOUNT', periodRule: 'month' },
  '8792': { metricKey: 'US.IMPORTS.NONE.AMOUNT', periodRule: 'month' },
  '10260': { metricKey: 'US.SP_SERVICES_PMI.SA.LEVEL', periodRule: 'month' },
  '10263': { metricKey: 'US.SP_COMPOSITE_PMI.SA.LEVEL', periodRule: 'month' },
  '9264': { metricKey: 'US.ISM_SERVICES_EMPLOYMENT.SA.LEVEL', periodRule: 'month' },
  '9262': { metricKey: 'US.ISM_SERVICES_SUPPLIER_DELIVERIES.SA.LEVEL', periodRule: 'month' },
  '4014': { metricKey: 'US.ISM_SERVICES.SA.LEVEL', periodRule: 'month' },
  '9261': { metricKey: 'US.ISM_SERVICES_NEW_ORDERS.SA.LEVEL', periodRule: 'month' },
  '9265': { metricKey: 'US.ISM_SERVICES_PRICES.SA.LEVEL', periodRule: 'month' },
  '9268': { metricKey: 'US.ISM_SERVICES_INVENTORIES.SA.LEVEL', periodRule: 'month' },
  '9811': { metricKey: 'US.EIA_CRUDE_STOCKS.NONE.CHANGE', periodRule: 'week_end' },
  '9917': { metricKey: 'US.EIA_CUSHING_STOCKS.NONE.CHANGE', periodRule: 'week_end' },
  '9809': { metricKey: 'US.EIA_DISTILLATE_STOCKS.NONE.CHANGE', periodRule: 'week_end' },
  '9393': { metricKey: 'US.EIA_REFINERY_UTILIZATION.NONE.RATE', periodRule: 'week_end' },
  '9810': { metricKey: 'US.EIA_GASOLINE_STOCKS.NONE.CHANGE', periodRule: 'week_end' },
  '9888': { metricKey: 'US.CHALLENGER_JOB_CUTS.NONE.YOY', periodRule: 'month' },
  '9433': { metricKey: 'US.CHALLENGER_JOB_CUTS.NONE.MOM', periodRule: 'month' },
  '9434': { metricKey: 'US.CHALLENGER_JOB_CUTS.NONE.COUNT', periodRule: 'month' },
  '8659': { metricKey: 'US.JOBLESS_CLAIMS_INITIAL.SA.COUNT', periodRule: 'week_end' },
  '10120': { metricKey: 'US.UNIT_LABOR_COSTS.SA.QOQ', periodRule: 'quarter' },
  '9251': { metricKey: 'US.JOBLESS_CLAIMS_CONTINUING.SA.COUNT', periodRule: 'week_end' },
  '9270': { metricKey: 'US.JOBLESS_CLAIMS_4W_AVERAGE.SA.AVERAGE', periodRule: 'week_end' },
  '10117': { metricKey: 'US.PRODUCTIVITY.SA.QOQ', periodRule: 'quarter' },
  '10293': { metricKey: 'US.GSCPI.NONE.LEVEL', periodRule: 'month' },
  '9425': { metricKey: 'US.EIA_NATURAL_GAS_STOCKS.NONE.CHANGE', periodRule: 'week_end' },
  '8656': { metricKey: 'US.NONFARM.SA.CHANGE', periodRule: 'month' },
  '4010': { metricKey: 'US.UNEMPLOYMENT.SA.RATE', periodRule: 'month' },
  '9272': { metricKey: 'US.AHE.SA.MOM', periodRule: 'month' },
  '9824': { metricKey: 'US.PRIVATE_PAYROLLS.SA.CHANGE', periodRule: 'month' },
  '9275': { metricKey: 'US.AVERAGE_WEEKLY_HOURS.SA.LEVEL', periodRule: 'month' },
  '9827': { metricKey: 'US.PARTICIPATION_RATE.SA.RATE', periodRule: 'month' },
  '9273': { metricKey: 'US.MANUFACTURING_PAYROLLS.SA.CHANGE', periodRule: 'month' },
  '9920': { metricKey: 'US.UNEMPLOYMENT_U6.SA.RATE', periodRule: 'month' },
  '9274': { metricKey: 'US.AHE.NSA.YOY', periodRule: 'month' },
  '9940': { metricKey: 'US.MICHIGAN_SENTIMENT.NONE.LEVEL', periodRule: 'month' },
  '10264': { metricKey: 'US.MICHIGAN_INFLATION_1Y.NONE.LEVEL', periodRule: 'month' },
  '10267': { metricKey: 'US.MICHIGAN_INFLATION_5Y.NONE.LEVEL', periodRule: 'month' },
  '10114': { metricKey: 'US.MICHIGAN_EXPECTATIONS.NONE.LEVEL', periodRule: 'month' },
  '10111': { metricKey: 'US.MICHIGAN_CURRENT.NONE.LEVEL', periodRule: 'month' },
  '9851': { metricKey: 'US.BAKER_HUGHES_OIL_RIGS.NONE.COUNT', periodRule: 'week_end' },
  '9853': { metricKey: 'US.BAKER_HUGHES_GAS_RIGS.NONE.COUNT', periodRule: 'week_end' },
  '9852': { metricKey: 'US.BAKER_HUGHES_TOTAL_RIGS.NONE.COUNT', periodRule: 'week_end' },
  '9766': { metricKey: 'US.CONSUMER_CREDIT.SA.CHANGE', periodRule: 'month' },
  '9440': { metricKey: 'US.WHOLESALE_SALES.SA.MOM', periodRule: 'month' },
  '10110': { metricKey: 'US.WHOLESALE_INVENTORIES.SA.MOM', periodRule: 'month' },
  '10279': { metricKey: 'US.NFIB_OPTIMISM.NONE.LEVEL', periodRule: 'month' },
  '8639': { metricKey: 'US.CORE_CPI.NSA.YOY', periodRule: 'month' },
  '8637': { metricKey: 'US.CPI.NSA.YOY', periodRule: 'month' },
  '4002': { metricKey: 'US.CORE_CPI.SA.LEVEL', periodRule: 'month' },
  '8638': { metricKey: 'US.CORE_CPI.SA.MOM', periodRule: 'month' },
  '9105': { metricKey: 'US.CPI.SA.MOM', periodRule: 'month' },
  '9806': { metricKey: 'US.REAL_AHE.NONE.MOM', periodRule: 'month' },
  '4001': { metricKey: 'US.CPI.NSA.LEVEL', periodRule: 'month' },
  '9290': { metricKey: 'US.EXISTING_HOME_SALES.SA.MOM', periodRule: 'month' },
  '4019': { metricKey: 'US.EXISTING_HOME_SALES.SA.COUNT', periodRule: 'month' },
  '4032': { metricKey: 'US.FEDERAL_BUDGET.NONE.DIFF', periodRule: 'month' },
  '8653': { metricKey: 'US.PPI.NSA.YOY', periodRule: 'month' },
  '8652': { metricKey: 'US.PPI.SA.MOM', periodRule: 'month' },
  '8654': { metricKey: 'US.CORE_PPI.SA.MOM', periodRule: 'month' },
  '8655': { metricKey: 'US.CORE_PPI.NSA.YOY', periodRule: 'month' },
})

/**
 * 规范身份：`(country_code, metric_key, period_key)` 三列，无第四列。
 *
 * `variant`（初值/修正/终值）不进身份键——修正值是同一事件的另一个值，不是另一个事件。
 */
export type MarketCalendarCanonicalIdentity = Readonly<{
  countryCode: string; metricKey: string; periodKey: string
}>

/** 身份的可比较字符串形式，做 join 用；分隔符取 `|`，三个字段都不含它。 */
export function canonicalIdentityKey(identity: MarketCalendarCanonicalIdentity): string {
  return `${identity.countryCode}|${identity.metricKey}|${identity.periodKey}`
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10)

/** 参照月 = 发布日的上一个月。CPI 十月数据在十一月发布，身份属于十月。 */
function previousMonthKey(scheduledAt: string): string {
  const date = new Date(scheduledAt)
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() - 1)
  return date.toISOString().slice(0, 7)
}

/** 参照周 = 发布日之前**最近的那个周六**（当天是周六就是当天）。 */
function previousWeekEndingKey(scheduledAt: string): string {
  const date = new Date(scheduledAt)
  date.setUTCHours(0, 0, 0, 0)
  const back = (date.getUTCDay() + 1) % 7
  date.setUTCDate(date.getUTCDate() - back)
  return isoDate(date)
}

/** 参照季 = 发布日所在季度的**上一个季度**（GDP 初值十月末发布，身份是 Q3）。 */
function previousQuarterKey(scheduledAt: string): string {
  const date = new Date(scheduledAt)
  const quarter = Math.floor(date.getUTCMonth() / 3)
  const year = date.getUTCFullYear() - (quarter === 0 ? 1 : 0)
  const previous = quarter === 0 ? 3 : quarter - 1
  return `${year}-Q${previous + 1}`
}

/**
 * 0xRouter 一行的规范身份。
 *
 * `indicator_id` 不在映射表里 → `undefined`：这就是「这条没有指标身份」，讲话、会议、
 * 选举这类行都在这里。它们**不参与合并**，按原样从旧源出。
 */
export function zeroXRouterCanonicalIdentity(row: Readonly<{
  countryCode: string | null; indicatorId: string | null; scheduledAt: string
}>): MarketCalendarCanonicalIdentity | undefined {
  if (!row.countryCode || !row.indicatorId) return undefined
  const entry = zeroXRouterIndicatorIdentities[row.indicatorId]
  if (!entry) return undefined
  const periodKey = entry.periodRule === 'month' ? previousMonthKey(row.scheduledAt)
    : entry.periodRule === 'week_end' ? previousWeekEndingKey(row.scheduledAt)
    : previousQuarterKey(row.scheduledAt)
  return { countryCode: row.countryCode, metricKey: entry.metricKey, periodKey }
}

/**
 * 合并规则：**同一个规范身份只出一行，出 Narwhal 那一行；Narwhal 没有的身份，旧源的行照常出。**
 *
 * `narwhalKeys` 是这一期 Narwhal 已经占住的身份集合；旧源里身份在集合内的行被顶掉，
 * 身份为空（讲话/会议）或不在集合内的行全部保留。
 */
export function keepRowsNotCoveredByNarwhal<T extends { row: Readonly<{ countryCode: string | null
  indicatorId: string | null; scheduledAt: string }> }>(
  rows: readonly T[], narwhalKeys: ReadonlySet<string>
): readonly T[] {
  if (narwhalKeys.size === 0) return rows
  return rows.filter((item) => {
    const identity = zeroXRouterCanonicalIdentity(item.row)
    return identity === undefined || !narwhalKeys.has(canonicalIdentityKey(identity))
  })
}

/**
 * Narwhal 一行的规范身份由**写入端**决定，读取端只认它写下的 `candidate_key`：
 * 形状固定为 `country|metric_key|period_key`。读不出来就是 `unmapped`，不猜。
 */
export function narwhalCanonicalIdentityKey(candidateKey: string): string | undefined {
  const parts = candidateKey.split('|')
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return undefined
  const [countryCode, metricKey, periodKey] = parts as [string, string, string]
  return canonicalIdentityKey({ countryCode, metricKey, periodKey })
}
