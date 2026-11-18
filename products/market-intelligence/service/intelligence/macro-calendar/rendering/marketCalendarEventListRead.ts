import type { DatabaseSync } from 'node:sqlite'

import { marketCalendarCountryNames } from '../marketCalendarDisplayNameTables'
import { groupKeyOf, groupUnmappedByRelease } from '../marketCalendarUnmappedGrouping'
import { sourceIdOfSourceKey } from './marketCalendarMappingRulesRead'

/**
 * **仅渲染层，只读**：事件清单（用户 2026-11-18：「所有经济事件、央行活动，给我单独一个 tab」）。
 *
 * 一行 = **一场**活动（`源内 id + scheduledAt` 分组），不是一条记录：源对同一场活动发中英文两条，
 * 库里就是两条未映射记录，界面必须是一件。用户 2026-11-18 把口径定成**按件**：
 * 未映射界面 = 指标类 **168 件** + 事件 **207 件** = **375 件**。
 *
 * 三条边界：
 * - **分组只走一份实现**（`groupUnmappedByRelease`）：这里再写一遍分组，就会出现
 *   「抽屉 207、弹框 236」这种同一件事两个数；
 * - **事件不是指标**：没有统计期、不参与映射，所以这一页没有原因列，也不出现「缺统计期」；
 * - 国家与状态分别取自源观测表与标准行（`source_event_id` 对得上就取），查不到是 `null`，
 *   界面写 `—` / 「无法确认」，不编。
 */
export type CalendarEventRow = Readonly<{
  /** 分组键（`源内 id|scheduledAt`，或日期 + 标题兜底）：React 复用与翻页都用它，不用行号。 */
  key: string
  eventType: 'central-bank-activity' | 'financial-event'
  /** 活动日期（`YYYY-MM-DD`）：没有分钟精度时，这就是读者看到的时间。 */
  scheduledDate: string
  /** 活动时刻（ISO，UTC）：源给了才显示；没给就是 `null`，界面只显示日期，不补一个假时刻。 */
  scheduledAt: string | null
  countryCode: string | null
  /** 中文国名（同一张国名表）；查不到是 `null`。 */
  countryName: string | null
  /** 标题：源给的原文名（中英并列，去重）；没有就是 `null`（界面写「源未提供标题」）。 */
  title: string | null
  titleEn: string | null
  /** 哪个源写了这条。 */
  sourceProviderId: string
  /** 发布状态（契约闭集）；标准行取不到时是 `null`，界面写「无法确认」。 */
  status: string | null
}>

export type CalendarEventListRead = Readonly<{
  state: 'available'
  rows: readonly CalendarEventRow[]
  total: number
}> | Readonly<{ state: 'unavailable'; reasonCode: 'query-unavailable' }>

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

type RawRow = Readonly<{ provider_id: string; source_key: string; reason: string; raw_json: string }>

type Groupable = Readonly<{
  sourceId: string
  scheduledAt?: string
  scheduledDate: string
  title: string
  reason: string
  hasStandardRow: boolean
  providerId: string
  eventType: 'central-bank-activity' | 'financial-event'
  titleEn: string | null
  status: string | null
  countryCode: string | null
}>

/** 国家码 → 中文名；`EMU` 与 `EU` 同义（与码表读口同一处口径）。 */
function countryNameOf(code: string | null): string | null {
  if (code === null) return null
  return marketCalendarCountryNames[code === 'EMU' ? 'EU' : code]?.zh ?? null
}

export function readCalendarEventList(database: DatabaseSync): CalendarEventListRead {
  try {
    const rows = database.prepare(`select provider_id, source_key, reason, raw_json
      from mi_calendar_unmapped where reason = 'unknown-event-type'`).all() as unknown as RawRow[]
    // 状态与国家都从**标准行**取：那是我们已经落下来的事实，一处来源；
    // 源观测表只回答「源见过什么」，两个来源混着取会给出两个国家。
    const standardOf = database.prepare(
      'select status, country_code from mi_calendar_events where source_event_id = ? limit 1')
    const entries: Groupable[] = []
    for (const row of rows) {
      const sourceId = sourceIdOfSourceKey(row.source_key)
      if (sourceId === undefined) continue
      let raw: Record<string, unknown> = {}
      try {
        const parsed: unknown = JSON.parse(row.raw_json)
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>
      } catch { /* 坏 JSON 只丢字段，不丢这一件 */ }
      const kind = text(raw.eventKind)
      // 只认两种事件：认不出就不进这一页（它在未映射里按自己的原因现身，不会被藏掉）。
      if (kind !== 'central-bank-activity' && kind !== 'financial-event') continue
      const scheduledAt = text(raw.scheduledAt)
      const standard = standardOf.get(row.source_key) as { status: string; country_code: string | null } | undefined
      entries.push({
        sourceId,
        ...(scheduledAt === null ? {} : { scheduledAt }),
        scheduledDate: text(raw.scheduledDate) ?? '',
        title: text(raw.name) ?? '',
        reason: row.reason,
        hasStandardRow: standard !== undefined,
        providerId: row.provider_id,
        eventType: kind,
        titleEn: text(raw.nameEn),
        status: standard?.status ?? null,
        countryCode: standard?.country_code ?? null
      })
    }
    /** **一场活动一件**：分组只走 `groupUnmappedByRelease`，与指标类同一份实现、同一套键。 */
    const merged: CalendarEventRow[] = groupUnmappedByRelease(entries).map((group) => {
      const first = group[0]!
      const titles = [...new Set(group.map((item) => item.title).filter((value) => value !== ''))]
      const titlesEn = [...new Set(group.map((item) => item.titleEn)
        .filter((value): value is string => value !== null))]
      const pick = <T>(values: readonly (T | null)[]): T | null => values.find((value) => value !== null) ?? null
      const countryCode = pick(group.map((item) => item.countryCode))
      return Object.freeze({
        key: groupKeyOf(first),
        eventType: first.eventType,
        scheduledDate: first.scheduledDate,
        scheduledAt: pick(group.map((item) => item.scheduledAt ?? null)),
        countryCode,
        countryName: countryNameOf(countryCode),
        title: titles.length === 0 ? null : titles.join(' · '),
        titleEn: titlesEn.length === 0 ? null : titlesEn.join(' · '),
        sourceProviderId: first.providerId,
        status: pick(group.map((item) => item.status))
      })
    })
    // **按活动时间倒序**：最近发生的排最前；同一时刻按分组键，翻页不会重复或漏行。
    const sorted = merged.sort((left, right) =>
      (right.scheduledAt ?? right.scheduledDate).localeCompare(left.scheduledAt ?? left.scheduledDate)
      || left.key.localeCompare(right.key))
    return Object.freeze({ state: 'available' as const, rows: Object.freeze(sorted), total: sorted.length })
  } catch {
    return { state: 'unavailable', reasonCode: 'query-unavailable' }
  }
}