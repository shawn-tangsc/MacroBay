/**
 * 两张**纯展示**表的数据本体：指标名（键 = `metric_key`）与源类型名（键 = 源给的类型串）。
 *
 * 出处：
 * - `docs-private/iterations/0.4.4-calendar-sources/17-指标中文名-202611.csv`（37 条：本月 33 条 + 4 个头部指标）
 * - `docs-private/iterations/0.4.4-calendar-sources/18-源类型中文名-202611.csv`（14 条源类型名）
 *
 * **数据与取名逻辑分开放**：这里是数据，`marketCalendarDisplayNames.ts` 是逻辑。
 * 拆开的原因很实在——结构性守卫要断言「优先级顺序没有被抄第二份」（逻辑文件里不许出现那四个
 * key 的字面量），而**数据行里当然有这些 key**，两者放在一个文件里就变成互相打架。
 * 一句话区分：**抄的是「顺序」，不是「键」**。
 *
 * 纪律：只做展示（永不参与身份、永不参与标注资格）；只有指标名与类型名，没有个体名；只增不改。
 */

/** 指标显示名：`metric_key` → 中文名。 */
export const marketCalendarMetricDisplayNames: Readonly<Record<string, string>> = Object.freeze({
  'US.ADP.SA.CHANGE': 'ADP 就业人数变动',
  'US.AHE.SA.MOM': '平均时薪（月率）',
  'US.CONSTRUCTION_SPENDING.SA.MOM': '营建支出（月率）',
  'US.CONSUMER_CONFIDENCE.SA.LEVEL': '消费者信心指数',
  'US.CONSUMER_CREDIT.SA.CHANGE': '消费信贷变动',
  'US.CORE_CPI.NSA.YOY': '核心 CPI 年率',
  'US.CORE_CPI.SA.MOM': '核心 CPI（月率）',
  'US.CORE_PCE.NSA.YOY': '核心 PCE 年率',
  'US.CORE_PCE.SA.YOY': '核心 PCE 年率（季调）',
  'US.CORE_PPI.SA.MOM': '核心 PPI（月率）',
  'US.CPI.NSA.YOY': 'CPI 年率',
  'US.PCE.SA.YOY': 'PCE 年率（季调）',
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
  'US.NONFARM.SA.CHANGE': '新增就业',
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

/**
 * 国家码 → 本地化国家名。**只补有码没名的情况**（新源只给 `country_code`）；没有码就不显示，
 * 不猜。码用 ISO 3166-1 alpha-2（存储层口径，`US` / `DE` 这种）；身份层用 alpha-3，由
 * `toAlpha3Country` 归一，两者各管一段。
 */
export const marketCalendarCountryNames: Readonly<Record<string, Readonly<{ zh: string; en: string }>>> = Object.freeze({
  US: { zh: '美国', en: 'United States' },
  CA: { zh: '加拿大', en: 'Canada' },
  DE: { zh: '德国', en: 'Germany' },
  GB: { zh: '英国', en: 'United Kingdom' },
  FR: { zh: '法国', en: 'France' },
  IT: { zh: '意大利', en: 'Italy' },
  JP: { zh: '日本', en: 'Japan' },
  CN: { zh: '中国', en: 'China' },
  EU: { zh: '欧元区', en: 'Euro area' },
  // `EMU` 是我们唯一的非 ISO 例外（欧元区没有 alpha-2），国名与 `EU` 同义。
  EMU: { zh: '欧元区', en: 'Euro area' }
})

/** 源类型显示名：源给的类型串 → 中文名。都是类型，不含个体。 */
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
