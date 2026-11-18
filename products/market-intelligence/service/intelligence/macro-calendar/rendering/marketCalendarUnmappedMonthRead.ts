import type { DatabaseSync } from 'node:sqlite'

import type { MarketCalendarEvent } from '../../../../contracts/macro/marketCalendarQueryContracts'
import type { CalendarUnmappedReason } from '../marketCalendarStandardTable'

/**
 * **仅渲染层**：某一月里「进不了标准表」的观测（用户 2026-11-16 拍板）。
 *
 * 第一行就写死边界（用户原话：「非标准表的数据只在日历组件里显示，不会被简报生成、也不会进 AI 分析」）：
 * - **只给日历渲染用**。不挂在 `publicQueryService` 上、不进 `marketAnalysisContextQuery`、
 *   不进 `dailyBriefingSource` 依赖——挂到通用服务上，将来一定有人顺手拿去分析；
 * - 它是**只读派生**：不写标准表、不产生第二份状态；
 * - 同一条观测**后来进了标准表就必须从这里消失**（否则读者看到同一件事两遍）——判据落到
 *   `source_event_id`：标准表里已有同 id 的行，就不返回这条。
 *
 * 字段口径（`src` 原样、不猜）：
 * - 时间：源给了时刻就用时刻，只有日期就给日期并标 `date`，**两样都没有就不编**（这条进 `undated` 计数）；
 * - 标题：源原话（`display_name`），没有就退回稳定键，再没有就不返回空标题；
 * - 国家：**原值**（`US` 就 `US`、`USA` 就 `USA`），映射成中文名是渲染层的事；
 * - 事件类型：认得出给三类之一，认不出给 `unknown`；
 * - 原因：沿用 `mi_calendar_unmapped` 的原因闭集。
 */
export type UnmappedCalendarObservation = Readonly<{
  /** 稳定键（`provider:source_key`）：渲染 key 与去重都用它，不许用自增 id。 */
  key: string
  providerId: string
  sourceKey: string
  reason: CalendarUnmappedReason
  /** 源给的发布日（没有就返回不了这一条——月视图按日排，缺日期无处可放）。 */
  scheduledDate: string
  /** 源给了时刻才有；没有就**不编**。 */
  scheduledAt?: string
  timePrecision: 'minute' | 'date'
  title: string
  /** **原值**，不做 alpha-2/alpha-3 归一，也不映射成名字。 */
  countryCode?: string
  eventType: MarketCalendarEvent['eventType'] | 'unknown'
  detectedAt: string
}>

export type UnmappedCalendarMonthRead = Readonly<{
  entries: readonly UnmappedCalendarObservation[]
  /** 缺日期、进不了月视图的未映射行（**不能悄悄丢**：给出条数，让守恒式能解释）。 */
  undated: number
  /** 已被标准表接管的未映射行（同 `source_event_id` 已有标准行）：不计入也未丢弃，单独报数。 */
  superseded: number
  /** 没有标准行的条数（不进列表，只作诊断）：它们不在等映射，也没有行可挂映射。 */
  noStandardRow: number
  /** 事件条数（不进列表，只作诊断）：讲话/纪要/央行活动不是指标，不该混在「未映射指标」里。 */
  events: number
}>

type UnmappedRow = Readonly<{
  provider_id: string
  source_key: string
  detected_at: string
  raw_json: string
  reason: string
}>

const eventTypes: readonly string[] = ['economic-indicator', 'financial-event', 'central-bank-activity']

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

function parseRaw(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch { return {} }
}

/** 月视图的一行：`month` 是 `YYYY-MM`。日期按 `raw_json.scheduledDate` 取（源里的原值）。 */
export function listUnmappedCalendarObservationsForRendering(
  database: DatabaseSync,
  input: Readonly<{ month: string }>
): UnmappedCalendarMonthRead {
  const rows = database.prepare(`select provider_id, source_key, detected_at, raw_json, reason
    from mi_calendar_unmapped order by detected_at asc`)
    .all() as unknown as UnmappedRow[]
  // 同一个 source_key 可能因不同原因出现多次（身份坏 + 缺国家）：**一条观测只展示一行**，
  // 取最早那次的原因（那是「第一次没进去」的事实）。
  const seen = new Set<string>()
  const entries: UnmappedCalendarObservation[] = []
  // **没有标准行的不进这个列表**（2026-11-18 Chief 定）：它们不在等映射，也没有行可挂映射；
  // 混在「未映射」里会让这个数永远压不下去，读者会以为还有几百个指标没认出来。只计数，供诊断。
  let noStandardRow = 0
  let events = 0
  let undated = 0
  let superseded = 0
  const promoted = database.prepare('select 1 from mi_calendar_events where source_event_id = ? limit 1')
  for (const row of rows) {
    const key = `${row.provider_id}:${row.source_key}`
    if (seen.has(key)) continue
    seen.add(key)
    if (promoted.get(row.source_key) !== undefined) { superseded += 1; continue }
    if (row.reason === 'no-standard-row') { noStandardRow += 1; continue }
    // 事件不是指标：留在页签里会让读者以为还有两百多个指标没认出来（2026-11-18 Chief 定）。
    if (row.reason === 'unknown-event-type') { events += 1; continue }
    const raw = parseRaw(row.raw_json)
    const scheduledDate = text(raw.scheduledDate)
    if (scheduledDate === undefined) { undated += 1; continue }
    if (!scheduledDate.startsWith(input.month)) continue
    const scheduledAt = text(raw.scheduledAt)
    const eventKind = text(raw.eventKind)
    entries.push(Object.freeze({
      key,
      providerId: row.provider_id,
      sourceKey: row.source_key,
      reason: row.reason as CalendarUnmappedReason,
      scheduledDate,
      ...(scheduledAt === undefined ? {} : { scheduledAt }),
      timePrecision: scheduledAt === undefined ? 'date' as const : 'minute' as const,
      // 标题：源原话 → 稳定键。都不行也不返回空标题（空标题在列表里就是「看不见的一行」）。
      title: text(raw.name) ?? text(raw.metricKey) ?? row.source_key,
      ...(text(raw.countryCode ?? raw.country_code) === undefined
        ? {} : { countryCode: text(raw.countryCode ?? raw.country_code)! }),
      eventType: eventKind !== undefined && eventTypes.includes(eventKind)
        ? eventKind as MarketCalendarEvent['eventType'] : 'unknown' as const,
      detectedAt: row.detected_at
    }))
  }
  return Object.freeze({ entries: Object.freeze(entries), undated, superseded, noStandardRow, events })
}
