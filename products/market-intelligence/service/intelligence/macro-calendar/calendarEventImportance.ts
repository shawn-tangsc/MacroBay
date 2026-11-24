import type { MacroEconomicCalendarImportance } from '../../../contracts/macro/economicCalendarQueryContracts'
import { toAlpha2Country } from './marketCalendarMetricIdentity'

/**
 * **日历事件重要性的判定**（R44 技术方案 `02-tech-design.md` §1，产品口径 `01-prd.md` v2）。
 *
 * 一个事件的档由 `(辖区, 族)` 查一张我们自己的表；判据**只看身份**（指标码 → 事件键 → 已登记的
 * 标题键），不看标题自由文本、不看国家名、不看源给的档。判不出来就是「未分级」——
 * **不是低**（低是我们判过的结论；把没判过的写成低会静默吃掉以后该响的提醒）。
 *
 * 三条硬边界：
 * 1. **族不另抄清单**：指标码的族就是码的第二段（`US.CORE_CPI.NSA.YOY` → `CORE_CPI`）。
 *    再建一张「码 → 族」表就是第三次抄码，和单源口径冲突。
 * 2. **档是数据**：加一行 `(辖区, 族) → 档` 就改判，函数不动；每行必须有 `basis`。
 * 3. **纯函数**：无 IO、无时钟、不用模型；同一身份判两次必须一致。
 */

/** 档表里的一条：`(辖区, 族) → 档`。`country` 的 `rest` 是**显式决策行**，不是「按族类推」。 */
export type CalendarImportanceRow = Readonly<{
  country: string
  /** 族＝指标码第二段（`CORE_CPI`）或官方 `eventFamily` 映射后的族名（`FOMC`）。 */
  family: string
  tier: MacroEconomicCalendarImportance
  /** 依据：公开发布表，或该指标对风险偏好的历史传导；「看着重要」不算依据。 */
  basis: string
}>

/**
 * **档表**（首版＝PRD §2 已定的组合，一行一决策）。查表规则只有一条：
 * 先查 `(精确辖区, 族)`，没有再查 `('rest', 族)`，都没有 → 未分级。
 *
 * 今天**没有 `rest` 行**：PRD v2 §9.1 把「未列辖区的 CPI/GDP」从「落低」改成「落未分级」，
 * 所以 `rest` 只是一个已支持的写法，不是今天的策略。将来加一行 `rest` 就要在 `basis` 里写明
 * 依据（数据改一行，函数不动）。
 */
