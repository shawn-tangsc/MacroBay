/**
 * 码名：**族名（measure-free）+ 测度词** 拼出来，已上线的 38 条用 `manualName` 冻结。
 *
 * 两级结构的原因：20 号表里那 38 行是**码级名**（`cpi` 写成「消费者物价指数（CPI）年率」），
 * 拿它当族名再拼测度，必然拼出「CPI 年率月率」。所以：
 * - `familyNameByFamily`：族名，**不许含年率/月率/季率/水平/变化/人数**（生成器会拒）；
 * - `measureNameByMeasure`：11 个闭集测度词的四名，词表外的测度**不生成**；
 * - `manualNameByMetricKey`：已上线或人工定过的码名，**逐字冻结**，生成器不许覆盖。
 *
 * 纪律：已上线名字改一个字节就是读者可见的文案变更，必须单独走一次「文案变更」，不许混在重构里。
 */

/** 测度词四名：闭集 11 个。词表外的测度一律不生成（落 `unmapped`、只记日志）。 */
export const measureNameByMeasure: Readonly<Record<string, Readonly<{
  zhFull: string; zhShort: string; enFull: string; enShort: string
}>>> = Object.freeze({
  YOY: { zhFull: '年率', zhShort: '年率', enFull: 'Year over year', enShort: 'YoY' },
  MOM: { zhFull: '月率', zhShort: '月率', enFull: 'Month over month', enShort: 'MoM' },
  QOQ: { zhFull: '季率', zhShort: '季率', enFull: 'Quarter over quarter', enShort: 'QoQ' },
  ANNUALIZED_QOQ: { zhFull: '年化季率', zhShort: '年化季率', enFull: 'Annualized quarter over quarter', enShort: 'Annualized QoQ' },
  LEVEL: { zhFull: '水平', zhShort: '水平', enFull: 'Level', enShort: 'Level' },
  RATE: { zhFull: '比率', zhShort: '比率', enFull: 'Rate', enShort: 'Rate' },
  CHANGE: { zhFull: '变化', zhShort: '变化', enFull: 'Change', enShort: 'Change' },
  COUNT: { zhFull: '人数', zhShort: '人数', enFull: 'Count', enShort: 'Count' },
  AMOUNT: { zhFull: '金额', zhShort: '金额', enFull: 'Amount', enShort: 'Amount' },
  DIFF: { zhFull: '差额', zhShort: '差额', enFull: 'Balance', enShort: 'Balance' },
  AVERAGE: { zhFull: '均值', zhShort: '均值', enFull: 'Average', enShort: 'Average' },
})

/** 族名：**measure-free**（不含测度词）。产品经理按族给，缺族 → 该族的码暂不生成。 */
export const familyNameByFamily: Readonly<Record<string, Readonly<{
  zhFull: string; zhShort: string; enFull: string; enShort: string
}>>> = Object.freeze({})

/** 已上线 / 人工定过的码名：逐字冻结，生成器不许覆盖。 */
/** 全部在用码的展示名：**来自产品经理过审的 23 号表（160 行）**，按 `metric_key` 键控。
 * 38 条已上线锁死，122 条是她生成的候选（已过四列唯一性检查）。 */
