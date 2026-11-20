import { localizedPairFor } from './marketCalendarCodeNames'
import type { ZeroXRouterIdentityEntry } from './marketCalendarMetricIdentity'

/**
 * **0xrouter 自己的「源内 id → 指标码」表**（用户 2026-11-17 定，按来源拆）。
 *
 * 为什么不并进 `zeroXRouterIndicatorIdentities`：那张表被当成「旧源反查旗标」使用（卡片取值链、
 * 名表用例都按它的条数断言），往里加条目等于改它的语义；而且两个来源的 id 命名空间本就不该
 * 混在一张表里——一撞号就会把甲的身份给乙。
 *
 * 内容来自产品经理的对照表
 * `docs-private/iterations/0.4.4-calendar-sources/32-子项码对照表-联储调查.md`：
 * **32 个 id → 18 个码**（6 个母码原样 + 12 个新子项码）。子项码按五段形状
 * `{国家}.{母族}.{子项}.{调整}.{测度}`，**码里不含月份**（月份是期次，不是身份）。
 *
 * **两条 GfK 故意不在表里**：`214240`（11月）、`215037`（12月）是德国 GfK 消费者信心，
 * 名字里含「消费者信心」被匹到 `US.CONSUMER_CONFIDENCE`，属跨国误配。给它们码就是把德国数据
 * 记到美国指标名下——宁可留着「只有名字」。
 *
 * `EMPLOYMENT` 在词表里但本表没有用到：纽约联储就业类 id 还在未映射名单里，**不建空条目**。
 */