export const calendarImportanceRows: readonly CalendarImportanceRow[] = Object.freeze([
  // —— 高（美国）：直接改利率路径与整体风险偏好 ——
  { country: 'US', family: 'CPI', tier: 'high', basis: 'PRD §2：直接改利率路径与整体风险偏好，一类资产起步' },
  { country: 'US', family: 'CORE_CPI', tier: 'high', basis: 'PRD §2：直接改利率路径与整体风险偏好，一类资产起步' },
  { country: 'US', family: 'PCE', tier: 'high', basis: 'PRD §2：直接改利率路径与整体风险偏好，一类资产起步' },
  { country: 'US', family: 'CORE_PCE', tier: 'high', basis: 'PRD §2：直接改利率路径与整体风险偏好，一类资产起步' },
  // 同一份就业报告算一族：非农、失业率、时薪、参与率、周工时、私企/制造业/政府就业、U6、实际时薪
  { country: 'US', family: 'NONFARM', tier: 'high', basis: 'PRD §2：非农（同一份就业报告算一族）' },
  { country: 'US', family: 'UNEMPLOYMENT', tier: 'high', basis: 'PRD §2：非农含失业率，同一份就业报告' },
  { country: 'US', family: 'UNEMPLOYMENT_U6', tier: 'high', basis: 'PRD §2：非农含失业率，同一份就业报告' },
  { country: 'US', family: 'AHE', tier: 'high', basis: 'PRD §2：非农含平均时薪，同一份就业报告' },
  { country: 'US', family: 'REAL_AHE', tier: 'high', basis: 'PRD §2：非农含平均时薪，同一份就业报告' },
  { country: 'US', family: 'AVERAGE_WEEKLY_HOURS', tier: 'high', basis: 'PRD §2：非农含周工时，同一份就业报告' },
  { country: 'US', family: 'PARTICIPATION_RATE', tier: 'high', basis: 'PRD §2：非农含参与率，同一份就业报告' },
  { country: 'US', family: 'PRIVATE_PAYROLLS', tier: 'high', basis: 'PRD §2：非农含私企就业，同一份就业报告' },
  { country: 'US', family: 'MANUFACTURING_PAYROLLS', tier: 'high', basis: 'PRD §2：非农含制造业就业，同一份就业报告' },
  { country: 'US', family: 'GOVERNMENT_PAYROLLS', tier: 'high', basis: 'PRD §2：非农含政府就业，同一份就业报告' },
  { country: 'US', family: 'FOMC', tier: 'high', basis: 'PRD §2：FOMC 决议 / 纪要 / 经济预测直接动利率路径' },
  { country: 'US', family: 'GDP', tier: 'high', basis: 'PRD §2：季度 GDP 直接改整体风险偏好' },
  { country: 'US', family: 'GDP_DEFLATOR', tier: 'high', basis: 'PRD §2：季度 GDP（平减指数同一次发布）' },
  { country: 'US', family: 'FINAL_SALES', tier: 'high', basis: 'PRD §2：季度 GDP（最终销售同一次发布）' },
  // —— 高：利率决议（欧元区 / 英国 / 日本） ——
  { country: 'EMU', family: 'POLICY_RATE', tier: 'high', basis: 'PRD §2：全球流动性定价，一类资产起步' },
  { country: 'GB', family: 'POLICY_RATE', tier: 'high', basis: 'PRD §2：全球流动性定价，一类资产起步' },
  { country: 'JP', family: 'POLICY_RATE', tier: 'high', basis: 'PRD §2：全球流动性定价，一类资产起步' },
  // —— 中（美国）：影响一类资产或整体景气，到 BTC/ETH 要两步传导 ——
  { country: 'US', family: 'ISM_MANUFACTURING', tier: 'medium', basis: 'PRD §2：ISM 制造与服务，两步传导' },
  { country: 'US', family: 'ISM_SERVICES', tier: 'medium', basis: 'PRD §2：ISM 制造与服务，两步传导' },
  { country: 'US', family: 'EMPIRE_STATE_MANUFACTURING', tier: 'medium', basis: 'PRD §2：地区联储制造业（纽约）' },
  { country: 'US', family: 'PHILLY_FED_MANUFACTURING', tier: 'medium', basis: 'PRD §2：地区联储制造业（费城）' },
  { country: 'US', family: 'PHILLY_FED_BUSINESS_CONDITIONS', tier: 'medium', basis: 'PRD §2：地区联储制造业（费城）' },
  { country: 'US', family: 'RICHMOND_FED_MANUFACTURING', tier: 'medium', basis: 'PRD §2：地区联储制造业（里士满）' },
  { country: 'US', family: 'RICHMOND_FED_SERVICES', tier: 'medium', basis: 'PRD §2：地区联储制造业（里士满）' },
  { country: 'US', family: 'DALLAS_FED_MANUFACTURING', tier: 'medium', basis: 'PRD §2：地区联储制造业（达拉斯）' },
  { country: 'US', family: 'DALLAS_FED_SERVICES', tier: 'medium', basis: 'PRD §2：地区联储制造业（达拉斯）' },
  { country: 'US', family: 'KANSAS_FED_MANUFACTURING', tier: 'medium', basis: 'PRD §2：地区联储制造业（堪萨斯城）' },
  { country: 'US', family: 'KANSAS_FED_COMPOSITE', tier: 'medium', basis: 'PRD §2：地区联储制造业（堪萨斯城）' },
  { country: 'US', family: 'MICHIGAN_SENTIMENT', tier: 'medium', basis: 'PRD §2：密歇根消费者信心' },
  { country: 'US', family: 'MICHIGAN_CURRENT', tier: 'medium', basis: 'PRD §2：密歇根消费者信心' },
  { country: 'US', family: 'MICHIGAN_EXPECTATIONS', tier: 'medium', basis: 'PRD §2：密歇根消费者信心' },
  { country: 'US', family: 'MICHIGAN_INFLATION_1Y', tier: 'medium', basis: 'PRD §2：密歇根消费者信心' },
  { country: 'US', family: 'MICHIGAN_INFLATION_5Y', tier: 'medium', basis: 'PRD §2：密歇根消费者信心' },
  { country: 'US', family: 'CONSUMER_CONFIDENCE', tier: 'medium', basis: 'PRD §2：CB 消费者信心' },
  { country: 'US', family: 'CONFERENCE_BOARD_CONFIDENCE', tier: 'medium', basis: 'PRD §2：CB 消费者信心' },
  { country: 'US', family: 'RETAIL_SALES', tier: 'medium', basis: 'PRD §2：零售销售' },
  { country: 'US', family: 'DURABLE_GOODS_ORDERS', tier: 'medium', basis: 'PRD §2：耐用品' },
  { country: 'US', family: 'DURABLE_GOODS_EX_DEFENSE', tier: 'medium', basis: 'PRD §2：耐用品（同一次发布）' },
  { country: 'US', family: 'DURABLE_GOODS_EX_TRANSPORT', tier: 'medium', basis: 'PRD §2：耐用品（同一次发布）' },
  { country: 'US', family: 'JOLTS_OPENINGS', tier: 'medium', basis: 'PRD §2：职位空缺' },
  { country: 'US', family: 'JOLTS_QUITS', tier: 'medium', basis: 'PRD §2：职位空缺（同一次发布）' },
  { country: 'US', family: 'JOBLESS_CLAIMS_INITIAL', tier: 'medium', basis: 'PRD §2：初请' },
  { country: 'US', family: 'JOBLESS_CLAIMS_CONTINUING', tier: 'medium', basis: 'PRD §2：初请（同一次发布）' },
  { country: 'US', family: 'JOBLESS_CLAIMS_4W_AVERAGE', tier: 'medium', basis: 'PRD §2：初请（同一次发布）' },
  { country: 'US', family: 'INDUSTRIAL_PRODUCTION', tier: 'medium', basis: 'PRD §2：工业产出' },
  { country: 'US', family: 'MANUFACTURING_PRODUCTION', tier: 'medium', basis: 'PRD §2：工业产出（同一次发布）' },
  { country: 'US', family: 'CAPACITY_UTILIZATION', tier: 'medium', basis: 'PRD §2：工业产出（同一次发布）' },
  { country: 'US', family: 'CASE_SHILLER_20', tier: 'medium', basis: 'PRD §2：房价（Case-Shiller 一类）' },
  { country: 'US', family: 'CASE_SHILLER_COMPOSITE', tier: 'medium', basis: 'PRD §2：房价（Case-Shiller 一类）' },
  { country: 'US', family: 'FHFA_HOUSE_PRICE', tier: 'medium', basis: 'PRD §2：房价（Case-Shiller 一类）' },
  { country: 'US', family: 'PPI', tier: 'medium', basis: 'PRD §9.2：美国 PPI 影响通胀预期，但不是核心交易主线' },
  { country: 'US', family: 'CORE_PPI', tier: 'medium', basis: 'PRD §9.2：美国 PPI（同一份发布）' },
  { country: 'US', family: 'PPI_FINAL_DEMAND', tier: 'medium', basis: 'PRD §9.2：美国 PPI（同一份发布）' },
  { country: 'US', family: 'PPI_EX_FOOD_ENERGY_TRADE', tier: 'medium', basis: 'PRD §9.2：美国 PPI（同一份发布）' },
  // —— 中（海外）：同一判据，辖区次一档 ——
  { country: 'EMU', family: 'CPI', tier: 'medium', basis: 'PRD §2：同一判据，辖区次一档' },
  { country: 'GB', family: 'CPI', tier: 'medium', basis: 'PRD §2：同一判据，辖区次一档' },
  { country: 'JP', family: 'CPI', tier: 'medium', basis: 'PRD §2：同一判据，辖区次一档' },
  { country: 'CN', family: 'CPI', tier: 'medium', basis: 'PRD §2：同一判据，辖区次一档' },
  { country: 'EMU', family: 'GDP', tier: 'medium', basis: 'PRD §2：同一判据，辖区次一档' },
  { country: 'GB', family: 'GDP', tier: 'medium', basis: 'PRD §2：同一判据，辖区次一档' },
  { country: 'JP', family: 'GDP', tier: 'medium', basis: 'PRD §2：同一判据，辖区次一档' },
  { country: 'CN', family: 'GDP', tier: 'medium', basis: 'PRD §2：同一判据，辖区次一档' },
  { country: 'EMU', family: 'UNEMPLOYMENT', tier: 'medium', basis: 'PRD §2：同一判据，辖区次一档' },
  { country: 'GB', family: 'UNEMPLOYMENT', tier: 'medium', basis: 'PRD §2：同一判据，辖区次一档' },
  { country: 'JP', family: 'UNEMPLOYMENT', tier: 'medium', basis: 'PRD §2：同一判据，辖区次一档' },
  { country: 'CN', family: 'UNEMPLOYMENT', tier: 'medium', basis: 'PRD §2：同一判据，辖区次一档' },
  // —— 央行沟通（PRD §9.2）：族已定档，但今天的事件身份分不出「行长」与「地区联储主席」——
  //    身份挂不上就是未分级（不猜）。等事件身份能分辨、或标题键登记之后再补映射行。
  { country: 'US', family: 'CENTRAL_BANK_TESTIMONY', tier: 'medium', basis: 'PRD §9.2：主要央行行长证词 / 讲话' },
  { country: 'EMU', family: 'CENTRAL_BANK_TESTIMONY', tier: 'medium', basis: 'PRD §9.2：主要央行行长证词 / 讲话' },
  { country: 'GB', family: 'CENTRAL_BANK_TESTIMONY', tier: 'medium', basis: 'PRD §9.2：主要央行行长证词 / 讲话' },
  { country: 'JP', family: 'CENTRAL_BANK_TESTIMONY', tier: 'medium', basis: 'PRD §9.2：主要央行行长证词 / 讲话' },
  { country: 'US', family: 'REGIONAL_FED_SPEECH', tier: 'low', basis: 'PRD §9.2：地区联储主席讲话' },
  // —— 低（任意辖区）：单月噪声大、与加密定价无直接传导（不写 country＝各辖区同档） ——
  { country: 'US', family: 'TRADE_BALANCE', tier: 'low', basis: 'PRD §2：贸易帐，单月噪声大、无直接传导' },
  { country: 'US', family: 'CURRENT_ACCOUNT', tier: 'low', basis: 'PRD §2：经常帐，单月噪声大、无直接传导' },
  { country: 'US', family: 'BUILDING_PERMITS', tier: 'low', basis: 'PRD §2：建筑许可，单月噪声大、无直接传导' },
  { country: 'US', family: 'HOUSING_STARTS', tier: 'low', basis: 'PRD §2：新屋开工，单月噪声大、无直接传导' },
  { country: 'US', family: 'WHOLESALE_INVENTORIES', tier: 'low', basis: 'PRD §2：批发库存，单月噪声大、无直接传导' },
  { country: 'US', family: 'WHOLESALE_SALES', tier: 'low', basis: 'PRD §2：批发库存（同一次发布）' },
  { country: 'US', family: 'USED_CAR_PRICES', tier: 'low', basis: 'PRD §2：二手车价格，单月噪声大、无直接传导' },
  { country: 'US', family: 'VEHICLE_SALES', tier: 'low', basis: 'PRD §2：新车销量，单月噪声大、无直接传导' },
  { country: 'rest', family: 'FX_RESERVES', tier: 'low', basis: 'PRD §2：外汇储备，任何辖区都是低（显式决策行）' },
  { country: 'rest', family: 'MONEY_SUPPLY', tier: 'low', basis: 'PRD §2：货币供应，任何辖区都是低（显式决策行）' },
  // —— PRD §10 附录（2026-11-24 产品逐族定档）：真库 69 个「美国、有码、§2 没列」的族 ——
  // 68 族补在这里；`FEDERAL_FUNDS_BENCHMARK` 归并进 FOMC 族（见 calendarFamilyAliases），不另立高族。
  // 规则：R1 子族跟父族、R2 周度高频一律低、R3 房产不整批判低（房价变体中、开工/许可/销量/支出低）。
  { country: 'US', family: 'CORE_PERSONAL_CONSUMPTION_EXPENDITURE_PRICE', tier: 'high', basis: 'PRD §10 R1 子族跟父族：与 PCE 同一份发布（父族：PCE / 核心 PCE，高）' },
  { country: 'US', family: 'PERSONAL_CONSUMPTION_EXPENDITURE_PRICE', tier: 'high', basis: 'PRD §10 R1 子族跟父族：与 PCE 同一份发布（父族：PCE / 核心 PCE，高）' },
  { country: 'US', family: 'PERSONAL_CONSUMPTION_EXPENDITURE', tier: 'high', basis: 'PRD §10 R1 子族跟父族：与 PCE 同一份发布（父族：PCE / 核心 PCE，高）' },
  { country: 'US', family: 'PERSONAL_INCOME', tier: 'high', basis: 'PRD §10 R1 子族跟父族：与 PCE 同一份发布（父族：PCE / 核心 PCE，高）' },
  { country: 'US', family: 'PERSONAL_SPENDING', tier: 'high', basis: 'PRD §10 R1 子族跟父族：与 PCE 同一份发布（父族：PCE / 核心 PCE，高）' },
  { country: 'US', family: 'ACTUAL_PERSONAL_CONSUMPTION_EXPENDITURE', tier: 'high', basis: 'PRD §10 R1 子族跟父族：与 PCE 同一份发布（父族：PCE / 核心 PCE，高）' },
  { country: 'US', family: 'REAL_GDP', tier: 'high', basis: 'PRD §10 R1 子族跟父族：与美国季度 GDP 同一份发布（父族：GDP，高）' },
  { country: 'US', family: 'ANNUM_REAL_GDP', tier: 'high', basis: 'PRD §10 R1 子族跟父族：与美国季度 GDP 同一份发布（父族：GDP，高）' },
  { country: 'US', family: 'CHALLENGER_JOB_CUTS', tier: 'medium', basis: 'PRD §10 单列：就业类先行指标：领先非农，但本身不是官方就业报告，中' },
  { country: 'US', family: 'ISM_MANUFACTURING_NEW_ORDERS', tier: 'medium', basis: 'PRD §10 R1 子族跟父族：与 ISM 同一份发布（父族：ISM 制造/服务，中）' },
  { country: 'US', family: 'SP_COMPOSITE_PMI', tier: 'medium', basis: 'PRD §10 单列：PMI 一类：与 ISM 同一判据（景气、传导要两步），但不同发布方，单独列，不并进 ISM' },
  { country: 'US', family: 'CORE_CAPEX_ORDERS', tier: 'medium', basis: 'PRD §10 R1 子族跟父族：与耐用品订单同一份发布（父族：耐用品，中）' },
  { country: 'US', family: 'ISM_SERVICES_NEW_ORDERS', tier: 'medium', basis: 'PRD §10 R1 子族跟父族：与 ISM 同一份发布（父族：ISM 制造/服务，中）' },
  { country: 'US', family: 'SP_MANUFACTURING_PMI', tier: 'medium', basis: 'PRD §10 单列：PMI 一类：与 ISM 同一判据（景气、传导要两步），但不同发布方，单独列，不并进 ISM' },
  { country: 'US', family: 'ISM_MANUFACTURING_EMPLOYMENT', tier: 'medium', basis: 'PRD §10 R1 子族跟父族：与 ISM 同一份发布（父族：ISM 制造/服务，中）' },
  { country: 'US', family: 'ISM_MANUFACTURING_PRODUCTION', tier: 'medium', basis: 'PRD §10 R1 子族跟父族：与 ISM 同一份发布（父族：ISM 制造/服务，中）' },
  { country: 'US', family: 'ISM_MANUFACTURING_INVENTORIES', tier: 'medium', basis: 'PRD §10 R1 子族跟父族：与 ISM 同一份发布（父族：ISM 制造/服务，中）' },
  { country: 'US', family: 'ISM_MANUFACTURING_PRICES', tier: 'medium', basis: 'PRD §10 R1 子族跟父族：与 ISM 同一份发布（父族：ISM 制造/服务，中）' },
  { country: 'US', family: 'SP_SERVICES_PMI', tier: 'medium', basis: 'PRD §10 单列：PMI 一类：与 ISM 同一判据（景气、传导要两步），但不同发布方，单独列，不并进 ISM' },
  { country: 'US', family: 'ISM_SERVICES_PRICES', tier: 'medium', basis: 'PRD §10 R1 子族跟父族：与 ISM 同一份发布（父族：ISM 制造/服务，中）' },
  { country: 'US', family: 'ISM_SERVICES_SUPPLIER_DELIVERIES', tier: 'medium', basis: 'PRD §10 R1 子族跟父族：与 ISM 同一份发布（父族：ISM 制造/服务，中）' },
  { country: 'US', family: 'ISM_SERVICES_INVENTORIES', tier: 'medium', basis: 'PRD §10 R1 子族跟父族：与 ISM 同一份发布（父族：ISM 制造/服务，中）' },
  { country: 'US', family: 'ISM_SERVICES_EMPLOYMENT', tier: 'medium', basis: 'PRD §10 R1 子族跟父族：与 ISM 同一份发布（父族：ISM 制造/服务，中）' },
  { country: 'US', family: 'NFIB_OPTIMISM', tier: 'medium', basis: 'PRD §10 单列：小企业信心：与密歇根 / CB 同类（景气调查），中' },
  { country: 'US', family: 'DEDUCT_AIRCRAFT_DEFENSE_CAPITAL_DURABLE_GOODS_ORDERS', tier: 'medium', basis: 'PRD §10 R1 子族跟父族：与耐用品订单同一份发布（父族：耐用品，中）' },
  { country: 'US', family: 'DURABLE_GOODS_ORDERS_EXCLUDING_NATIONAL_DEFENSE', tier: 'medium', basis: 'PRD §10 R1 子族跟父族：与耐用品订单同一份发布（父族：耐用品，中）' },
  { country: 'US', family: 'DURABLE_GOODS_ORDERS_EXCLUDING_TRANSPORTATION', tier: 'medium', basis: 'PRD §10 R1 子族跟父族：与耐用品订单同一份发布（父族：耐用品，中）' },
  { country: 'US', family: 'UNSEASONALLY_HOUSE_PRICE_20_MAJOR_CITIES_S_P_CS', tier: 'medium', basis: 'PRD §10 R3 房产：跟已列族：PRD §2 中档已列「房价（Case-Shiller 一类）」，这几个是同族的分项与未季调变体' },
  { country: 'US', family: 'S_P_CS_HOUSE_PRICE_10_MAJOR_CITIES', tier: 'medium', basis: 'PRD §10 R3 房产：跟已列族：PRD §2 中档已列「房价（Case-Shiller 一类）」，这几个是同族的分项与未季调变体' },
  { country: 'US', family: 'S_P_CS_UNSEASONALLY_HOUSE_PRICE_10_MAJOR_CITIES', tier: 'medium', basis: 'PRD §10 R3 房产：跟已列族：PRD §2 中档已列「房价（Case-Shiller 一类）」，这几个是同族的分项与未季调变体' },
  { country: 'US', family: 'ADP', tier: 'medium', basis: 'PRD §10 单列：私营部门就业：二步传导，且与非农同日前后发布、可能互相打架，中' },
  { country: 'US', family: 'UNIT_LABOR_COSTS', tier: 'medium', basis: 'PRD §10 单列：生产率与成本同一份发布：影响通胀路径的第二层证据，中' },
  { country: 'US', family: 'PRODUCTIVITY', tier: 'medium', basis: 'PRD §10 单列：生产率与成本同一份发布：影响通胀路径的第二层证据，中' },
  { country: 'US', family: 'BAKER_HUGHES_OIL_RIGS', tier: 'low', basis: 'PRD §10 R2 周度高频：周度库存/申请/钻机类流量：单周噪声大，与 BTC/ETH 无一阶传导' },
  { country: 'US', family: 'BAKER_HUGHES_GAS_RIGS', tier: 'low', basis: 'PRD §10 R2 周度高频：周度库存/申请/钻机类流量：单周噪声大，与 BTC/ETH 无一阶传导' },
  { country: 'US', family: 'BAKER_HUGHES_TOTAL_RIGS', tier: 'low', basis: 'PRD §10 R2 周度高频：周度库存/申请/钻机类流量：单周噪声大，与 BTC/ETH 无一阶传导' },
  { country: 'US', family: 'REDBOOK_RETAIL_SALES', tier: 'low', basis: 'PRD §10 R2 周度高频：周度库存/申请/钻机类流量：单周噪声大，与 BTC/ETH 无一阶传导' },
  { country: 'US', family: 'API_CUSHING_STOCKS', tier: 'low', basis: 'PRD §10 R2 周度高频：周度库存/申请/钻机类流量：单周噪声大，与 BTC/ETH 无一阶传导' },
  { country: 'US', family: 'MBA_APPLICATIONS', tier: 'low', basis: 'PRD §10 R2 周度高频：周度库存/申请/钻机类流量：单周噪声大，与 BTC/ETH 无一阶传导' },
  { country: 'US', family: 'MBA_PURCHASE_INDEX', tier: 'low', basis: 'PRD §10 R2 周度高频：周度库存/申请/钻机类流量：单周噪声大，与 BTC/ETH 无一阶传导' },
  { country: 'US', family: 'MBA_RATE_30Y', tier: 'low', basis: 'PRD §10 R2 周度高频：周度库存/申请/钻机类流量：单周噪声大，与 BTC/ETH 无一阶传导' },
  { country: 'US', family: 'MBA_REFINANCE_INDEX', tier: 'low', basis: 'PRD §10 R2 周度高频：周度库存/申请/钻机类流量：单周噪声大，与 BTC/ETH 无一阶传导' },
  { country: 'US', family: 'EIA_NATURAL_GAS_STOCKS', tier: 'low', basis: 'PRD §10 R2 周度高频：周度库存/申请/钻机类流量：单周噪声大，与 BTC/ETH 无一阶传导' },
  { country: 'US', family: 'API_CRUDE_STOCKS', tier: 'low', basis: 'PRD §10 R2 周度高频：周度库存/申请/钻机类流量：单周噪声大，与 BTC/ETH 无一阶传导' },
  { country: 'US', family: 'API_DISTILLATE_STOCKS', tier: 'low', basis: 'PRD §10 R2 周度高频：周度库存/申请/钻机类流量：单周噪声大，与 BTC/ETH 无一阶传导' },
  { country: 'US', family: 'API_GASOLINE_STOCKS', tier: 'low', basis: 'PRD §10 R2 周度高频：周度库存/申请/钻机类流量：单周噪声大，与 BTC/ETH 无一阶传导' },
  { country: 'US', family: 'EIA_CRUDE_STOCKS', tier: 'low', basis: 'PRD §10 R2 周度高频：周度库存/申请/钻机类流量：单周噪声大，与 BTC/ETH 无一阶传导' },
  { country: 'US', family: 'EIA_REFINERY_UTILIZATION', tier: 'low', basis: 'PRD §10 R2 周度高频：周度库存/申请/钻机类流量：单周噪声大，与 BTC/ETH 无一阶传导' },
  { country: 'US', family: 'EIA_DISTILLATE_STOCKS', tier: 'low', basis: 'PRD §10 R2 周度高频：周度库存/申请/钻机类流量：单周噪声大，与 BTC/ETH 无一阶传导' },
  { country: 'US', family: 'EIA_GASOLINE_STOCKS', tier: 'low', basis: 'PRD §10 R2 周度高频：周度库存/申请/钻机类流量：单周噪声大，与 BTC/ETH 无一阶传导' },
  { country: 'US', family: 'EIA_CUSHING_STOCKS', tier: 'low', basis: 'PRD §10 R2 周度高频：周度库存/申请/钻机类流量：单周噪声大，与 BTC/ETH 无一阶传导' },
  { country: 'US', family: 'EXISTING_HOME_SALES', tier: 'low', basis: 'PRD §10 R3 房产：单月噪声：房产销量与建筑支出：月度、单月噪声大，到加密要三步以上传导' },
  { country: 'US', family: 'CONSTRUCTION_SPENDING', tier: 'low', basis: 'PRD §10 R3 房产：单月噪声：房产销量与建筑支出：月度、单月噪声大，到加密要三步以上传导' },
  { country: 'US', family: 'CONSUMER_CREDIT', tier: 'low', basis: 'PRD §10 单列：消费信贷：月度余额、与风险偏好无一阶传导，低' },
  { country: 'US', family: 'FACTORY_ORDERS', tier: 'low', basis: 'PRD §10 单列：工厂订单复述已公布的耐用品，增量只有非耐用品' },
  { country: 'US', family: 'EXPORTS', tier: 'low', basis: 'PRD §10 R1 子族跟父族：与贸易帐同一份发布（父族：贸易帐，低）' },
  { country: 'US', family: 'IMPORTS', tier: 'low', basis: 'PRD §10 R1 子族跟父族：与贸易帐同一份发布（父族：贸易帐，低）' },
  { country: 'US', family: 'FEDERAL_BUDGET', tier: 'low', basis: 'PRD §10 单列：月度财政收支：流量大但可预期，低' },
  { country: 'US', family: 'NET_LONG_TERM_CAPITAL_INFLOWS', tier: 'low', basis: 'PRD §10 单列：国际资本流动（同一份 TIC 发布）：两月滞后、与加密无直接传导，低' },
  { country: 'US', family: 'NET_FOREIGN_PURCHASES_GOVERNMENT_BONDS', tier: 'low', basis: 'PRD §10 单列：国际资本流动（同一份 TIC 发布）：两月滞后、与加密无直接传导，低' },
  { country: 'US', family: 'NET_INTERNATIONAL_CAPITAL_INFLOW', tier: 'low', basis: 'PRD §10 单列：国际资本流动（同一份 TIC 发布）：两月滞后、与加密无直接传导，低' },
  { country: 'US', family: 'NEW_HOME_SALES_ANNUALIZED', tier: 'low', basis: 'PRD §10 R3 房产：单月噪声：房产销量与建筑支出：月度、单月噪声大，到加密要三步以上传导' },
  { country: 'US', family: 'NEW_HOME_STARTS_ANNUALIZED', tier: 'low', basis: 'PRD §10 R3 房产：跟已列族：PRD §2 低档已列「新屋开工 / 建筑许可」，这几族是它们的变体' },
  { country: 'US', family: 'GSCPI', tier: 'low', basis: 'PRD §10 单列：全球供应链压力指数：月度、指数化、传导链长，低' },
  { country: 'US', family: 'TOTAL_NUMBER_CONSTRUCTION_PERMITS', tier: 'low', basis: 'PRD §10 R3 房产：跟已列族：PRD §2 低档已列「新屋开工 / 建筑许可」，这几族是它们的变体' },
  { country: 'US', family: 'COINCIDENT_INDEX', tier: 'low', basis: 'PRD §10 单列：CB 同步 / 滞后指标：回头看，无时效性，低' },
  { country: 'US', family: 'CONFERENCE_BOARD_LAG_METRIC', tier: 'low', basis: 'PRD §10 单列：CB 同步 / 滞后指标：回头看，无时效性，低' },
  { country: 'US', family: 'WHOLESALE_INVENTORY', tier: 'low', basis: 'PRD §10 R3 跟已列族：PRD §2 低档已列「批发库存」的变体' },
])

