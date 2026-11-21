/**
 * 码表 / 事件表的**单元格渲染**（三处口径，只此一份）。
 *
 * 抽出来的理由：这三段都在解释「为什么这一格这样画」，混在 500+ 行的弹框里读不出来；而且官网页
 * 三档的判定必须与筛选项同源（`officialStateOf`），放一处才不会被改成两套。
 */
import type { ReactElement } from 'react'

import { formatShellDay } from '@platform/ui/time/shellTimeFormat'

import type { CodeTableReadRow } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarCodeTableRead'
import type { PendingReason } from '../../../service/intelligence/macro-calendar/marketCalendarCodeTable'
import type { CalendarEventRow } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarEventListRead'
import { officialStateOf } from './mappingRulesFilters'

/** 码列**中段省略**，但末段留着——末段正是区分码的关键（`.YOY` 被切掉，两个码就分不出来）。 */
export function shortCode(value: string): string {
  if (value.length <= 22) return value
  return `${value.slice(0, 13)}…${value.slice(-4)}`
}

/**
 * 官网页那一格，三档：
 * - 有页是真的链接（「查看」）；
 * - 待补是纯文字（「待核」），**理由句**放 `title`——**不渲染成链接**，否则读者会以为点得开；
 * - 不建/退役是「—」，**绝不留空链接**（空链接会被读成「这个码没有官网页」）。
 *
 * `title` 里给的是**白话理由句**（「我们还没能核到机构页」/「该机构没有可长期引用的公开发布页」），
 * **不是**内部 token：读者要能分出「我们没核到」和「机构没有可引用的页」两件事。
 * 句子直接按理由取值，没有回退——漏配一个值就编译红（`Record<PendingReason, string>`）。
 *
 * 三档判定与筛选**共用 `officialStateOf`**：两处各写一遍，就会出现「列里待核、按已核能筛到」。
 */
export function officialCell(
  row: CodeTableReadRow,
  text: Readonly<{
    officialNone: string
    officialPending: string
    officialOpen: string
    officialPendingReasons: Readonly<Record<PendingReason, string>>
  }>
): ReactElement | string {
  const state = officialStateOf(row)
  if (state === 'none') return text.officialNone
  if ('pending' in row.officialSource) {
    return (
      <span data-official-pending title={text.officialPendingReasons[row.officialSource.reason]}>
        {text.officialPending}
      </span>
    )
  }
  return <a href={row.officialSource.url} target="_blank" rel="noreferrer" data-official
    title={`${row.officialSource.agency} · ${row.officialSource.basis}`}
    className="mi-catalog__url">{text.officialOpen}</a>
}

/**
 * 事件表的时间那一格：
 * - **日期精度的事件不显示时刻**：日期按 `UTC` 格式化成那个日历日（日期是日期，不是瞬时；
 *   按读者时区换算会把 10-14 变成 10-13）；
 * - 有时刻的才按读者时区显示到分钟。
 */
export function eventTimeCell(
  row: CalendarEventRow,
  formatTime: (value: string, precision: 'minute') => string
): string {
  return row.scheduledAt === null
    ? (formatShellDay(`${row.scheduledDate}T00:00:00.000Z`, 'UTC') ?? row.scheduledDate)
    : formatTime(row.scheduledAt, 'minute')
}