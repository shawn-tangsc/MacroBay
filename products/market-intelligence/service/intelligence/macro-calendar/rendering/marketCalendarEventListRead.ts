import type { DatabaseSync } from 'node:sqlite'

import { marketCalendarCountryNames } from '../marketCalendarDisplayNameTables'

/**
 * **仅渲染层，只读**：事件清单（用户 2026-11-18：「所有经济事件、央行活动，给我单独一个 tab」）。
 *
 * 一行 = **一场**事件（不是一类、不是一个身份）：日期就是它发生的那天，**没有统计期**，
 * 所以这里不出现「缺统计期」这种原因，也不参与任何映射判定。
 *
 * 数据只来自标准表的一个筛选：`event_type in ('central-bank-activity', 'financial-event')`。
 * 为什么不从观测表或未映射表拼：那两处各有自己的截断与去重口径，拼出来的数会和日历对不上；
 * 而且 `event_type` 是写入时就知道的事实，读侧不再靠 `metric_key` 前缀猜。
 *
 * 两条边界：
 * - 空数组只表示「库里没有事件」，读失败给 `unavailable`——两者不许混；
 * - 国家名从同一张国名表取，渲染层不自己拼；**查不到就是 `null`**，界面写 `—`，不编。
 */
export type CalendarEventRow = Readonly<{
  /** 稳定键（标准表主键四段拼成）：分页、React 复用都用它，不用行号。 */
  key: string
  eventType: 'central-bank-activity' | 'financial-event'
  /** 活动日期（`YYYY-MM-DD`）：没有分钟精度时，这就是读者看到的时间。 */
  scheduledDate: string
  /** 活动时刻（ISO，UTC）：只有分钟精度时才有；没有就是 `null`，界面显示日期。 */
  scheduledAt: string | null
  countryCode: string | null
  /** 中文国名（同一张国名表）；查不到是 `null`。 */
  countryName: string | null
  /** 标题：源给的原文名；没有就是 `null`（界面写「未提供」，不编一个）。 */
  title: string | null
  titleEn: string | null
  /** 哪个源写了这条。 */
  sourceProviderId: string
  /** 发布状态（契约闭集）：界面翻成白话，不印枚举。 */
  status: string
}>

export type CalendarEventListRead = Readonly<{
  state: 'available'
  rows: readonly CalendarEventRow[]
  total: number
}> | Readonly<{ state: 'unavailable'; reasonCode: 'query-unavailable' }>

type Row = Readonly<{
  country_code: string | null
  metric_key: string
  period_key: string
  first_scheduled_date: string
  scheduled_date: string
  scheduled_at: string | null
  time_precision: string
  source_label: string | null
  source_label_en: string | null
  source_provider_id: string
  status: string
  event_type: string
}>

/** 国家码 → 中文名；`EMU` 与 `EU` 同义（与码表读口同一处口径）。 */
function countryNameOf(code: string | null): string | null {
  if (code === null || code.trim() === '') return null
  return marketCalendarCountryNames[code === 'EMU' ? 'EU' : code]?.zh ?? null
}

export function readCalendarEventList(database: DatabaseSync): CalendarEventListRead {
  try {
    const rows = database.prepare(`select country_code, metric_key, period_key, first_scheduled_date,
        scheduled_date, scheduled_at, time_precision, source_label, source_label_en,
        source_provider_id, status, event_type
      from mi_calendar_events
      where event_type in ('central-bank-activity', 'financial-event')`)
      .all() as unknown as Row[]
    const mapped: CalendarEventRow[] = rows.map((row) => Object.freeze({
      key: [row.country_code ?? '', row.metric_key, row.period_key, row.first_scheduled_date].join('|'),
      eventType: row.event_type as 'central-bank-activity' | 'financial-event',
      scheduledDate: row.scheduled_date,
      // 日期精度的事件没有时刻：此时**不给一个假时刻**（0 点会被读成「凌晨发生」）。
      scheduledAt: row.time_precision === 'minute' ? row.scheduled_at : null,
      countryCode: row.country_code,
      countryName: countryNameOf(row.country_code),
      title: row.source_label,
      titleEn: row.source_label_en,
      sourceProviderId: row.source_provider_id,
      status: row.status
    }))
    // **按活动时间倒序**：最近发生的排最前；同一时刻按稳定键，翻页不会重复或漏行。
    const sorted = mapped.sort((left, right) =>
      (right.scheduledAt ?? right.scheduledDate).localeCompare(left.scheduledAt ?? left.scheduledDate)
      || left.key.localeCompare(right.key))
    return Object.freeze({ state: 'available' as const, rows: Object.freeze(sorted), total: sorted.length })
  } catch {
    return { state: 'unavailable', reasonCode: 'query-unavailable' }
  }
}