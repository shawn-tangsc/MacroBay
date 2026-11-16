import { localizedPairFor } from './marketCalendarCodeNames'
import type { ZeroXRouterPeriodRule } from './marketCalendarMetricIdentity'

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
export const zeroXRouterSourceMetricMappings: Readonly<Record<string, Readonly<{
  metricKey: string
  periodRule: ZeroXRouterPeriodRule
}>>> = Object.freeze({
  // ① 纽约联储制造业（母：213922 / 214790）
  '213922': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL', periodRule: 'month' },
  '214790': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL', periodRule: 'month' },
  '213925': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.NEW_ORDERS.SA.LEVEL', periodRule: 'month' },
  '214793': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.NEW_ORDERS.SA.LEVEL', periodRule: 'month' },
  '213924': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.PRICES_PAID.SA.LEVEL', periodRule: 'month' },
  // 就业子项：`EMPLOYMENT` 早就在闭集里，只是当时有词没数据；现在数据来了，补两个码（词表不动）。
  '213926': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.EMPLOYMENT.SA.LEVEL', periodRule: 'month' },
  '214791': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.EMPLOYMENT.SA.LEVEL', periodRule: 'month' },
  '213936': { metricKey: 'US.PHILLY_FED_MANUFACTURING.EMPLOYMENT.SA.LEVEL', periodRule: 'month' },
  '214907': { metricKey: 'US.PHILLY_FED_MANUFACTURING.EMPLOYMENT.SA.LEVEL', periodRule: 'month' },
  '214792': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.PRICES_PAID.SA.LEVEL', periodRule: 'month' },
  '213923': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.PRICES_RECEIVED.SA.LEVEL', periodRule: 'month' },
  '214794': { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.PRICES_RECEIVED.SA.LEVEL', periodRule: 'month' },
  // ② 费城联储制造业（母：213934 / 214905）
  '213934': { metricKey: 'US.PHILLY_FED_MANUFACTURING.SA.LEVEL', periodRule: 'month' },
  '214905': { metricKey: 'US.PHILLY_FED_MANUFACTURING.SA.LEVEL', periodRule: 'month' },
  '213935': { metricKey: 'US.PHILLY_FED_MANUFACTURING.SHIPMENTS.SA.LEVEL', periodRule: 'month' },
  '214906': { metricKey: 'US.PHILLY_FED_MANUFACTURING.SHIPMENTS.SA.LEVEL', periodRule: 'month' },
  '213939': { metricKey: 'US.PHILLY_FED_MANUFACTURING.NEW_ORDERS.SA.LEVEL', periodRule: 'month' },
  '214910': { metricKey: 'US.PHILLY_FED_MANUFACTURING.NEW_ORDERS.SA.LEVEL', periodRule: 'month' },
  '213937': { metricKey: 'US.PHILLY_FED_MANUFACTURING.PRICES_PAID.SA.LEVEL', periodRule: 'month' },
  '214908': { metricKey: 'US.PHILLY_FED_MANUFACTURING.PRICES_PAID.SA.LEVEL', periodRule: 'month' },
  '213938': { metricKey: 'US.PHILLY_FED_MANUFACTURING.PRICES_RECEIVED.SA.LEVEL', periodRule: 'month' },
  '214909': { metricKey: 'US.PHILLY_FED_MANUFACTURING.PRICES_RECEIVED.SA.LEVEL', periodRule: 'month' },
  // ③ 达拉斯联储制造业（母：214203）
  '214203': { metricKey: 'US.DALLAS_FED_MANUFACTURING.SA.LEVEL', periodRule: 'month' },
  '214206': { metricKey: 'US.DALLAS_FED_MANUFACTURING.PRODUCTION.SA.LEVEL', periodRule: 'month' },
  '214205': { metricKey: 'US.DALLAS_FED_MANUFACTURING.PRICES_PAID.SA.LEVEL', periodRule: 'month' },
  '214208': { metricKey: 'US.DALLAS_FED_MANUFACTURING.SHIPMENTS.SA.LEVEL', periodRule: 'month' },
  // ④ 堪萨斯联储制造业（母：214119 / 214915）
  '214119': { metricKey: 'US.KANSAS_FED_MANUFACTURING.SA.LEVEL', periodRule: 'month' },
  '214915': { metricKey: 'US.KANSAS_FED_MANUFACTURING.SA.LEVEL', periodRule: 'month' },
  '214120': { metricKey: 'US.KANSAS_FED_MANUFACTURING.PRODUCTION.SA.LEVEL', periodRule: 'month' },
  '214916': { metricKey: 'US.KANSAS_FED_MANUFACTURING.PRODUCTION.SA.LEVEL', periodRule: 'month' },
  // ⑤ 产能利用率（母：213977 / 214827）
  '213977': { metricKey: 'US.CAPACITY_UTILIZATION.SA.RATE', periodRule: 'month' },
  '214827': { metricKey: 'US.CAPACITY_UTILIZATION.SA.RATE', periodRule: 'month' },
  '213980': { metricKey: 'US.CAPACITY_UTILIZATION.MANUFACTURING.SA.RATE', periodRule: 'month' },
  '214830': { metricKey: 'US.CAPACITY_UTILIZATION.MANUFACTURING.SA.RATE', periodRule: 'month' },
  // ⑥ 谘商会消费者信心（母：214232 / 214991）
  '214232': { metricKey: 'US.CONSUMER_CONFIDENCE.SA.LEVEL', periodRule: 'month' },
  // 里奇蒙德一族（三个独立母码，不新开子项体系）：码本来就存在，只补映射。
  '212683': { metricKey: 'US.RICHMOND_FED_MANUFACTURING.SA.LEVEL', periodRule: 'month' },
  '214237': { metricKey: 'US.RICHMOND_FED_MANUFACTURING.SA.LEVEL', periodRule: 'month' },
  '214994': { metricKey: 'US.RICHMOND_FED_MANUFACTURING.SA.LEVEL', periodRule: 'month' },
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
  '214991': { metricKey: 'US.CONSUMER_CONFIDENCE.SA.LEVEL', periodRule: 'month' }
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
