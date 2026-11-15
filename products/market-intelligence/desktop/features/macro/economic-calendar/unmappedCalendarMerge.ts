import type { CalendarDayItem } from './economicCalendarDayModel'

/**
 * 未映射观测（进不了标准表的那批）的渲染侧形态。
 *
 * 字段照服务侧 `listUnmappedCalendarObservationsForRendering` 的返回一一对应——**这里只做形状**，
 * 不做归一、不做补值：国家原值照抄（`US` 就 `US`、`USA` 就 `USA`），没有时刻的**不许编一个**。
 *
 * 用户 2026-11-16 拍板：日历显示两个来源（标准表 + 非标准表），界面上要能区分。合并规则由
 * 这一层负责，**只有这一处**：排序、去重、分组、计数都在这里判一次。
 */
export type UnmappedCalendarObservation = Readonly<{
  /** 稳定键（`provider:source_key`）：渲染 key 与去重都靠它，不用自增 id。 */
  key: string
  /** 这一条属于读者时区里的哪一天（`YYYY-MM-DD`，服务侧已按 asOf 切好）。 */
  date: string
  /** 有时刻才有；`timePrecision: 'date'` 的那些行**没有**这一项，排在有时刻的行之后。 */
  scheduledAt?: string
  /** 显示用的时刻（`HH:mm`，读者时区）；没有就不给。 */
  time?: string
  timePrecision: 'instant' | 'date'
  title: string
  /** 源给的国家码原值，不归一：显示时交给 `calendarCountryLabel` 决定名字还是原值。 */
  countryCode: string | null
  eventType: 'economic-indicator' | 'financial-event' | 'central-bank-activity' | 'unknown'
  /** 没进标准表的原因（服务侧闭集）。渲染只透传，不解释。 */
  reason: string
  providerId: string
}>

/** 合并后的一行：标准表那行，或未映射观测那行。`kind` 是渲染层区分两个来源的唯一依据。 */
export type MergedCalendarRow =
  | Readonly<{ kind: 'standard'; key: string; time: string | undefined; item: CalendarDayItem }>
  | Readonly<{ kind: 'unmapped'; key: string; time: string | undefined; observation: UnmappedCalendarObservation }>

export type MergedCalendarGroup =
  | Readonly<{ kind: 'event-type'; eventType: 'economic-indicator' | 'financial-event' | 'central-bank-activity'; rows: readonly MergedCalendarRow[] }>
  /** 「未入标准表」单独一组：这些行**没有重要性分级**，也不进按类别的分组。 */
  | Readonly<{ kind: 'unmapped'; rows: readonly MergedCalendarRow[] }>

export type CalendarDayMerge = Readonly<{
  rows: readonly MergedCalendarRow[]
  groups: readonly MergedCalendarGroup[]
  /** 这一天的条数：两个来源都算（读者看到的是「今天有几件事」）。 */
  counts: Readonly<{ standard: number; unmapped: number; total: number }>
}>

const EVENT_TYPE_ORDER = ['economic-indicator', 'financial-event', 'central-bank-activity'] as const

function titleOf(row: MergedCalendarRow): string {
  return row.kind === 'unmapped' ? row.observation.title : row.key
}

function timeOf(row: MergedCalendarRow): string | undefined {
  return row.time
}

/**
 * 跨来源排序：**按时间升序，没有时刻的排在这一天最后**；同一时刻**标准表在前**，再按标题。
 *
 * 「没有时刻」不等于「00:00」——那是给它编一个时刻，会把一条只有日期的观测排到当天最前面，
 * 读者会以为它发生在半夜。
 */
function compareRows(a: MergedCalendarRow, b: MergedCalendarRow): number {
  const timeA = timeOf(a)
  const timeB = timeOf(b)
  if (timeA && !timeB) return -1
  if (!timeA && timeB) return 1
  if (timeA && timeB && timeA !== timeB) return timeA.localeCompare(timeB)
  if (a.kind !== b.kind) return a.kind === 'standard' ? -1 : 1
  return titleOf(a).localeCompare(titleOf(b))
}

/**
 * 合并一天的两种来源。
 *
 * - `standard`：这一天已经属于标准表的条目（调用方按天取好）。
 * - `unmapped`：未映射观测；其中**已经进标准表的那批**由服务侧以 `supersededKeys` 给出，
 *   这里按稳定键剔除——同一事件只出现一次，且以标准表为准（用户与 Chief 2026-11-16 的规则）。
 *   之所以用显式集合而不是「按标题猜」：同名事件很多，按标题去重会悄悄吞掉真的两条。
 * - 未映射行**不进事件类型分组**，单独落最后一组「未入标准表」；也不给它编重要性。
 */
export function mergeCalendarDaySources(input: Readonly<{
  date: string
  standard: readonly CalendarDayItem[]
  unmapped: readonly UnmappedCalendarObservation[]
  /** 已经并进标准表的观测稳定键：这些不再以「未映射」身份出现。 */
  supersededKeys?: ReadonlySet<string>
  /** 每个标准表条目在事件类型分组里的排序（沿用日历页既有口径，不在这一层重定）。 */
  compareStandard?: (a: CalendarDayItem, b: CalendarDayItem) => number
}>): CalendarDayMerge {
  const superseded = input.supersededKeys ?? new Set<string>()
  const seen = new Set<string>()
  const standardRows: MergedCalendarRow[] = input.standard.map((item) => ({
    kind: 'standard', key: item.key, time: item.time, item
  }))
  const unmappedRows: MergedCalendarRow[] = []
  for (const observation of input.unmapped) {
    if (observation.date !== input.date) continue
    if (superseded.has(observation.key)) continue
    // 同一个稳定键重复到达只算一条：渲染 key 撞了会让 React 复用到别的行。
    if (seen.has(observation.key)) continue
    seen.add(observation.key)
    unmappedRows.push({ kind: 'unmapped', key: observation.key, time: observation.time, observation })
  }
  const rows = [...standardRows, ...unmappedRows].sort(compareRows)

  const compareStandard = input.compareStandard ?? (() => 0)
  const groups: MergedCalendarGroup[] = EVENT_TYPE_ORDER.map((eventType) => ({
    kind: 'event-type' as const,
    eventType,
    rows: standardRows
      .filter((row) => {
        const item = (row as Extract<MergedCalendarRow, { kind: 'standard' }>).item
        return (item.source === 'official' ? 'economic-indicator' : item.event.eventType) === eventType
      })
      .sort((a, b) => compareStandard(
        (a as Extract<MergedCalendarRow, { kind: 'standard' }>).item,
        (b as Extract<MergedCalendarRow, { kind: 'standard' }>).item
      ))
  })).filter((group) => group.rows.length > 0)
  // 未映射那一组排在最后：它是「另一类东西」，不参与上面的类别分组（也没有重要性可排）。
  if (unmappedRows.length > 0) groups.push({ kind: 'unmapped', rows: unmappedRows })

  return {
    rows,
    groups,
    counts: { standard: standardRows.length, unmapped: unmappedRows.length, total: rows.length }
  }
}
