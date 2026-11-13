import type { MarketCalendarEvent } from '../../../contracts/macro/marketCalendarQueryContracts'
import type { StandardMonthRow } from './marketCalendarStandardMonthRead'

/**
 * 标准行 → 日历事件（`MarketCalendarEvent`）。**`queryMonth` 的对外形状因此不变**——
 * 适配器存在的唯一理由：读侧换数据源，调用方一行都不用改。
 *
 * 三处「不能猜」：
 * 1. **名称**：标准码去名表取名（按语言），`source` 身份行用源原文名；两样都没有就不编。
 * 2. **类别**：事件码按家族映射到三类之一；指标走 `economic-indicator`。
 * 3. **重要性**：标准表**没有**这一列（这是真缺口，不是实现偷懒）——先一律 `medium` 并记在
 *    注释里，等表加上再读；不要按数值大小去猜，那会把「重要性」变成一条没人能解释的规则。
 */
const eventTypeOf = (row: StandardMonthRow): MarketCalendarEvent['eventType'] => {
  if (!row.metricKey.startsWith('evt.')) return 'economic-indicator'
  if (/^evt\.(central-bank|monetary-policy)/.test(row.metricKey)) return 'central-bank-activity'
  return 'financial-event'
}

/**
 * 名称与来源**由调用方注入**，不在这里查表：指标码与事件码在两张不同的名表里，谁来解析是读取侧
 * 的装配事实；写死在这里就会出现「事件码去指标表查、永远落空」那类静默不显示。
 * 同时，这也让本文件不碰任何源名字面量与名表字段（两者都有守卫，一碰就要登记基线）。
 */
export type StandardEventContext = Readonly<{
  locale: 'zh' | 'en'
  resolveTitle: (row: StandardMonthRow) => string | undefined
  source: MarketCalendarEvent['source']
}>

/** `undefined` ↔ 「这条行没有可显示的名字」：调用方按「不显示」处理，不猜。 */
export function standardRowToMarketEvent(row: StandardMonthRow, context: StandardEventContext):
  MarketCalendarEvent {
  /**
   * 名称回退链：名表 → 源原文名 → **码本身**。
   * 最后一档是故意的：这一行在源里**确实存在**，没有名字是「我们还没给它起名」，不是「它不存在」。
   * 早先这里 `return undefined`（悄悄少一行），读者看到的就是「这段时间没有这条发布」——
   * 正是「把读不到画成没有」，只是发生在名字这一格。宁可显示一串码，也不吞掉这条发布。
   */
  const title = context.resolveTitle(row) ?? row.sourceLabel ?? row.metricKey
  const value = (key: string) => (row.values[key] === undefined ? null : { displayValue: row.values[key]! })
  return {
    // 新读路径的 `eventKey` 就是**稳定身份串**（旧路径是每批变化的 HMAC，下游只能靠 observationKey）。
    eventKey: row.identityKey,
    observationKey: row.identityKey,
    title,
    countryCode: row.countryCode,
    ...(row.identityKind === 'code' ? { eventNameKey: row.metricKey } : {}),
    eventType: eventTypeOf(row),
    // 标准表没有重要性列：先给 `medium`，等表补上再读（不按数值猜）。
    importance: 'medium',
    scheduledAt: row.scheduledAt ?? `${row.scheduledDate}T00:00:00.000Z`,
    consensus: value('consensus'), providerPrevious: value('previous'), providerActual: value('actual'),
    source: context.source,
    sourceObservedAt: row.observedAt, coverage: 'observed-unverified',
    timePrecision: row.timePrecision, releaseStatus: row.status
  }
}

/** 一批行 → 事件数组：**一行都不丢**（名字缺失时退回码本身，见上面的回退链）。 */
export function standardRowsToMarketEvents(rows: readonly StandardMonthRow[], context: StandardEventContext):
  readonly MarketCalendarEvent[] {
  return rows.map((row) => standardRowToMarketEvent(row, context))
}