export const nameByMetricKey: Readonly<Record<string, Readonly<{
  zhFull: string; zhShort: string; enFull: string; enShort: string; locked: boolean
  /** 21 号别名表给出的短码（`cpi` 这套）；还没有短码的行不带这个字段。 */
  code?: string
}>>> = Object.freeze({
  'US.CURRENT_ACCOUNT.NONE.DIFF': { zhFull: '经常帐', zhShort: '经常帐', enFull: 'Current Account Balance', enShort: 'Current Account', locked: false, code: 'current-account' },
  'US.DALLAS_FED_SERVICES.SA.LEVEL': { zhFull: '达拉斯联储服务业活动指数', zhShort: '达拉斯联储服务业', enFull: 'Dallas Fed Services Index', enShort: 'Dallas Fed Svcs', locked: false, code: 'dallas-fed-services' },
  'US.DALLAS_FED_SERVICES_REVENUES.SA.LEVEL': { zhFull: '达拉斯联储服务业收入指数', zhShort: '达拉斯联储服务业收入', enFull: 'Dallas Fed Services Revenue Index', enShort: 'Dallas Fed Svcs Revenue', locked: false, code: 'dallas-fed-services-revenues' },
  'US.ADP.SA.CHANGE': { zhFull: 'ADP 就业人数变动', zhShort: 'ADP 就业', enFull: 'ADP Employment Change', enShort: 'ADP Employment', code: 'adp', locked: true },
  'US.AHE.SA.MOM': { zhFull: '平均每小时工资月率', zhShort: '平均时薪（月率）', enFull: 'Average Hourly Earnings, MoM', enShort: 'Avg Hourly Earnings', code: 'average-hourly-earnings', locked: true },
  'US.AHE.NSA.YOY': { zhFull: '平均每小时工资年率', zhShort: '平均时薪 年率', enFull: 'Average Hourly Earnings YoY', enShort: 'Avg Hourly Earnings YoY', locked: false },
  'US.API_CRUDE_STOCKS.NONE.CHANGE': { zhFull: 'API 原油库存', zhShort: 'API 原油库存', enFull: 'API Crude Oil Inventories', enShort: 'API Crude Stocks', locked: false },
  'US.API_CUSHING_STOCKS.NONE.CHANGE': { zhFull: 'API 库欣原油库存', zhShort: 'API 库欣库存', enFull: 'API Cushing Crude Inventories', enShort: 'API Cushing Stocks', locked: false },
  'US.API_DISTILLATE_STOCKS.NONE.CHANGE': { zhFull: 'API 精炼油库存', zhShort: 'API 精炼油库存', enFull: 'API Distillate Inventories', enShort: 'API Distillate Stocks', locked: false },
  'US.API_GASOLINE_STOCKS.NONE.CHANGE': { zhFull: 'API 汽油库存', zhShort: 'API 汽油库存', enFull: 'API Gasoline Inventories', enShort: 'API Gasoline Stocks', locked: false },
  'US.AVERAGE_WEEKLY_HOURS.SA.LEVEL': { zhFull: '平均每周工时', zhShort: '周工时', enFull: 'Average Weekly Hours', enShort: 'Avg Weekly Hours', locked: false },
  'US.BAKER_HUGHES_GAS_RIGS.NONE.COUNT': { zhFull: '贝克休斯天然气钻井数', zhShort: '天然气钻井数', enFull: 'Baker Hughes Gas Rig Count', enShort: 'Gas Rigs', locked: false },
  'US.BAKER_HUGHES_OIL_RIGS.NONE.COUNT': { zhFull: '贝克休斯石油钻井数', zhShort: '石油钻井数', enFull: 'Baker Hughes Oil Rig Count', enShort: 'Oil Rigs', locked: false },
  'US.BAKER_HUGHES_TOTAL_RIGS.NONE.COUNT': { zhFull: '贝克休斯总钻井数', zhShort: '总钻井数', enFull: 'Baker Hughes Total Rig Count', enShort: 'Total Rigs', locked: false },
  'US.BUILDING_PERMITS.NONE.COUNT': { zhFull: '营建许可', zhShort: '营建许可', enFull: 'Building Permits', enShort: 'Building Permits', locked: false },
  'US.BUILDING_PERMITS.NONE.MOM': { zhFull: '营建许可月率', zhShort: '营建许可 月率', enFull: 'Building Permits MoM', enShort: 'Building Permits MoM', locked: false },
  'US.BUSINESS_INVENTORIES.SA.MOM': { zhFull: '企业库存', zhShort: '企业库存', enFull: 'Business Inventories', enShort: 'Business Inventories', locked: false },
  'US.CAPACITY_UTILIZATION.SA.RATE': { zhFull: '产能利用率', zhShort: '产能利用率', enFull: 'Capacity Utilization', enShort: 'Capacity Utilization', locked: false },
  'US.CASE_SHILLER_COMPOSITE.SA.MOM': { zhFull: '标普/凯斯席勒房价指数月率', zhShort: '凯斯席勒房价 月率', enFull: 'S&P CoreLogic Case-Shiller Home Price Index MoM', enShort: 'Case-Shiller MoM', locked: false },
  'US.CASE_SHILLER_COMPOSITE.NSA.YOY': { zhFull: '标普/凯斯席勒房价指数年率', zhShort: '凯斯席勒房价 年率', enFull: 'S&P CoreLogic Case-Shiller Home Price Index YoY', enShort: 'Case-Shiller YoY', locked: false },
  'US.CHALLENGER_JOB_CUTS.NONE.COUNT': { zhFull: '挑战者企业裁员', zhShort: '挑战者裁员', enFull: 'Challenger Job Cuts', enShort: 'Challenger Cuts', locked: false },
  'US.CHALLENGER_JOB_CUTS.NONE.MOM': { zhFull: '挑战者企业裁员月率', zhShort: '挑战者裁员 月率', enFull: 'Challenger Job Cuts MoM', enShort: 'Challenger Cuts MoM', locked: false },
  'US.CHALLENGER_JOB_CUTS.NONE.YOY': { zhFull: '挑战者企业裁员年率', zhShort: '挑战者裁员 年率', enFull: 'Challenger Job Cuts YoY', enShort: 'Challenger Cuts YoY', locked: false },
  'US.CHICAGO_FED_NATIONAL_ACTIVITY.NONE.LEVEL': { zhFull: '芝加哥联储全国活动指数', zhShort: '芝加哥联储活动指数', enFull: 'Chicago Fed National Activity Index', enShort: 'CFNAI', locked: false },
  'US.CHICAGO_PMI.SA.LEVEL': { zhFull: '芝加哥采购经理人指数', zhShort: '芝加哥 PMI', enFull: 'Chicago Business Barometer', enShort: 'Chicago PMI', locked: false },
  'US.CONFERENCE_BOARD_CONFIDENCE.NONE.LEVEL': { zhFull: '咨商会消费者信心指数', zhShort: '咨商会信心', enFull: 'Conference Board Consumer Confidence', enShort: 'CB Confidence', locked: false },
  'US.CONSTRUCTION_SPENDING.SA.MOM': { zhFull: '营建支出月率', zhShort: '营建支出', enFull: 'Construction Spending, MoM', enShort: 'Construction Spending', code: 'construction-spending', locked: true },
  'US.CONSUMER_CONFIDENCE.SA.LEVEL': { zhFull: '消费者信心指数', zhShort: '消费者信心', enFull: 'Consumer Confidence Index', enShort: 'Consumer Confidence', code: 'consumer-confidence', locked: true },
  'US.CONSUMER_CREDIT.SA.CHANGE': { zhFull: '消费信贷变动', zhShort: '消费信贷', enFull: 'Consumer Credit Change', enShort: 'Consumer Credit', code: 'consumer-credit', locked: true },
  'US.CORE_CAPEX_ORDERS.SA.MOM': { zhFull: '核心资本品订单（除飞机·非国防）', zhShort: '核心资本品订单', enFull: 'Core Capital Goods Orders', enShort: 'Core Capex Orders', locked: false },
  'US.CORE_CPI.SA.LEVEL': { zhFull: '核心消费者物价指数', zhShort: '核心 CPI', enFull: 'Core Consumer Price Index', enShort: 'Core CPI', locked: false },
  'US.CORE_CPI.SA.MOM': { zhFull: '核心消费者物价指数月率', zhShort: '核心 CPI 月率', enFull: 'Core Consumer Price Index, MoM', enShort: 'Core CPI MoM', code: 'core-cpi.mom', locked: true },
  'US.CORE_CPI.NSA.YOY': { zhFull: '核心消费者物价指数年率', zhShort: '核心 CPI 年率', enFull: 'Core Consumer Price Index, YoY', enShort: 'Core CPI YoY', code: 'core-cpi.yoy', locked: true },
  'US.CORE_PCE.SA.MOM': { zhFull: '核心个人消费支出物价指数月率', zhShort: '核心 PCE 月率', enFull: 'Core PCE Price Index MoM', enShort: 'Core PCE MoM', locked: false },
  'US.CORE_PCE.NSA.YOY': { zhFull: '核心个人消费支出物价指数年率', zhShort: '核心 PCE 年率', enFull: 'Core PCE Price Index, YoY', enShort: 'Core PCE YoY', code: 'core-pce', locked: true },
  'US.CORE_PCE.SA.YOY': { zhFull: '核心个人消费支出物价指数年率（季调）', zhShort: '核心 PCE 年率（季调）', enFull: 'Core PCE Price Index, YoY (SA)', enShort: 'Core PCE YoY (SA)', locked: false },
  'US.CORE_PPI.SA.MOM': { zhFull: '核心生产者物价指数月率', zhShort: '核心 PPI 月率', enFull: 'Core Producer Price Index, MoM', enShort: 'Core PPI MoM', code: 'core-ppi.mom', locked: true },
  'US.CORE_PPI.NSA.YOY': { zhFull: '核心生产者物价指数年率', zhShort: '核心 PPI 年率', enFull: 'Core Producer Price Index, YoY', enShort: 'Core PPI YoY', code: 'core-ppi.yoy', locked: true },
  'US.CORPORATE_PROFITS.SA.QOQ': { zhFull: '企业利润', zhShort: '企业利润', enFull: 'Corporate Profits', enShort: 'Corp Profits', locked: false },
  'US.CPI.NSA.LEVEL': { zhFull: '消费者物价指数', zhShort: 'CPI', enFull: 'Consumer Price Index', enShort: 'CPI', locked: false },
  'US.CPI.SA.MOM': { zhFull: '消费者物价指数月率', zhShort: 'CPI 月率', enFull: 'Consumer Price Index MoM', enShort: 'CPI MoM', locked: false },
  'US.CPI.NSA.YOY': { zhFull: '消费者物价指数（CPI）年率', zhShort: 'CPI 年率', enFull: 'Consumer Price Index (CPI), YoY', enShort: 'CPI YoY', code: 'cpi', locked: true },
  'US.CPI_CLEVELAND.NONE.MOM': { zhFull: '克利夫兰联储 CPI 即时预测', zhShort: '克利夫兰 CPI 预测', enFull: 'Cleveland Fed CPI Nowcast', enShort: 'Cleveland CPI', locked: false },
  'US.DALLAS_FED_MANUFACTURING.SA.LEVEL': { zhFull: '达拉斯联储制造业活动指数', zhShort: '达拉斯联储制造业', enFull: 'Dallas Fed Manufacturing Index', enShort: 'Dallas Fed Mfg', locked: false },
  'US.DURABLE_GOODS_EX_DEFENSE.SA.MOM': { zhFull: '耐用品订单（除国防）', zhShort: '耐用品订单除国防', enFull: 'Durable Goods Orders ex Defense', enShort: 'Durables ex Defense', locked: false },
  'US.DURABLE_GOODS_EX_TRANSPORT.SA.MOM': { zhFull: '耐用品订单（除运输）', zhShort: '耐用品订单除运输', enFull: 'Durable Goods Orders ex Transportation', enShort: 'Durables ex Transport', locked: false },
  'US.DURABLE_GOODS_ORDERS.SA.MOM': { zhFull: '耐用品订单', zhShort: '耐用品订单', enFull: 'Durable Goods Orders', enShort: 'Durables', locked: false },
  'US.EIA_CRUDE_STOCKS.NONE.CHANGE': { zhFull: 'EIA 原油库存', zhShort: 'EIA 原油库存', enFull: 'EIA Crude Oil Inventories', enShort: 'EIA Crude Stocks', locked: false },
  'US.EIA_CUSHING_STOCKS.NONE.CHANGE': { zhFull: 'EIA 库欣原油库存', zhShort: 'EIA 库欣库存', enFull: 'EIA Cushing Crude Inventories', enShort: 'EIA Cushing Stocks', locked: false },
  'US.EIA_DISTILLATE_STOCKS.NONE.CHANGE': { zhFull: 'EIA 精炼油库存', zhShort: 'EIA 精炼油库存', enFull: 'EIA Distillate Inventories', enShort: 'EIA Distillate Stocks', locked: false },
  'US.EIA_GASOLINE_STOCKS.NONE.CHANGE': { zhFull: 'EIA 汽油库存', zhShort: 'EIA 汽油库存', enFull: 'EIA Gasoline Inventories', enShort: 'EIA Gasoline Stocks', locked: false },
  'US.EIA_NATURAL_GAS_STOCKS.NONE.CHANGE': { zhFull: 'EIA 天然气库存', zhShort: 'EIA 天然气库存', enFull: 'EIA Natural Gas Storage', enShort: 'EIA Nat Gas', locked: false },
  'US.EIA_REFINERY_UTILIZATION.NONE.RATE': { zhFull: 'EIA 精炼厂设备利用率', zhShort: '炼厂开工率', enFull: 'EIA Refinery Utilization', enShort: 'Refinery Utilization', locked: false },
  'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL': { zhFull: '纽约联储制造业指数', zhShort: '纽约联储制造业', enFull: 'Empire State Manufacturing Index', enShort: 'Empire State', locked: false },
  'US.EXISTING_HOME_SALES.SA.COUNT': { zhFull: '成屋销售总数（年化）', zhShort: '成屋销售', enFull: 'Existing Home Sales, Annualized', enShort: 'Existing Home Sales', code: 'existing-home-sales', locked: true },
  'US.EXISTING_HOME_SALES.SA.MOM': { zhFull: '成屋销售月率', zhShort: '成屋销售 月率', enFull: 'Existing Home Sales MoM', enShort: 'Existing Home Sales MoM', locked: false },
  'US.EXPORTS.NONE.AMOUNT': { zhFull: '出口额', zhShort: '出口', enFull: 'Exports', enShort: 'Exports', locked: false },
  'US.EXPORT_PRICES.SA.MOM': { zhFull: '出口价格月率', zhShort: '出口价格 月率', enFull: 'Export Prices MoM', enShort: 'Export Prices MoM', locked: false },
  'US.EXPORT_PRICES.NSA.YOY': { zhFull: '出口价格年率', zhShort: '出口价格 年率', enFull: 'Export Prices YoY', enShort: 'Export Prices YoY', locked: false },
  'US.FACTORY_ORDERS.SA.MOM': { zhFull: '工厂订单', zhShort: '工厂订单', enFull: 'Factory Orders', enShort: 'Factory Orders', locked: false },
  'US.FACTORY_ORDERS_EX_TRANSPORT.SA.MOM': { zhFull: '工厂订单（除运输）月率', zhShort: '工厂订单除运输', enFull: 'Factory Orders ex Transportation, MoM', enShort: 'Factory Orders ex Transport', code: 'factory-orders-ex-transport', locked: true },
  'US.FEDERAL_BUDGET.NONE.DIFF': { zhFull: '联邦预算收支', zhShort: '联邦预算', enFull: 'Federal Budget Balance', enShort: 'Federal Budget', code: 'federal-budget', locked: true },
  'US.FHFA_HOUSE_PRICE.SA.LEVEL': { zhFull: 'FHFA 房价指数', zhShort: 'FHFA 房价', enFull: 'FHFA House Price Index', enShort: 'FHFA HPI', locked: false },
  'US.FHFA_HOUSE_PRICE.SA.MOM': { zhFull: 'FHFA 房价指数月率', zhShort: 'FHFA 房价 月率', enFull: 'FHFA House Price Index MoM', enShort: 'FHFA HPI MoM', locked: false },
  'US.FHFA_HOUSE_PRICE.NSA.YOY': { zhFull: 'FHFA 房价指数年率', zhShort: 'FHFA 房价 年率', enFull: 'FHFA House Price Index YoY', enShort: 'FHFA HPI YoY', locked: false },
  // 官方 BEA 发布的 GDP 与下面的**即时预测不是同一件事**：中文简称带「年化季率」，
  // 撞成两个「GDP」读者分不清哪个是官方值。短码 `gdp` 是九个老码之一，不新造。
  'US.GDP.SA.ANNUALIZED_QOQ': { zhFull: '国内生产总值（年化季率）', zhShort: 'GDP 年化季率', enFull: 'Gross Domestic Product, Annualized QoQ', enShort: 'GDP Ann. QoQ', code: 'gdp', locked: true },
  'US.GDP_NOWCAST.SA.ANNUALIZED_QOQ': { zhFull: 'GDP 即时预测（年化季率）', zhShort: 'GDP 即时预测', enFull: 'GDP Nowcast, Annualized QoQ', enShort: 'GDP Nowcast', code: 'gdp-nowcast', locked: true },
  'US.GOVERNMENT_PAYROLLS.SA.CHANGE': { zhFull: '政府部门就业人数变动', zhShort: '政府就业', enFull: 'Government Payrolls Change', enShort: 'Government Payrolls', code: 'government-payrolls', locked: true },
  'US.GSCPI.NONE.LEVEL': { zhFull: '全球供应链压力指数', zhShort: '供应链压力指数', enFull: 'Global Supply Chain Pressure Index', enShort: 'GSCPI', locked: false },
  'US.HOUSING_STARTS.SA.COUNT': { zhFull: '新屋开工', zhShort: '新屋开工', enFull: 'Housing Starts', enShort: 'Housing Starts', locked: false },
  'US.HOUSING_STARTS.SA.MOM': { zhFull: '新屋开工月率', zhShort: '新屋开工 月率', enFull: 'Housing Starts MoM', enShort: 'Housing Starts MoM', locked: false },
  'US.IMPORTS.NONE.AMOUNT': { zhFull: '进口额', zhShort: '进口', enFull: 'Imports', enShort: 'Imports', locked: false },
  'US.IMPORT_PRICES.SA.MOM': { zhFull: '进口价格月率', zhShort: '进口价格 月率', enFull: 'Import Prices MoM', enShort: 'Import Prices MoM', locked: false },
  'US.IMPORT_PRICES.NSA.YOY': { zhFull: '进口价格年率', zhShort: '进口价格 年率', enFull: 'Import Prices YoY', enShort: 'Import Prices YoY', locked: false },
  'US.INDUSTRIAL_PRODUCTION.SA.MOM': { zhFull: '工业产出月率', zhShort: '工业产出 月率', enFull: 'Industrial Production MoM', enShort: 'Industrial Production MoM', locked: false },
  'US.INDUSTRIAL_PRODUCTION.NSA.YOY': { zhFull: '工业产出年率', zhShort: '工业产出 年率', enFull: 'Industrial Production YoY', enShort: 'Industrial Production YoY', locked: false },
  'US.INFLATION_EXPECTATIONS.NONE.LEVEL': { zhFull: '通胀预期', zhShort: '通胀预期', enFull: 'Inflation Expectations', enShort: 'Inflation Expectations', code: 'inflation-expectations', locked: true },
  'US.ISM_MANUFACTURING.SA.LEVEL': { zhFull: 'ISM 制造业采购经理人指数', zhShort: 'ISM 制造业 PMI', enFull: 'ISM Manufacturing PMI', enShort: 'ISM Mfg PMI', locked: false },
  'US.ISM_MANUFACTURING_EMPLOYMENT.SA.LEVEL': { zhFull: 'ISM 制造业就业指数', zhShort: 'ISM 制造业就业', enFull: 'ISM Manufacturing Employment Index', enShort: 'ISM Mfg Employment', code: 'ism-manufacturing-employment', locked: true },
  'US.ISM_MANUFACTURING_INVENTORIES.SA.LEVEL': { zhFull: 'ISM 制造业库存指数', zhShort: 'ISM 制造业库存', enFull: 'ISM Manufacturing Inventories', enShort: 'ISM Mfg Inventories', locked: false },
  'US.ISM_MANUFACTURING_NEW_ORDERS.SA.LEVEL': { zhFull: 'ISM 制造业新订单指数', zhShort: 'ISM 制造业新订单', enFull: 'ISM Manufacturing New Orders', enShort: 'ISM Mfg New Orders', locked: false },
  'US.ISM_MANUFACTURING_PRICES.SA.LEVEL': { zhFull: 'ISM 制造业物价支付指数', zhShort: 'ISM 制造业物价', enFull: 'ISM Manufacturing Prices Paid', enShort: 'ISM Mfg Prices', locked: false },
  'US.ISM_MANUFACTURING_PRODUCTION.SA.LEVEL': { zhFull: 'ISM 制造业产出指数', zhShort: 'ISM 制造业产出', enFull: 'ISM Manufacturing Production', enShort: 'ISM Mfg Production', locked: false },
  'US.ISM_SERVICES.SA.LEVEL': { zhFull: 'ISM 服务业采购经理人指数', zhShort: 'ISM 服务业 PMI', enFull: 'ISM Services PMI', enShort: 'ISM Svcs PMI', locked: false },
  'US.ISM_SERVICES_BUSINESS_ACTIVITY.SA.LEVEL': { zhFull: 'ISM 服务业商业活动指数', zhShort: 'ISM 服务业活动', enFull: 'ISM Services Business Activity Index', enShort: 'ISM Svcs Activity', code: 'ism-services-business-activity', locked: true },
  'US.ISM_SERVICES_EMPLOYMENT.SA.LEVEL': { zhFull: 'ISM 服务业就业指数', zhShort: 'ISM 服务业就业', enFull: 'ISM Services Employment', enShort: 'ISM Svcs Employment', locked: false },
  'US.ISM_SERVICES_INVENTORIES.SA.LEVEL': { zhFull: 'ISM 服务业库存指数', zhShort: 'ISM 服务业库存', enFull: 'ISM Services Inventories', enShort: 'ISM Svcs Inventories', locked: false },
  'US.ISM_SERVICES_NEW_ORDERS.SA.LEVEL': { zhFull: 'ISM 服务业新订单指数', zhShort: 'ISM 服务业新订单', enFull: 'ISM Services New Orders', enShort: 'ISM Svcs New Orders', locked: false },
  'US.ISM_SERVICES_PRICES.SA.LEVEL': { zhFull: 'ISM 服务业物价指数', zhShort: 'ISM 服务业物价', enFull: 'ISM Services Prices', enShort: 'ISM Svcs Prices', locked: false },
  'US.ISM_SERVICES_SUPPLIER_DELIVERIES.SA.LEVEL': { zhFull: 'ISM 服务业供应商交付指数', zhShort: 'ISM 服务业交付', enFull: 'ISM Services Supplier Deliveries', enShort: 'ISM Svcs Deliveries', locked: false },
  'US.JOBLESS_CLAIMS_4W_AVERAGE.SA.AVERAGE': { zhFull: '初请失业金人数四周均值', zhShort: '初请四周均值', enFull: 'Initial Jobless Claims 4-Week Average', enShort: 'Claims 4W Avg', locked: false },
  'US.JOBLESS_CLAIMS_CONTINUING.SA.COUNT': { zhFull: '续请失业金人数', zhShort: '续请失业金', enFull: 'Continuing Jobless Claims', enShort: 'Continuing Claims', code: 'jobless-claims-continuing', locked: true },
  'US.JOBLESS_CLAIMS_INITIAL.SA.COUNT': { zhFull: '初请失业金人数', zhShort: '初请失业金', enFull: 'Initial Jobless Claims', enShort: 'Initial Claims', locked: false },
  'US.JOLTS_OPENINGS.SA.COUNT': { zhFull: 'JOLTS 职位空缺', zhShort: '职位空缺', enFull: 'JOLTS Job Openings', enShort: 'Job Openings', code: 'jolts', locked: true },
  'US.JOLTS_QUITS.SA.COUNT': { zhFull: 'JOLTS 离职人数', zhShort: '离职人数', enFull: 'JOLTS Quits', enShort: 'Quits', locked: false },
  'US.KANSAS_FED_COMPOSITE.SA.LEVEL': { zhFull: '堪萨斯联储综合指数', zhShort: '堪萨斯联储综合', enFull: 'Kansas City Fed Composite Index', enShort: 'KC Fed Composite', locked: false },
  'US.KANSAS_FED_MANUFACTURING.SA.LEVEL': { zhFull: '堪萨斯联储制造业指数', zhShort: '堪萨斯联储制造业', enFull: 'Kansas City Fed Manufacturing Index', enShort: 'KC Fed Mfg', locked: false },
  'US.LEI.SA.MOM': { zhFull: '经济领先指标', zhShort: '领先指标', enFull: 'Leading Economic Index', enShort: 'LEI', locked: false },
  'US.LEI_EMPLOYMENT_TRENDS.NONE.LEVEL': { zhFull: '领先指标·就业趋势指数', zhShort: '就业趋势', enFull: 'Leading Indicators Employment Trends', enShort: 'LEI Employment Trends', code: 'leading-indicators-employment-trends', locked: true },
  'US.LOGISTICS_MANAGERS_INDEX.NONE.LEVEL': { zhFull: '物流经理指数', zhShort: '物流经理指数', enFull: 'Logistics Managers Index', enShort: 'LMI', code: 'logistics-managers-index', locked: true },
  'US.MANUFACTURING_PAYROLLS.SA.CHANGE': { zhFull: '制造业就业人数', zhShort: '制造业就业', enFull: 'Manufacturing Payrolls', enShort: 'Mfg Payrolls', locked: false },
  'US.MANUFACTURING_PRODUCTION.SA.MOM': { zhFull: '制造业产出月率', zhShort: '制造业产出 月率', enFull: 'Manufacturing Production MoM', enShort: 'Mfg Production MoM', locked: false },
  'US.MANUFACTURING_PRODUCTION.NSA.YOY': { zhFull: '制造业产出年率', zhShort: '制造业产出 年率', enFull: 'Manufacturing Production YoY', enShort: 'Mfg Production YoY', locked: false },
  'US.MBA_APPLICATIONS.NONE.LEVEL': { zhFull: 'MBA 抵押贷款申请活动指数', zhShort: 'MBA 申请指数', enFull: 'MBA Mortgage Applications', enShort: 'MBA Applications', locked: false },
  'US.MBA_PURCHASE_INDEX.NONE.LEVEL': { zhFull: 'MBA 抵押贷款购买指数', zhShort: 'MBA 购买指数', enFull: 'MBA Mortgage Purchase Index', enShort: 'MBA Purchase', locked: false },
  'US.MBA_RATE_30Y.NONE.RATE': { zhFull: 'MBA 30 年期抵押贷款利率', zhShort: 'MBA 30 年利率', enFull: 'MBA 30-Year Mortgage Rate', enShort: 'MBA 30Y Rate', locked: false },
  'US.MBA_REFINANCE_INDEX.NONE.LEVEL': { zhFull: 'MBA 抵押贷款再融资指数', zhShort: 'MBA 再融资指数', enFull: 'MBA Mortgage Refinance Index', enShort: 'MBA Refinance', locked: false },
  'US.MICHIGAN_CURRENT.NONE.LEVEL': { zhFull: '密歇根大学现况指数', zhShort: '密歇根现况', enFull: 'Michigan Current Conditions', enShort: 'Michigan Current', code: 'michigan-current', locked: true },
  'US.MICHIGAN_EXPECTATIONS.NONE.LEVEL': { zhFull: '密歇根大学预期指数', zhShort: '密歇根预期', enFull: 'Michigan Consumer Expectations', enShort: 'Michigan Expectations', locked: false },
  'US.MICHIGAN_INFLATION_1Y.NONE.LEVEL': { zhFull: '密歇根大学 1 年通胀预期', zhShort: '1 年通胀预期', enFull: 'Michigan 1-Year Inflation Expectations', enShort: 'Michigan 1Y Inflation', locked: false },
  'US.MICHIGAN_INFLATION_5Y.NONE.LEVEL': { zhFull: '密歇根大学 5-10 年通胀预期', zhShort: '5-10 年通胀预期', enFull: 'Michigan 5-10 Year Inflation Expectations', enShort: 'Michigan 5-10Y Inflation', locked: false },
  'US.MICHIGAN_SENTIMENT.NONE.LEVEL': { zhFull: '密歇根大学消费者信心指数', zhShort: '密歇根信心', enFull: 'Michigan Consumer Sentiment', enShort: 'Michigan Sentiment', locked: false },
  'US.MORTGAGE_RATE_15Y.NONE.RATE': { zhFull: '15 年期固定抵押贷款利率', zhShort: '15 年房贷利率', enFull: '15-Year Fixed Mortgage Rate', enShort: '15Y Mortgage Rate', code: 'mortgage-rate-15y', locked: true },
  'US.MORTGAGE_RATE_30Y.NONE.RATE': { zhFull: '30 年期固定抵押贷款利率', zhShort: '30 年房贷利率', enFull: '30-Year Fixed Mortgage Rate', enShort: '30Y Mortgage Rate', code: 'mortgage-rate-30y', locked: true },
  'US.NAHB_HOUSING_MARKET.NONE.LEVEL': { zhFull: 'NAHB 住房市场指数', zhShort: 'NAHB 住房指数', enFull: 'NAHB Housing Market Index', enShort: 'NAHB HMI', locked: false },
  'US.NEW_HOME_SALES.SA.COUNT': { zhFull: '新屋销售', zhShort: '新屋销售', enFull: 'New Home Sales', enShort: 'New Home Sales', locked: false },
  'US.NEW_HOME_SALES.SA.MOM': { zhFull: '新屋销售月率', zhShort: '新屋销售 月率', enFull: 'New Home Sales MoM', enShort: 'New Home Sales MoM', locked: false },
  'US.NFIB_OPTIMISM.NONE.LEVEL': { zhFull: 'NFIB 小型企业信心指数', zhShort: 'NFIB 小企业信心', enFull: 'NFIB Small Business Optimism Index', enShort: 'NFIB Optimism', code: 'nfib-optimism', locked: true },
  'US.NONFARM.SA.CHANGE': { zhFull: '非农业就业人数变动', zhShort: '新增就业', enFull: 'Nonfarm Payrolls Change', enShort: 'Nonfarm Payrolls', code: 'nonfarm-payrolls', locked: true },
  'US.PARTICIPATION_RATE.SA.RATE': { zhFull: '劳动力参与率', zhShort: '参与率', enFull: 'Labor Force Participation Rate', enShort: 'Participation Rate', code: 'participation-rate', locked: true },
  'US.PCE.SA.MOM': { zhFull: '个人消费支出物价指数月率', zhShort: 'PCE 月率', enFull: 'PCE Price Index MoM', enShort: 'PCE MoM', locked: false },
  'US.PCE.NSA.YOY': { zhFull: '个人消费支出物价指数年率', zhShort: 'PCE 年率', enFull: 'PCE Price Index YoY', enShort: 'PCE YoY', locked: false },
  'US.PCE.SA.YOY': { zhFull: '个人消费支出物价指数年率（季调）', zhShort: 'PCE 年率（季调）', enFull: 'PCE Price Index YoY (SA)', enShort: 'PCE YoY (SA)', locked: false },
  'US.PENDING_HOME_SALES.SA.MOM': { zhFull: '待售房屋销售月率', zhShort: '待售房屋 月率', enFull: 'Pending Home Sales MoM', enShort: 'Pending Sales MoM', locked: false },
  'US.PENDING_HOME_SALES.NSA.YOY': { zhFull: '待售房屋销售年率', zhShort: '待售房屋 年率', enFull: 'Pending Home Sales YoY', enShort: 'Pending Sales YoY', locked: false },
  'US.PERSONAL_INCOME.SA.MOM': { zhFull: '个人收入', zhShort: '个人收入', enFull: 'Personal Income', enShort: 'Personal Income', locked: false },
  'US.PERSONAL_SPENDING.SA.MOM': { zhFull: '个人支出', zhShort: '个人支出', enFull: 'Personal Spending', enShort: 'Personal Spending', locked: false },
  'US.PHILLY_FED_BUSINESS_CONDITIONS.SA.LEVEL': { zhFull: '费城联储商业景气指数', zhShort: '费城联储景气', enFull: 'Philadelphia Fed Business Outlook', enShort: 'Philly Fed Outlook', locked: false },
  'US.PHILLY_FED_CAPEX.SA.LEVEL': { zhFull: '费城联储资本支出指数', zhShort: '费城联储资本支出', enFull: 'Philadelphia Fed Capex Index', enShort: 'Philly Fed Capex', locked: false },
  'US.PHILLY_FED_EMPLOYMENT.SA.LEVEL': { zhFull: '费城联储就业指数', zhShort: '费城联储就业', enFull: 'Philadelphia Fed Employment', enShort: 'Philly Fed Employment', locked: false },
  'US.PHILLY_FED_MANUFACTURING.SA.LEVEL': { zhFull: '费城联储制造业指数', zhShort: '费城联储制造业', enFull: 'Philadelphia Fed Manufacturing Index', enShort: 'Philly Fed Mfg', locked: false },
  'US.PHILLY_FED_NEW_ORDERS.SA.LEVEL': { zhFull: '费城联储新订单指数', zhShort: '费城联储新订单', enFull: 'Philadelphia Fed New Orders', enShort: 'Philly Fed New Orders', locked: false },
  'US.PHILLY_FED_PRICES_PAID.SA.LEVEL': { zhFull: '费城联储物价支付指数', zhShort: '费城联储物价', enFull: 'Philadelphia Fed Prices Paid', enShort: 'Philly Fed Prices', locked: false },
  'US.PPI.SA.LEVEL': { zhFull: '生产者物价指数', zhShort: 'PPI', enFull: 'Producer Price Index', enShort: 'PPI', locked: false },
  'US.PPI.SA.MOM': { zhFull: '生产者物价指数月率', zhShort: 'PPI 月率', enFull: 'Producer Price Index MoM', enShort: 'PPI MoM', locked: false },
  'US.PPI.NSA.YOY': { zhFull: '生产者物价指数年率', zhShort: 'PPI 年率', enFull: 'Producer Price Index YoY', enShort: 'PPI YoY', locked: false },
  'US.PPI_EX_FOOD_ENERGY_TRADE.SA.MOM': { zhFull: '生产者物价指数（除食品能源贸易）月率', zhShort: 'PPI 除食品能源贸易 月率', enFull: 'PPI ex Food, Energy and Trade MoM', enShort: 'PPI ex FE&T MoM', locked: false },
  'US.PPI_EX_FOOD_ENERGY_TRADE.NSA.YOY': { zhFull: '生产者物价指数（除食品能源贸易）年率', zhShort: 'PPI 除食品能源贸易 年率', enFull: 'PPI ex Food, Energy and Trade YoY', enShort: 'PPI ex FE&T YoY', locked: false },
  'US.PPI_FINAL_DEMAND.SA.MOM': { zhFull: '生产者物价指数·最终需求月率', zhShort: 'PPI 最终需求 月率', enFull: 'PPI Final Demand MoM', enShort: 'PPI Final Demand MoM', locked: false },
  'US.PPI_FINAL_DEMAND.NSA.YOY': { zhFull: '生产者物价指数·最终需求年率', zhShort: 'PPI 最终需求 年率', enFull: 'PPI Final Demand YoY', enShort: 'PPI Final Demand YoY', locked: false },
  'US.PRIVATE_PAYROLLS.SA.CHANGE': { zhFull: '私营部门就业人数', zhShort: '私营就业', enFull: 'Private Payrolls', enShort: 'Private Payrolls', locked: false },
  'US.PRODUCTIVITY.SA.QOQ': { zhFull: '非农业生产力', zhShort: '生产力', enFull: 'Nonfarm Business Productivity', enShort: 'Productivity', locked: false },
  'US.REAL_AHE.NONE.MOM': { zhFull: '实际平均每小时工资月率', zhShort: '实际时薪 月率', enFull: 'Real Average Hourly Earnings MoM', enShort: 'Real Avg Hourly Earnings MoM', locked: false },
  'US.REAL_AHE.NONE.YOY': { zhFull: '实际平均每小时工资年率', zhShort: '实际时薪 年率', enFull: 'Real Average Hourly Earnings YoY', enShort: 'Real Avg Hourly Earnings YoY', locked: false },
  'US.REDBOOK_RETAIL_SALES.NONE.YOY': { zhFull: '红皮书商业零售销售年率', zhShort: '红皮书零售', enFull: 'Redbook Retail Sales, YoY', enShort: 'Redbook', code: 'redbook-retail-sales', locked: true },
  'US.RETAIL_INVENTORIES_EX_AUTOS.SA.MOM': { zhFull: '零售库存（除汽车）', zhShort: '零售库存除汽车', enFull: 'Retail Inventories ex Autos', enShort: 'Retail Inventories ex Autos', locked: false },
  'US.RETAIL_SALES.SA.MOM': { zhFull: '零售销售月率', zhShort: '零售 月率', enFull: 'Retail Sales MoM', enShort: 'Retail Sales MoM', locked: false },
  'US.RETAIL_SALES.NSA.YOY': { zhFull: '零售销售年率', zhShort: '零售 年率', enFull: 'Retail Sales YoY', enShort: 'Retail Sales YoY', locked: false },
  'US.RETAIL_SALES_CONTROL_GROUP.SA.MOM': { zhFull: '零售销售·核心对照组', zhShort: '零售核心对照组', enFull: 'Retail Sales Control Group', enShort: 'Retail Control Group', locked: false },
  'US.RETAIL_SALES_EX_AUTOS.SA.MOM': { zhFull: '零售销售（除汽车）', zhShort: '零售除汽车', enFull: 'Retail Sales ex Autos', enShort: 'Retail ex Autos', locked: false },
  'US.RETAIL_SALES_EX_GAS_AUTOS.SA.MOM': { zhFull: '零售销售（除汽车与汽油）', zhShort: '零售除汽车汽油', enFull: 'Retail Sales ex Gas and Autos', enShort: 'Retail ex Gas & Autos', locked: false },
  'US.RICHMOND_FED_MANUFACTURING.SA.LEVEL': { zhFull: '里奇蒙联储制造业指数', zhShort: '里奇蒙联储制造业', enFull: 'Richmond Fed Manufacturing Index', enShort: 'Richmond Fed Mfg', locked: false },
  'US.RICHMOND_FED_SERVICES.SA.LEVEL': { zhFull: '里奇蒙联储服务业指数', zhShort: '里奇蒙联储服务业', enFull: 'Richmond Fed Services Index', enShort: 'Richmond Fed Svcs', locked: false },
  'US.RICHMOND_FED_SHIPMENTS.SA.LEVEL': { zhFull: '里奇蒙联储出货指数', zhShort: '里奇蒙联储出货', enFull: 'Richmond Fed Shipments', enShort: 'Richmond Shipments', locked: false },
  'US.SP_COMPOSITE_PMI.SA.LEVEL': { zhFull: '标普全球综合 PMI', zhShort: '综合 PMI', enFull: 'S&P Global Composite PMI', enShort: 'Composite PMI', code: 'sp-global-composite-pmi', locked: true },
  'US.SP_MANUFACTURING_PMI.SA.LEVEL': { zhFull: '标普全球制造业 PMI', zhShort: '制造业 PMI', enFull: 'S&P Global Manufacturing PMI', enShort: 'Mfg PMI', code: 'sp-global-manufacturing-pmi', locked: true },
  'US.SP_SERVICES_PMI.SA.LEVEL': { zhFull: '标普全球服务业 PMI', zhShort: '服务业 PMI', enFull: 'S&P Global Services PMI', enShort: 'Services PMI', code: 'sp-global-services-pmi', locked: true },
  'US.TRADE_BALANCE.NONE.DIFF': { zhFull: '贸易帐', zhShort: '贸易帐', enFull: 'Trade Balance', enShort: 'Trade Balance', code: 'trade-balance', locked: true },
  'US.UNEMPLOYMENT.SA.RATE': { zhFull: '失业率', zhShort: '失业率', enFull: 'Unemployment Rate', enShort: 'Unemployment Rate', code: 'unemployment', locked: true },
  'US.UNEMPLOYMENT_U6.SA.RATE': { zhFull: 'U6 失业率', zhShort: 'U6 失业率', enFull: 'U-6 Unemployment Rate', enShort: 'U-6 Unemployment', locked: false },
  'US.UNIT_LABOR_COSTS.SA.QOQ': { zhFull: '单位劳动力成本', zhShort: '单位劳动力成本', enFull: 'Unit Labor Costs', enShort: 'Unit Labor Costs', locked: false },
  'US.USED_CAR_PRICES.NONE.MOM': { zhFull: '二手车价格月率', zhShort: '二手车价格', enFull: 'Used Car Prices, MoM', enShort: 'Used Car Prices', code: 'used-car-prices', locked: true },
  'US.USED_CAR_PRICES.NONE.YOY': { zhFull: '二手车价格年率', zhShort: '二手车价格 年率', enFull: 'Used Car Prices YoY', enShort: 'Used Car Prices YoY', locked: false },
  'US.VEHICLE_SALES.SA.COUNT': { zhFull: '汽车销量（年化）', zhShort: '汽车销量', enFull: 'Vehicle Sales, Annualized', enShort: 'Vehicle Sales', code: 'vehicle-sales', locked: true },
  'US.WHOLESALE_INVENTORIES.SA.MOM': { zhFull: '批发库存月率', zhShort: '批发库存', enFull: 'Wholesale Inventories, MoM', enShort: 'Wholesale Inventories', code: 'wholesale-inventories', locked: true },
  'US.WHOLESALE_SALES.SA.MOM': { zhFull: '批发销售', zhShort: '批发销售', enFull: 'Wholesale Sales', enShort: 'Wholesale Sales', locked: false },
})