/**
 * **事件键 → 族**（标准表里 `identity_kind='source'` 的行）。
 *
 * 一张小表、一行一个前缀，含依据。标准表里的 FOMC 身份是 `US.FOMC.<首发布日>`，
 * 它不是码表里的码；写成前缀是因为「同一场会议」只有日期不同。
 */
export const eventKeyFamilyPrefixes: readonly Readonly<{ prefix: string; family: string; basis: string }>[] =
  Object.freeze([
    { prefix: 'US.FOMC.', family: 'FOMC', basis: '标准表的 FOMC 源内身份：US.FOMC.<首发布日>' },
    { prefix: 'evt.fomc', family: 'FOMC', basis: '事件码表里已登记的事件键' },
    { prefix: 'evt.monetary-policy', family: 'POLICY_RATE', basis: '事件码表里已登记的利率决议键（有则用）' }
  ])

/**
 * **已登记的标题键 → 族**（无码、无事件键时的第三档身份）。
 *
 * 只收官方发布映射表里登记过的键（`macroCalendarReleaseValueMappingPolicy` 的 `event` /
 * `eventFamily`）；**标题自由文本永远不进这个口子**。
 */
export const titleFamilyByKey: Readonly<Record<string, string>> = Object.freeze({
  fomc: 'FOMC',
  cpi: 'CPI',
  'core-cpi': 'CORE_CPI',
  pce: 'PCE',
  'core-pce': 'CORE_PCE',
  gdp: 'GDP',
  'nonfarm-payrolls': 'NONFARM',
  unemployment: 'UNEMPLOYMENT',
  'average-hourly-earnings': 'AHE',
  'employment-situation': 'NONFARM'
})