export const zeroXRouterSourceMetricMappings: Readonly<Record<string, ZeroXRouterIdentityEntry>> = Object.freeze({
  // ① 纽约联储制造业（母：213922 / 214790）
  '213922': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL', periodRule: 'current_month' },
  '214790': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL', periodRule: 'current_month' },
  '213925': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.NEW_ORDERS.SA.LEVEL', periodRule: 'current_month' },
  '214793': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.NEW_ORDERS.SA.LEVEL', periodRule: 'current_month' },
  '213924': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.PRICES_PAID.SA.LEVEL', periodRule: 'current_month' },
  // 就业子项：`EMPLOYMENT` 早就在闭集里，只是当时有词没数据；现在数据来了，补两个码（词表不动）。
  '213926': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.EMPLOYMENT.SA.LEVEL', periodRule: 'current_month' },
  '214791': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.EMPLOYMENT.SA.LEVEL', periodRule: 'current_month' },
  '213936': { metricKey: 'US.PHILLY_FED_MANUFACTURING.EMPLOYMENT.SA.LEVEL', periodRule: 'current_month' },
  '214907': { metricKey: 'US.PHILLY_FED_MANUFACTURING.EMPLOYMENT.SA.LEVEL', periodRule: 'current_month' },
  '214792': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.PRICES_PAID.SA.LEVEL', periodRule: 'current_month' },
  '213923': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.PRICES_RECEIVED.SA.LEVEL', periodRule: 'current_month' },
  '214794': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.PRICES_RECEIVED.SA.LEVEL', periodRule: 'current_month' },
  // ② 费城联储制造业（母：213934 / 214905）
  '213934': { metricKey: 'US.PHILLY_FED_MANUFACTURING.SA.LEVEL', periodRule: 'current_month' },
  '214905': { metricKey: 'US.PHILLY_FED_MANUFACTURING.SA.LEVEL', periodRule: 'current_month' },
  '213935': { metricKey: 'US.PHILLY_FED_MANUFACTURING.SHIPMENTS.SA.LEVEL', periodRule: 'current_month' },
  '214906': { metricKey: 'US.PHILLY_FED_MANUFACTURING.SHIPMENTS.SA.LEVEL', periodRule: 'current_month' },
  '213939': { metricKey: 'US.PHILLY_FED_MANUFACTURING.NEW_ORDERS.SA.LEVEL', periodRule: 'current_month' },
  '214910': { metricKey: 'US.PHILLY_FED_MANUFACTURING.NEW_ORDERS.SA.LEVEL', periodRule: 'current_month' },
  '213937': { metricKey: 'US.PHILLY_FED_MANUFACTURING.PRICES_PAID.SA.LEVEL', periodRule: 'current_month' },
  '214908': { metricKey: 'US.PHILLY_FED_MANUFACTURING.PRICES_PAID.SA.LEVEL', periodRule: 'current_month' },
  '213938': { metricKey: 'US.PHILLY_FED_MANUFACTURING.PRICES_RECEIVED.SA.LEVEL', periodRule: 'current_month' },
  '214909': { metricKey: 'US.PHILLY_FED_MANUFACTURING.PRICES_RECEIVED.SA.LEVEL', periodRule: 'current_month' },
  // ③ 达拉斯联储制造业（母：214203）
  '214203': { metricKey: 'US.DALLAS_FED_MANUFACTURING.SA.LEVEL', periodRule: 'current_month' },
  '214206': { metricKey: 'US.DALLAS_FED_MANUFACTURING.PRODUCTION.SA.LEVEL', periodRule: 'current_month' },
  '214205': { metricKey: 'US.DALLAS_FED_MANUFACTURING.PRICES_PAID.SA.LEVEL', periodRule: 'current_month' },
  '214208': { metricKey: 'US.DALLAS_FED_MANUFACTURING.SHIPMENTS.SA.LEVEL', periodRule: 'current_month' },
  // ④ 堪萨斯联储制造业（母：214119 / 214915）
  '214119': { metricKey: 'US.KANSAS_FED_MANUFACTURING.SA.LEVEL', periodRule: 'current_month' },
  '214915': { metricKey: 'US.KANSAS_FED_MANUFACTURING.SA.LEVEL', periodRule: 'current_month' },
  '214120': { metricKey: 'US.KANSAS_FED_MANUFACTURING.PRODUCTION.SA.LEVEL', periodRule: 'current_month' },
  '214916': { metricKey: 'US.KANSAS_FED_MANUFACTURING.PRODUCTION.SA.LEVEL', periodRule: 'current_month' },
  // ⑤ 产能利用率（母：213977 / 214827）
  '213977': { metricKey: 'US.CAPACITY_UTILIZATION.SA.RATE', periodRule: 'month' },
  '214827': { metricKey: 'US.CAPACITY_UTILIZATION.SA.RATE', periodRule: 'month' },
  '213980': { metricKey: 'US.CAPACITY_UTILIZATION.MANUFACTURING.SA.RATE', periodRule: 'month' },
  '214830': { metricKey: 'US.CAPACITY_UTILIZATION.MANUFACTURING.SA.RATE', periodRule: 'month' },
  // ⑥ 谘商会消费者信心（母：214232 / 214991）
  '214232': { metricKey: 'US.CONSUMER_CONFIDENCE.SA.LEVEL', periodRule: 'current_month' },
  // NAR 成屋签约（码已有：月率/年率两条，指数水平那条落月率码上）
  '214062': { metricKey: 'US.PENDING_HOME_SALES.SA.MOM', periodRule: 'month' },
  '214063': { metricKey: 'US.PENDING_HOME_SALES.SA.MOM', periodRule: 'month' },
  '214064': { metricKey: 'US.PENDING_HOME_SALES.NSA.YOY', periodRule: 'month' },
  '214864': { metricKey: 'US.PENDING_HOME_SALES.SA.MOM', periodRule: 'month' },
  '214865': { metricKey: 'US.PENDING_HOME_SALES.SA.MOM', periodRule: 'month' },
  '214866': { metricKey: 'US.PENDING_HOME_SALES.NSA.YOY', periodRule: 'month' },
  // 谘商会领先指标（综合码 `US.LEI.SA.MOM`）
  '213336': { metricKey: 'US.LEI.SA.MOM', periodRule: 'month' },
  '214115': { metricKey: 'US.LEI.SA.MOM', periodRule: 'month' },
  '214116': { metricKey: 'US.LEI.SA.MOM', periodRule: 'month' },
  '214911': { metricKey: 'US.LEI.SA.MOM', periodRule: 'month' },
  '214912': { metricKey: 'US.LEI.SA.MOM', periodRule: 'month' },
  // 标普全球 PMI 三族（初值落同一码：初值/终值是同一码的两次发布）
  '214147': { metricKey: 'US.SP_COMPOSITE_PMI.SA.LEVEL', periodRule: 'month' },
  '214976': { metricKey: 'US.SP_COMPOSITE_PMI.SA.LEVEL', periodRule: 'month' },
  '214148': { metricKey: 'US.SP_MANUFACTURING_PMI.SA.LEVEL', periodRule: 'current_month' },
  '214977': { metricKey: 'US.SP_MANUFACTURING_PMI.SA.LEVEL', periodRule: 'current_month' },
  '214149': { metricKey: 'US.SP_SERVICES_PMI.SA.LEVEL', periodRule: 'current_month' },
  '214978': { metricKey: 'US.SP_SERVICES_PMI.SA.LEVEL', periodRule: 'current_month' },
  // 库存、NAHB、企业获利、达拉斯原材料支付价格（都是既有码）
  '213944': { metricKey: 'US.BUSINESS_INVENTORIES.SA.MOM', periodRule: 'month' },
  '214831': { metricKey: 'US.BUSINESS_INVENTORIES.SA.MOM', periodRule: 'month' },
  '214254': { metricKey: 'US.WHOLESALE_INVENTORIES.SA.MOM', periodRule: 'month' },
  '214038': { metricKey: 'US.NAHB_HOUSING_MARKET.NONE.LEVEL', periodRule: 'month' },
  '214832': { metricKey: 'US.NAHB_HOUSING_MARKET.NONE.LEVEL', periodRule: 'month' },
  '214280': { metricKey: 'US.CORPORATE_PROFITS.SA.QOQ', periodRule: 'quarter' },
  '215018': { metricKey: 'US.CORPORATE_PROFITS.SA.QOQ', periodRule: 'quarter' },
  '213488': { metricKey: 'US.DALLAS_FED_MANUFACTURING.PRICES_PAID.SA.LEVEL', periodRule: 'current_month' },
  // 核心零售月率 2 条 → `US.RETAIL_SALES_EX_AUTOS.SA.MOM`
  // 依据是**数值**不是名字：同期预期 0.4% 与控制组 0.1 不同（排除控制组）、亿美元口径 6051.88 落在
  // ex-autos 的量级上。亿美元那 2 条**不映射**：同一条发布同时给 +0.9% 与 −4.2%，口径不明。
  '213942': { metricKey: 'US.RETAIL_SALES_EX_AUTOS.SA.MOM', periodRule: 'month' },
  '214824': { metricKey: 'US.RETAIL_SALES_EX_AUTOS.SA.MOM', periodRule: 'month' },
  // 谘商会消费者预期/现况（母族已有子项体系，两个词都在闭集里）
  '214233': { metricKey: 'US.CONSUMER_CONFIDENCE.EXPECTATIONS.SA.LEVEL', periodRule: 'current_month' },
  '214992': { metricKey: 'US.CONSUMER_CONFIDENCE.EXPECTATIONS.SA.LEVEL', periodRule: 'current_month' },
  '214234': { metricKey: 'US.CONSUMER_CONFIDENCE.CURRENT.SA.LEVEL', periodRule: 'current_month' },
  '214993': { metricKey: 'US.CONSUMER_CONFIDENCE.CURRENT.SA.LEVEL', periodRule: 'current_month' },
  // 就业成本指数（新码；不是 `UNIT_LABOR_COSTS`，那个已有且是另一个指标）
  '214345': { metricKey: 'US.ECI.SA.QOQ', periodRule: 'quarter' },
  // 月份变体：**同族 + 同测度**，季调档按「该族该测度只有唯一码」才落（SA/NSA 并存时跳过）
  '213978': { metricKey: 'US.INDUSTRIAL_PRODUCTION.SA.MOM', periodRule: 'month' },
  '213979': { metricKey: 'US.MANUFACTURING_PRODUCTION.SA.MOM', periodRule: 'month' },
  '214150': { metricKey: 'US.MICHIGAN_CURRENT.NONE.LEVEL', periodRule: 'current_month' },
  '214151': { metricKey: 'US.MICHIGAN_EXPECTATIONS.NONE.LEVEL', periodRule: 'current_month' },
  '214202': { metricKey: 'US.CHICAGO_FED_NATIONAL_ACTIVITY.NONE.LEVEL', periodRule: 'month' },
  '214235': { metricKey: 'US.NEW_HOME_SALES.SA.MOM', periodRule: 'month' },
  '214293': { metricKey: 'US.PERSONAL_INCOME.SA.MOM', periodRule: 'month' },
  '214692': { metricKey: 'US.HOUSING_STARTS.SA.MOM', periodRule: 'month' },
  '214828': { metricKey: 'US.INDUSTRIAL_PRODUCTION.SA.MOM', periodRule: 'month' },
  '214829': { metricKey: 'US.MANUFACTURING_PRODUCTION.SA.MOM', periodRule: 'month' },
  '214861': { metricKey: 'US.HOUSING_STARTS.SA.MOM', periodRule: 'month' },
  '214940': { metricKey: 'US.MICHIGAN_CURRENT.NONE.LEVEL', periodRule: 'current_month' },
  '214941': { metricKey: 'US.MICHIGAN_EXPECTATIONS.NONE.LEVEL', periodRule: 'current_month' },
  '214974': { metricKey: 'US.CHICAGO_FED_NATIONAL_ACTIVITY.NONE.LEVEL', periodRule: 'month' },
  '215028': { metricKey: 'US.PERSONAL_INCOME.SA.MOM', periodRule: 'month' },
  '215029': { metricKey: 'US.NEW_HOME_SALES.SA.MOM', periodRule: 'month' },
  // 零售销售**总量**：码本来就有（`US.RETAIL_SALES.SA.MOM`），只是这两个 id 没接上
  '213940': { metricKey: 'US.RETAIL_SALES.SA.MOM', periodRule: 'month' },
  '214822': { metricKey: 'US.RETAIL_SALES.SA.MOM', periodRule: 'month' },

  // GDP 平减指数（初值/修正值同一码的两次发布）与最终销售（初值/修正值同上）
  '214281': { metricKey: 'US.GDP_DEFLATOR.SA.QOQ', periodRule: 'quarter' },
  '215019': { metricKey: 'US.GDP_DEFLATOR.SA.QOQ', periodRule: 'quarter' },
  '214279': { metricKey: 'US.FINAL_SALES.SA.ANNUALIZED_QOQ', periodRule: 'quarter' },
  '215017': { metricKey: 'US.FINAL_SALES.SA.ANNUALIZED_QOQ', periodRule: 'quarter' },
  // FHFA 房价（既有码：月率 SA.MOM、年率 NSA.YOY）
  '214226': { metricKey: 'US.FHFA_HOUSE_PRICE.SA.MOM', periodRule: 'month' },
  '214985': { metricKey: 'US.FHFA_HOUSE_PRICE.SA.MOM', periodRule: 'month' },
  '214227': { metricKey: 'US.FHFA_HOUSE_PRICE.NSA.YOY', periodRule: 'month' },
  '214986': { metricKey: 'US.FHFA_HOUSE_PRICE.NSA.YOY', periodRule: 'month' },
  // 标普/凯斯席勒 **20 城季调年率**（新码）；10 城与未季调那 8 条**刻意不映射**
  '214228': { metricKey: 'US.CASE_SHILLER_20.SA.YOY', periodRule: 'month' },
  '214987': { metricKey: 'US.CASE_SHILLER_20.SA.YOY', periodRule: 'month' },
  // 达拉斯三个子项（母族已有子项体系，词都在闭集里）与芝加哥 PMI（既有码）
  '214207': { metricKey: 'US.DALLAS_FED_MANUFACTURING.EMPLOYMENT.SA.LEVEL', periodRule: 'current_month' },
  '214209': { metricKey: 'US.DALLAS_FED_MANUFACTURING.NEW_ORDERS.SA.LEVEL', periodRule: 'current_month' },
  '214204': { metricKey: 'US.DALLAS_FED_MANUFACTURING.PRICES_RECEIVED.SA.LEVEL', periodRule: 'current_month' },
  '214350': { metricKey: 'US.CHICAGO_PMI.SA.LEVEL', periodRule: 'current_month' },
  // 里奇蒙德一族（三个独立母码，不新开子项体系）：码本来就存在，只补映射。
  '212683': { metricKey: 'US.RICHMOND_FED_MANUFACTURING.SA.LEVEL', periodRule: 'current_month' },
  '214237': { metricKey: 'US.RICHMOND_FED_MANUFACTURING.SA.LEVEL', periodRule: 'current_month' },
  '214994': { metricKey: 'US.RICHMOND_FED_MANUFACTURING.SA.LEVEL', periodRule: 'current_month' },
  '214238': { metricKey: 'US.RICHMOND_FED_SERVICES.SA.LEVEL', periodRule: 'month' },
  '214995': { metricKey: 'US.RICHMOND_FED_SERVICES.SA.LEVEL', periodRule: 'month' },
  '214239': { metricKey: 'US.RICHMOND_FED_SHIPMENTS.SA.LEVEL', periodRule: 'month' },
  '214996': { metricKey: 'US.RICHMOND_FED_SHIPMENTS.SA.LEVEL', periodRule: 'month' },
  // 进出口物价：码已有（`US.EXPORT_PRICES.*` / `US.IMPORT_PRICES.*`），按月率/年率对口径。
  '213973': { metricKey: 'US.EXPORT_PRICES.SA.MOM', periodRule: 'month' },
  '213974': { metricKey: 'US.EXPORT_PRICES.NSA.YOY', periodRule: 'month' },
  '214818': { metricKey: 'US.EXPORT_PRICES.SA.MOM', periodRule: 'month' },
  '214819': { metricKey: 'US.EXPORT_PRICES.NSA.YOY', periodRule: 'month' },
  '213975': { metricKey: 'US.IMPORT_PRICES.SA.MOM', periodRule: 'month' },
  '213976': { metricKey: 'US.IMPORT_PRICES.NSA.YOY', periodRule: 'month' },
  '214820': { metricKey: 'US.IMPORT_PRICES.SA.MOM', periodRule: 'month' },
  '214821': { metricKey: 'US.IMPORT_PRICES.NSA.YOY', periodRule: 'month' },
  '214991': { metricKey: 'US.CONSUMER_CONFIDENCE.SA.LEVEL', periodRule: 'current_month' }
})