/** 这 38 条是**码级名**（族名里已含测度），所以它们不参与「族名+测度」的拼接，直接冻结。 */
const MEASURE_WORDS = ['年率', '月率', '季率', '水平', '变化', '人数', '指数']

/**
 * 一个码的展示名。三条路，顺序固定：
 * 1. `manualNameByMetricKey`（已上线或人工定过，**逐字冻结**）；
 * 2. 族名 + 测度词（族名**必须 measure-free**，否则拒；测度必须在闭集里）；
 * 3. 都没有 → `undefined`（落 `unmapped`，只记日志，不猜）。
 */
export function nameForMetricKey(metricKey: string): Readonly<{
  zhFull: string; zhShort: string; enFull: string; enShort: string; locked?: boolean; code?: string
}> | undefined {
  const named = nameByMetricKey[metricKey]
  if (named !== undefined) return named
  const eventName = eventTypeNameByCode[metricKey]
  if (eventName !== undefined) return eventName
  const parts = metricKey.split('.')
  const measure = parts[parts.length - 1]
  const family = parts.slice(1, -1).join('.')
  const word = measureNameByMeasure[measure]
  const base = familyNameByFamily[family]
  if (word === undefined || base === undefined) return undefined
  // 族名里出现测度词 = 供料错了（常见于拿码级名当族名），这里拒掉而不是拼出「年率月率」。
  if (MEASURE_WORDS.some((token) => base.zhFull.includes(token))) return undefined
  return {
    zhFull: `${base.zhFull}${word.zhFull}`, zhShort: `${base.zhShort}${word.zhShort}`,
    enFull: `${base.enFull}, ${word.enFull}`, enShort: `${base.enShort} ${word.enShort}`
  }
}