/**
 * **官方 `eventFamily` → 族**：8 行封闭表（官方 parser 的 `eventFamily` 闭集就这几种）。
 * 修订行的写入口用它判档——那里没有指标码，只有发布族。
 */
export const officialEventFamilyToFamily: Readonly<Record<string, string>> = Object.freeze({
  fomc: 'FOMC',
  cpi: 'CPI',
  'consumer-price-index': 'CPI',
  'core-cpi': 'CORE_CPI',
  pce: 'PCE',
  'core-pce': 'CORE_PCE',
  gdp: 'GDP',
  'employment-situation': 'NONFARM'
})

/**
 * **族名归一**（只归家族名，不归身份）：同一个发布族在源侧有两个写法时，用一个别名指向规范族名。
 *
 * 今天只有一行——`FEDERAL_FUNDS_BENCHMARK` 就是 FOMC 决议那一场发布的**结果值**
 * （2026-10-28 18:00Z，值与官方 FOMC actual 同值；核查见 S4 报告）。产品 2026-11-24 定：
 * **归并进 FOMC 族，不另立第二个高族**。所以这里只把族名指向 `FOMC`，档仍由 FOMC 那一行给。
 *
 * 等这条的身份真正并进 `US.FOMC.*`（0xrouter 观测挂到官方发布名下）之后，**删这一行**。
 */