/** 明知对不上、故意不给码的 id（跨来源误配）：留着是为了下次不再重判一遍。 */
export const zeroXRouterSourceRejectedIds: Readonly<Record<string, string>> = Object.freeze({
  '214240': '11月 GfK 消费者信心指数是德国指标，名字含「消费者信心」被匹到 US.CONSUMER_CONFIDENCE，跨国误配',
  '215037': '12月 GfK 消费者信心指数同上'
})

/**
 * **子项码 → 母码**（用户 2026-11-17：界面要能看出子项属于哪个母指标）。
 *
 * 为什么写成一张显式表、而不是让读侧按五段/四段去截字符串：段数是命名规则的内部细节，
 * 截一次就等于把规则复制了第二份；改一次分词就得改两处，而且截错了不会报错，只会静默给出错父级。
 */
export const subItemParentByMetricKey: Readonly<Record<string, string>> = Object.freeze({
  'US.PHILLY_FED_MANUFACTURING.SHIPMENTS.SA.LEVEL': 'US.PHILLY_FED_MANUFACTURING.SA.LEVEL',
  'US.PHILLY_FED_MANUFACTURING.NEW_ORDERS.SA.LEVEL': 'US.PHILLY_FED_MANUFACTURING.SA.LEVEL',
  'US.PHILLY_FED_MANUFACTURING.PRICES_PAID.SA.LEVEL': 'US.PHILLY_FED_MANUFACTURING.SA.LEVEL',
  'US.PHILLY_FED_MANUFACTURING.PRICES_RECEIVED.SA.LEVEL': 'US.PHILLY_FED_MANUFACTURING.SA.LEVEL',
  'US.EMPIRE_STATE_MANUFACTURING.NEW_ORDERS.SA.LEVEL': 'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL',
  'US.EMPIRE_STATE_MANUFACTURING.PRICES_PAID.SA.LEVEL': 'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL',
  'US.EMPIRE_STATE_MANUFACTURING.PRICES_RECEIVED.SA.LEVEL': 'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL',
  'US.DALLAS_FED_MANUFACTURING.PRODUCTION.SA.LEVEL': 'US.DALLAS_FED_MANUFACTURING.SA.LEVEL',
  'US.DALLAS_FED_MANUFACTURING.PRICES_PAID.SA.LEVEL': 'US.DALLAS_FED_MANUFACTURING.SA.LEVEL',
  'US.DALLAS_FED_MANUFACTURING.SHIPMENTS.SA.LEVEL': 'US.DALLAS_FED_MANUFACTURING.SA.LEVEL',
  'US.KANSAS_FED_MANUFACTURING.PRODUCTION.SA.LEVEL': 'US.KANSAS_FED_MANUFACTURING.SA.LEVEL',
  'US.CAPACITY_UTILIZATION.MANUFACTURING.SA.RATE': 'US.CAPACITY_UTILIZATION.SA.RATE'
})