/** 事件类型名：`evt.*` → 四名（来自 20 号表）。事件型行没有指标码，靠这张表才有读者看得懂的名字；
 * 取不到就退回类型串——**不许显示码本身**，也不许编名字。 */
/**
 * 名表条目的**一对名字**（中英各四列）。读侧以前只取中文简称，名称筛选要中英都能搜，
 * 所以统一从这里取——四个字段名只在这张名表里出现（守卫按字段形状抓的正是这类文件）。
 */
export type CalendarNamePair = Readonly<{ zhFull: string; zhShort: string; enFull: string; enShort: string }>

export function calendarNamesFor(metricKey: string): CalendarNamePair | undefined {
  return nameByMetricKey[metricKey] ?? eventTypeNameByCode[metricKey]
}

export const eventTypeNameByCode: Readonly<Record<string, Readonly<{
  zhFull: string; zhShort: string; enFull: string; enShort: string
}>>> = Object.freeze({
  'evt.central-bank-balance-sheet': { zhFull: '中央银行资产负债表', zhShort: '央行资产负债表', enFull: 'Central Bank Balance Sheet', enShort: 'CB Balance Sheet' },
  'evt.central-bank-report': { zhFull: '中央银行报告', zhShort: '央行报告', enFull: 'Central Bank Report', enShort: 'CB Report' },
  'evt.central-bank-speech': { zhFull: '中央银行讲话', zhShort: '央行讲话', enFull: 'Central Bank Speech', enShort: 'CB Speech' },
  'evt.commodity-market-report': { zhFull: '商品市场报告', zhShort: '商品市场报告', enFull: 'Commodity Market Report', enShort: 'Commodity Report' },
  'evt.economic-policy-meeting': { zhFull: '经济政策会议', zhShort: '经济政策会议', enFull: 'Economic Policy Meeting', enShort: 'Econ Policy Meeting' },
  'evt.employment-statistics': { zhFull: '就业统计', zhShort: '就业统计', enFull: 'Employment Statistics', enShort: 'Employment Stats' },
  'evt.fiscal-report': { zhFull: '财政报告', zhShort: '财政报告', enFull: 'Fiscal Report', enShort: 'Fiscal Report' },
  'evt.fomc': { zhFull: '美联储议息会议', zhShort: '议息会议', enFull: 'FOMC Rate Decision', enShort: 'FOMC' },
  'evt.futures-positioning': { zhFull: '期货持仓', zhShort: '期货持仓', enFull: 'Futures Positioning', enShort: 'Futures Positioning' },
  'evt.household-debt': { zhFull: '家庭债务', zhShort: '家庭债务', enFull: 'Household Debt', enShort: 'Household Debt' },
  'evt.merchandise-trade': { zhFull: '商品贸易', zhShort: '商品贸易', enFull: 'Merchandise Trade', enShort: 'Goods Trade' },
  'evt.monetary-policy-minutes': { zhFull: '货币政策会议纪要', zhShort: '会议纪要', enFull: 'FOMC Minutes', enShort: 'Minutes' },
  'evt.monetary-policy-press-conference': { zhFull: '货币政策新闻发布会', zhShort: '发布会', enFull: 'Monetary Policy Press Conference', enShort: 'Press Conference' },
  'evt.monetary-policy-projections': { zhFull: '经济预测摘要', zhShort: '经济预测', enFull: 'FOMC Economic Projections', enShort: 'SEP' },
  'evt.monetary-policy-statement': { zhFull: '货币政策声明', zhShort: '政策声明', enFull: 'Monetary Policy Statement', enShort: 'Policy Statement' },
  'evt.money-and-credit': { zhFull: '货币与信贷', zhShort: '货币与信贷', enFull: 'Money and Credit', enShort: 'Money & Credit' },
  'evt.mortgage-applications': { zhFull: '抵押贷款申请', zhShort: '抵押贷款申请', enFull: 'Mortgage Applications', enShort: 'Mortgage Apps' },
  'evt.oil-rig-count': { zhFull: '石油钻井数', zhShort: '石油钻井数', enFull: 'Oil Rig Count', enShort: 'Rig Count' },
  'evt.petroleum-inventories': { zhFull: '石油库存报告', zhShort: '石油库存', enFull: 'Petroleum Inventories', enShort: 'Petroleum Stocks' },
  'evt.policy-rate-decision': { zhFull: '利率决议', zhShort: '利率决议', enFull: 'Fed Rate Decision', enShort: 'Rate Decision' },
})
