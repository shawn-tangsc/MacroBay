import { createHash } from 'node:crypto'

import type { MarketCalendarEvent } from '../../../contracts/macro/marketCalendarQueryContracts'
import type { StandardMonthRow } from './marketCalendarStandardMonthRead'
import { officialFeedIdOf, sourceFeedIdOf } from './marketCalendarSourceFeedIds'
import { marketCalendarCountryNames } from './marketCalendarDisplayNameTables'
import { toAlpha2Country } from './marketCalendarMetricIdentity'

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
/**
 * 行的国家名：**按码查名表**，`US` 与 `USA` 两种写法都认（存储层两种并存）。
 *
 * 为什么必须在这里给：列表行只在 `countryName` 有值时才画国家（`CalendarEventRow`），
 * 旧读法由 0xRouter 的查询侧带名，换到标准表后没人算它，于是整列国家静默消失——
 * 看起来像「这些事件没有国家」，其实是「我们没算」。
 *
 * **这里的 `toAlpha2Country` 是给历史行留的兼容层**（库里还有 329 行 `USA`，写入端已改为
 * 只落 alpha-2）。新写入的行到这里时本就是 alpha-2，这行归一不改变结果。
 */
const countryNameOf = (code: string, locale: 'zh' | 'en'): string | undefined => {
  const names = marketCalendarCountryNames[toAlpha2Country(code)]
  return names === undefined ? undefined : (locale === 'en' ? names.en : names.zh)
}

const eventTypeOf = (row: StandardMonthRow): MarketCalendarEvent['eventType'] => {
  // **先读写入侧存下来的事实**（迁移 16 之后每一行都有）；只有空值才退回前缀规则。
  // 以前只靠前缀，423 行上游 ID 数组（`["212058",70663]`）全被猜成经济指标。
  if (row.eventType !== undefined) return row.eventType
  if (!row.metricKey.startsWith('evt.')) return 'economic-indicator'
  if (/^evt\.(central-bank|monetary-policy)/.test(row.metricKey)) return 'central-bank-activity'
  return 'financial-event'
}

/**
 * 名称与来源**由调用方注入**，不在这里查表：指标码与事件码在两张不同的名表里，谁来解析是读取侧
 * 的装配事实；写死在这里就会出现「事件码去指标表查、永远落空」那类静默不显示。
 * 同时，这也让本文件不碰任何源名字面量与名表字段（两者都有守卫，一碰就要登记基线）。
 */
/**
 * `eventKey` 必须匹配契约的 UUID 形状，而且**不能随机**：读者手动改过的时刻、选中态都挂在
 * 这个键上，随机的话每查一次就是一批新键，改过的时间会自己跳回去。
 *
 * 派生输入只用**稳定身份**（国家｜码｜期间｜**首发布日**）——不带 `scheduled_date`：
 * 源改期时那个值会变，键跟着变，改期覆盖全丢。时薪那对因为首发布日不同，天然是两个键。
 */
export function eventKeyForIdentity(row: StandardMonthRow): string {
  const digest = createHash('sha256')
    .update(`${row.countryCode}|${row.metricKey}|${row.periodKey}|${row.firstScheduledDate}`)
    .digest('hex')
  const hex = digest.slice(0, 32).split('')
  hex[12] = '4'                                    // 版本位：形状合规
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-` +
    `${hex.slice(16, 20).join('')}-${hex.slice(20, 32).join('')}`
}

export type StandardEventContext = Readonly<{
  locale: 'zh' | 'en'
  resolveTitle: (row: StandardMonthRow) => string | undefined
  /** 认不出来源时**只能用 `specifiedSource` 之外的兜底值**；不传就落 `unspecified`。 */
  resolveSource?: (row: StandardMonthRow) => MarketCalendarEvent['source']
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
    // `eventKey` 由稳定身份派生（UUID 形状、跨查询不变）；`observationKey` 是同一身份的明文串，
    // 下游要「同一次发布」时用它，要「稳定的键」时用 eventKey。
    eventKey: eventKeyForIdentity(row),
    observationKey: row.identityKey,
    title,
    countryCode: row.countryCode,
    ...(countryNameOf(row.countryCode, context.locale) === undefined
      ? {} : { countryName: countryNameOf(row.countryCode, context.locale)! }),
    ...(row.identityKind === 'code' ? { eventNameKey: row.metricKey } : {}),
    eventType: eventTypeOf(row),
    // 读行里那一列：官方行本来就是 high。行上没有值（源没提供）就先不出这个字段——
    // 契约把 `importance` 改成可缺省之后，读者看到的就是「未提供」；在此之前调用方会看到 undefined。
    ...(row.importance === undefined ? {} : { importance: row.importance }),
    scheduledAt: row.scheduledAt ?? `${row.scheduledDate}T00:00:00.000Z`,
    consensus: value('consensus'), providerPrevious: value('previous'), providerActual: value('actual'),
    // **feed id 优先**：它来自写入时定下的真值；认不出时才回退到装配处给的两档旧值。
    // **feed id 优先**；认不出就用 `unspecified`（不退回删掉的旧源，也不藏这条发布）。
    source: sourceFeedIdOf({ sourceProviderId: row.sourceProviderId, eventType: eventTypeOf(row) })
      ?? context.resolveSource?.(row) ?? 'unspecified',
    ...(sourceFeedIdOf({ sourceProviderId: row.sourceProviderId, eventType: eventTypeOf(row) }) === undefined
      ? {} : { sourceFeedId: sourceFeedIdOf({ sourceProviderId: row.sourceProviderId, eventType: eventTypeOf(row) })! }),
    sourceObservedAt: row.observedAt,
    // **官方行不贴「未核验」**：它本身就是核验过的来源。判据只有一处——feed id 是不是官方那三条。
    coverage: officialFeedIdOf(row.sourceProviderId) === undefined ? 'observed-unverified' as const : 'available' as const,
    timePrecision: row.timePrecision, releaseStatus: row.status, rowKind: row.rowKind,
    // 次数只在 >1 时下发（1 次是常态，挂上去就是噪声）；界面 `=== 1` 或缺省都不显示。
    ...((row.releaseCount ?? 1) > 1 ? { releaseCount: row.releaseCount } : {}),
    ...((row.releaseDates ?? []).length > 1 ? { releaseDates: row.releaseDates! } : {})
  }
}

/** 一批行 → 事件数组：**一行都不丢**（名字缺失时退回码本身，见上面的回退链）。 */
export function standardRowsToMarketEvents(rows: readonly StandardMonthRow[], context: StandardEventContext):
  readonly MarketCalendarEvent[] {
  return rows.map((row) => standardRowToMarketEvent(row, context))
}