/**
 * **子项在词表里的顺序**（用户 2026-11-17：排序按族分组、子项内部按词表序）。
 * 界面不许自己写一份中文词表去排——那是把命名规则复制第二份；顺序由词表本身给出。
 */
const SUB_ITEM_WORD_ORDER: readonly string[] = Object.freeze([
  'SHIPMENTS', 'NEW_ORDERS', 'UNFILLED_ORDERS', 'INVENTORIES', 'EMPLOYMENT',
  'WORK_HOURS', 'PRICES_PAID', 'PRICES_RECEIVED', 'PRODUCTION', 'MANUFACTURING',
  'CURRENT', 'EXPECTATIONS'
])

/** 子项码 → 它在词表里的序号（母码/普通指标没有这个数）。 */
export function subItemOrderOf(metricKey: string): number | undefined {
  const parent = subItemParentByMetricKey[metricKey]
  if (parent === undefined) return undefined
  const segments = metricKey.split('.')
  if (segments.length < 3) return undefined
  const word = segments[segments.length - 3] ?? ''
  const index = SUB_ITEM_WORD_ORDER.indexOf(word)
  return index < 0 ? undefined : index
}

/**
 * **详情里那一行「指标层级」**（用户 2026-11-17）：子项给「所属指标」，母项给「分项」。
 *
 * 三条规定：子项要给**母指标的中文名**（给母码对读者没意义）而不是只写一句「这是子项」；
 * 母项要列出**分项的中文名**并按词表顺序；两者都从层级表取，**不在渲染层拼接**。
 * 没有层级关系（普通指标）返回 `undefined`，界面整行不显示——不画空标签。
 */
export function hierarchyForMetricKey(metricKey: string): Readonly<{
  kind: 'parent' | 'child'
  parentName?: string
  childNames?: readonly string[]
}> | undefined {
  return hierarchyOf(metricKey)
}

const hierarchyOf = (metricKey: string): Readonly<{
  kind: 'parent' | 'child'
  parentName?: string
  childNames?: readonly string[]
}> | undefined => {
  const parent = subItemParentByMetricKey[metricKey]
  if (parent !== undefined) {
    const parentName = nameOf(parent)
    return parentName === undefined ? { kind: 'child' } : { kind: 'child', parentName }
  }
  const children = Object.entries(subItemParentByMetricKey)
    .filter(([, mother]) => mother === metricKey)
    .sort(([left], [right]) => (subItemOrderOf(left) ?? 99) - (subItemOrderOf(right) ?? 99))
    .map(([child]) => nameOf(child))
    .filter((name): name is string => name !== undefined)
  return children.length === 0 ? undefined : { kind: 'parent', childNames: children }
}

/** 中文简称（界面那一行用的是读者看得懂的名字，不是码）。 */
const nameOf = (metricKey: string): string | undefined => {
  const pair = localizedPairFor(metricKey)
  return pair?.zh
}