export const calendarFamilyAliases: Readonly<Record<string, string>> = Object.freeze({
  FEDERAL_FUNDS_BENCHMARK: 'FOMC'
})

export type CalendarImportanceIdentity = Readonly<{
  /** 行上的辖区码（`US` / `USA` / `EMU` / `GBR` …）。 */
  countryCode?: string
  /** 标准行的指标码；族取它的**第二段**。 */
  metricKey?: string
  /** 事件键（`US.FOMC.2026-12-09`、`evt.fomc`）。 */
  eventKey?: string
  /** 已登记的标题键。 */
  titleKey?: string
  /** 官方修订行的 `eventFamily`。 */
  eventFamily?: string
}>

export type CalendarImportanceVerdict = Readonly<{
  tier: MacroEconomicCalendarImportance
  family: string
  basis: string
}>

/** 辖区归一：只认进表的五个（`US` / `EMU` / `GB` / `JP` / `CN`）；其余返回归一后的码，查不到行就是未分级。 */
export function jurisdictionOf(countryCode: string | undefined): string {
  const trimmed = (countryCode ?? '').trim().toUpperCase()
  if (trimmed === '') return ''
  // 与全仓同一套国家归一（`USA/GBR/JPN/DEU` → 两位）；`EMU` 是唯一允许的非 ISO 值。
  return toAlpha2Country(trimmed)
}

