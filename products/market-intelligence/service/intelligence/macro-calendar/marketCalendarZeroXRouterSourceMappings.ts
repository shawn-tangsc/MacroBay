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
  '214991': { metricKey: 'US.CONSUMER_CONFIDENCE.SA.LEVEL', periodRule: 'month' }
})

/** 明知对不上、故意不给码的 id（跨来源误配）：留着是为了下次不再重判一遍。 */
export const zeroXRouterSourceRejectedIds: Readonly<Record<string, string>> = Object.freeze({
  '214240': '11月 GfK 消费者信心指数是德国指标，名字含「消费者信心」被匹到 US.CONSUMER_CONFIDENCE，跨国误配',
  '215037': '12月 GfK 消费者信心指数同上'
})
