import type { UnmappedCalendarObservation } from '../../../../service/intelligence/macro-calendar/rendering/marketCalendarUnmappedMonthRead'
import { calendarDisplayTime, type CalendarDayItem } from './economicCalendarDayModel'

/**
 * 两个来源（标准表 + 非标准表）合并成一天。
 *
 * **类型直接 import 服务侧那个渲染专用读口**（`marketCalendarUnmappedMonthRead`），不在这里
 * 再抄一份形状：抄一份就会漂——2026-11-16 我按猜的形状写了 `supersededKeys`（键集合）和
 * `'instant'`，而读口给的是 `superseded` **计数**（被标准表接管的行，读口自己就剔除了）、
 * `timePrecision: 'minute' | 'date'`、`countryCode` 可缺省、且**不给显示时刻**。
 * 用同一个类型，接线那天不需要中间映射；形状对不上就是编译错，不是运行时才发现。
 *
 * 这一层只做四件事：**排序、分组、计数、去重兜底**。不读库、不归一、不补值。
 */
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

/** 未映射行在这一天的显示时刻：只有真的给了时刻才算，否则 `undefined`（排在最后）。 */
function unmappedTime(observation: UnmappedCalendarObservation, timeZone: string): string | undefined {
  return observation.scheduledAt === undefined ? undefined : calendarDisplayTime(observation.scheduledAt, timeZone)
}

function titleOf(row: MergedCalendarRow): string {
  return row.kind === 'unmapped' ? row.observation.title : row.key
}

/**
 * 跨来源排序：**按时间升序，没有时刻的排在这一天最后**；同一时刻**标准表在前**，再按标题。
 *
 * 「没有时刻」不等于「00:00」——那是给它编一个时刻，会把一条只有日期的观测排到当天最前面，
 * 读者会以为它发生在半夜。缺失不许伪装成某个具体值。
 */
function compareRows(a: MergedCalendarRow, b: MergedCalendarRow): number {
  if (a.time && !b.time) return -1
  if (!a.time && b.time) return 1
  if (a.time && b.time && a.time !== b.time) return a.time.localeCompare(b.time)
  if (a.kind !== b.kind) return a.kind === 'standard' ? -1 : 1
  return titleOf(a).localeCompare(titleOf(b))
}

/**
 * 合并一天的两种来源。
 *
 * - `standard`：这一天已经属于标准表的条目（调用方按天取好）。
 * - `unmapped`：读口的 `entries`（已按月过滤、已按稳定键去重、已剔除被标准表接管的行）。
 * - `alreadyInStandard`：**兜底**用的稳定键集合。读口本身已经剔除并只报 `superseded` 计数，
 *   正常情况这里是空的；留这一层是因为 IPC 任一侧出问题时读者会看到同一条事件两遍，而那是
 *   最难被发现的坏法。**不按标题去重**——同名事件很多，按标题猜会悄悄吞掉真的两条。
 */
export function mergeCalendarDaySources(input: Readonly<{
  date: string
  timeZone: string
  standard: readonly CalendarDayItem[]
  unmapped: readonly UnmappedCalendarObservation[]
  alreadyInStandard?: ReadonlySet<string>
  /** 每个标准表条目在事件类型分组里的排序（沿用日历页既有口径，不在这一层重定）。 */
  compareStandard?: (a: CalendarDayItem, b: CalendarDayItem) => number
}>): CalendarDayMerge {
  const alreadyInStandard = input.alreadyInStandard ?? new Set<string>()
  const seen = new Set<string>()
  const standardRows: MergedCalendarRow[] = input.standard.map((item) => ({
    kind: 'standard', key: item.key, time: item.time, item
  }))
  type StandardRow = Extract<MergedCalendarRow, { kind: 'standard' }>
  const unmappedRows: MergedCalendarRow[] = []
  for (const observation of input.unmapped) {
    // 只取属于这一天的：别的日子的行不许被排到这一天（那正是「排到错误的一天」）。
    if (observation.scheduledDate !== input.date) continue
    if (alreadyInStandard.has(observation.key)) continue
    if (seen.has(observation.key)) continue
    seen.add(observation.key)
    unmappedRows.push({ kind: 'unmapped', key: observation.key, time: unmappedTime(observation, input.timeZone), observation })
  }
  const rows = [...standardRows, ...unmappedRows].sort(compareRows)

  const compareStandard = input.compareStandard ?? (() => 0)
  const groups: MergedCalendarGroup[] = EVENT_TYPE_ORDER.map((eventType) => ({
    kind: 'event-type' as const,
    eventType,
    rows: standardRows
      .filter((row) => {
        const item = (row as StandardRow).item
        return (item.source === 'official' ? 'economic-indicator' : item.event.eventType) === eventType
      })
      .sort((a, b) => compareStandard((a as StandardRow).item, (b as StandardRow).item))
  })).filter((group) => group.rows.length > 0)
  // 未映射那一组排在最后：它是「另一类东西」，不参与上面的类别分组（也没有重要性可排）。
  if (unmappedRows.length > 0) groups.push({ kind: 'unmapped', rows: unmappedRows })

  return {
    rows,
    groups,
    counts: { standard: standardRows.length, unmapped: unmappedRows.length, total: rows.length }
  }
}
