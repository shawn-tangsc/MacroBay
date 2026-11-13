/**
 * 两张**纯展示**表：指标名（键 = `metric_key`）与源类型名（键 = 源给的类型串）。
 *
 * 出处：
 * - `docs-private/iterations/0.4.4-calendar-sources/17-指标中文名-202611.csv`（33 条，本月实际出现的 key）
 * - `docs-private/iterations/0.4.4-calendar-sources/18-源类型中文名-202611.csv`（14 条源类型名）
 *
 * **纪律（写死）**：
 * - 只做展示：**永不参与身份、永不参与曲线标注资格**。判身份看写入时定下的 `candidate_key`，
 *   判标注看四个 `metric_key` 与两个 `series_id`；这两张表不许进那条链。
 * - 表里只有指标名与源类型名，**不许出现个体名**（讲话人、具体会议名）。
 * - 只增不改：改一个名字等于改读者看到的历史认知，要单独提一笔并写理由。
 * - 未知键**回退英文原文**并计数（计数只进日志，不上界面）。
 * - 只提供中文；英文界面直接用源给的英文名，所以这里没有 `en` 列。
 */

/** 指标显示名：`metric_key` → 中文名。33 条，本月实际出现过的那批。 */
export const marketCalendarMetricDisplayNames: Readonly<Record<string, string>> = Object.freeze({
  'US.ADP.SA.CHANGE': 'ADP 就业人数变动',
  'US.AHE.SA.MOM': '平均时薪（月率）',
  'US.CONSTRUCTION_SPENDING.SA.MOM': '营建支出（月率）',
  'US.CONSUMER_CONFIDENCE.SA.LEVEL': '消费者信心指数',
  'US.CONSUMER_CREDIT.SA.CHANGE': '消费信贷变动',
  'US.CORE_CPI.SA.MOM': '核心 CPI（月率）',
  'US.CORE_PPI.SA.MOM': '核心 PPI（月率）',
  'US.EXISTING_HOME_SALES.SA.COUNT': '成屋销售（年化）',
  'US.FACTORY_ORDERS_EX_TRANSPORT.SA.MOM': '工厂订单（除运输·月率）',
  'US.FEDERAL_BUDGET.NONE.DIFF': '联邦预算',
  'US.GDP_NOWCAST.SA.ANNUALIZED_QOQ': 'GDP 即时预测（年化季率）',
  'US.GOVERNMENT_PAYROLLS.SA.CHANGE': '政府部门就业变动',
  'US.INFLATION_EXPECTATIONS.NONE.LEVEL': '通胀预期',
  'US.ISM_MANUFACTURING_EMPLOYMENT.SA.LEVEL': 'ISM 制造业就业',
  'US.ISM_SERVICES_BUSINESS_ACTIVITY.SA.LEVEL': 'ISM 服务业商业活动',
  'US.JOBLESS_CLAIMS_CONTINUING.SA.COUNT': '续请失业金人数',
  'US.JOLTS_OPENINGS.SA.COUNT': 'JOLTS 职位空缺',
  'US.LEI_EMPLOYMENT_TRENDS.NONE.LEVEL': '领先指标·就业趋势',
  'US.LOGISTICS_MANAGERS_INDEX.NONE.LEVEL': '物流经理指数',
  'US.MICHIGAN_CURRENT.NONE.LEVEL': '密歇根大学现况指数',
  'US.MORTGAGE_RATE_15Y.NONE.RATE': '15 年期抵押贷款利率',
  'US.MORTGAGE_RATE_30Y.NONE.RATE': '30 年期抵押贷款利率',
  'US.NFIB_OPTIMISM.NONE.LEVEL': 'NFIB 小型企业信心',
  'US.PARTICIPATION_RATE.SA.RATE': '劳动力参与率',
  'US.REDBOOK_RETAIL_SALES.NONE.YOY': '红皮书零售销售（年率）',
  'US.SP_COMPOSITE_PMI.SA.LEVEL': '标普全球综合 PMI',
  'US.SP_MANUFACTURING_PMI.SA.LEVEL': '标普全球制造业 PMI',
  'US.SP_SERVICES_PMI.SA.LEVEL': '标普全球服务业 PMI',
  'US.TRADE_BALANCE.NONE.DIFF': '贸易帐',
  'US.UNEMPLOYMENT.SA.RATE': '失业率',
  'US.USED_CAR_PRICES.NONE.MOM': '二手车价格（月率）',
  'US.VEHICLE_SALES.SA.COUNT': '汽车销量（年化）',
  'US.WHOLESALE_INVENTORIES.SA.MOM': '批发库存（月率）',
})

/** 源类型显示名：源给的类型串 → 中文名。14 条，都是类型，不含个体。 */
export const marketCalendarEventTypeDisplayNames: Readonly<Record<string, string>> = Object.freeze({
  'Central bank balance sheet': '央行资产负债表',
  'Central bank report': '央行报告',
  'Central bank speech': '央行讲话',
  'Commodity market report': '商品市场报告',
  'Economic policy meeting': '经济政策会议',
  'Employment statistics': '就业统计',
  'Fiscal report': '财政报告',
  'Futures positioning': '期货持仓',
  'Household debt': '家庭债务',
  'Merchandise trade': '商品贸易',
  'Money and credit': '货币与信贷',
  'Mortgage applications': '抵押贷款申请',
  'Oil rig count': '石油钻井数',
  'Petroleum inventories': '石油库存',
})

/** 未知键的计数：**只给日志与排期看，不许上界面**。 */
const unknownDisplayNames = { metricKeys: 0, eventTypes: 0 }

export function marketCalendarDisplayNameTally(): Readonly<{ metricKeys: number; eventTypes: number }> {
  return { ...unknownDisplayNames }
}

/**
 * 一个事件的展示标题。三条顺序，缺一条就退一位，最后一定退到源给的原文：
 * 1. 有 `eventNameKey` → 指标名表（这是「这一行是哪条指标」的规范叫法）；
 * 2. 否则按源给的标题去类型名表（讲话/报告这类）；
 * 3. 都没有 → 源原文（英文），并计数。**不翻译、不猜、不按相似度找。**
 */
export function marketCalendarDisplayTitle(input: Readonly<{
  rawTitle: string; eventNameKey: string | undefined; locale: 'zh' | 'en'
}>): string {
  if (input.locale !== 'zh') return input.rawTitle
  if (input.eventNameKey !== undefined) {
    const named = marketCalendarMetricDisplayNames[input.eventNameKey]
    if (named !== undefined) return named
    unknownDisplayNames.metricKeys += 1
  }
  const typed = marketCalendarEventTypeDisplayNames[input.rawTitle]
  if (typed !== undefined) return typed
  unknownDisplayNames.eventTypes += 1
  return input.rawTitle
}