/** 指标码 → 族：**码的第二段**（`US.CORE_CPI.NSA.YOY` → `CORE_CPI`）；不是四段码就不是指标码。 */
function familyOfMetricKey(metricKey: unknown): string | undefined {
  if (typeof metricKey !== 'string') return undefined
  const parts = metricKey.split('.')
  return parts.length >= 3 ? parts[1] : undefined
}

function familyOfEventKey(eventKey: unknown): string | undefined {
  if (typeof eventKey !== 'string') return undefined
  return eventKeyFamilyPrefixes.find((entry) => eventKey.startsWith(entry.prefix))?.family
}

/**
 * **判定一次**（方案 §1.4）。返回 `undefined` ＝未分级（表里没有、或认不出身份）。
 *
 * 身份顺序：指标码 → 事件键 → 已登记的标题键 → 官方 `eventFamily`（修订行只有它）。
 * 查表：先 `(辖区, 族)`，再 `('rest', 族)`，都没有 → 未分级。
 */
export function gradeCalendarEvent(
  identity: CalendarImportanceIdentity,
  rows: readonly CalendarImportanceRow[] = calendarImportanceRows
): CalendarImportanceVerdict | undefined {
  const jurisdiction = jurisdictionOf(identity.countryCode)
  const family = (identity.metricKey === undefined ? undefined : familyOfMetricKey(identity.metricKey))
    ?? (identity.eventKey === undefined ? undefined : familyOfEventKey(identity.eventKey))
    ?? (identity.titleKey === undefined ? undefined : titleFamilyByKey[identity.titleKey])
    ?? (identity.eventFamily === undefined ? undefined : officialEventFamilyToFamily[identity.eventFamily])
  if (family === undefined) return undefined
  // 族名归一（别名只换名字，不换身份）；规范族不重复查两次。
  const canonicalFamily = calendarFamilyAliases[family] ?? family
  const row = rows.find((entry) => entry.country === jurisdiction && entry.family === canonicalFamily)
    ?? rows.find((entry) => entry.country === 'rest' && entry.family === canonicalFamily)
  return row === undefined ? undefined : { tier: row.tier, family: row.family, basis: row.basis }
}
/**
 * **一行的档**（写入端与启动回填共用，`Chief 2026-11-24`）：只从这一行的国家 + 指标码取身份，
 * 事件行把指标码同时当事件键（`evt.*` / `US.FOMC.<日期>` 这两种身份本来就是事件）。
 *
 * 一处实现、两处调用：分开写就会出现「写入时判一个档、回填时判另一个」，而这两处判的是**同一行**。
 * 返回 `undefined` ＝未分级（表里没有这个族）；调用方写 `NULL`，不是写「低」。
 */
export function calendarImportanceGradeForRow(
  row: Readonly<{ countryCode: string; metricKey: string }>
): 'high' | 'medium' | 'low' | undefined {
  return gradeCalendarEvent({
    countryCode: row.countryCode,
    metricKey: row.metricKey,
    ...(row.metricKey.startsWith('evt.') || row.metricKey.startsWith('US.FOMC.')
      ? { eventKey: row.metricKey } : {})
  })?.tier
}

/**
 * **linked 对取哪一档**（技术方案 §4.1 末条）：同一次发布在库里是两条物理记录——标准行（有指标码）
 * 与官方修订行（有 `eventFamily`）。标准行的判据更硬（码是身份、可查表），所以它的档先；
 * 标准行未分级才回退官方那条；两边都没有 → 未分级。
 *
 * **一个函数，简报与日历两个读取端共用**：各自写一遍就会出现「同一次发布在日历上是高、
 * 在简报上是未分级」。它只做选择，不做判定——判定仍然只有 `gradeCalendarEvent` 一份。
 */
export function linkedCalendarImportance(
  standard: MacroEconomicCalendarImportance | undefined,
  official: MacroEconomicCalendarImportance | undefined
): MacroEconomicCalendarImportance | undefined {
  return standard ?? official
}
