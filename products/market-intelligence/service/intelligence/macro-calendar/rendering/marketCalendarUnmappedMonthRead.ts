import type { DatabaseSync } from 'node:sqlite'

import type { MarketCalendarEvent } from '../../../../contracts/macro/marketCalendarQueryContracts'
import type { CalendarUnmappedReason } from '../marketCalendarStandardTable'
import { groupUnmappedByRelease, mergedReasonOf } from '../marketCalendarUnmappedGrouping'

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
  /**
   * 事件条数（**不进未映射列表**，单独走事件页）：讲话/纪要/央行活动不是指标。
   *
   * 事件的行**不在这里返回**：事件读口只有一处，见 `readCalendarEventList`（`marketCalendarEventListRead`）。
   * 一处事实一处定义——再写第二个事件读口，两个数迟早对不上。
   */
  events: number
  /** 已认出码、缺统计期的条数（不进列表）：映射那一半已完成。 */
  periodUnresolved: number
  /** 没码且单国单次出现的条数（不进列表）：去处是「未建码」。 */
  noCode: number
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
/** 源内 id：`["<id>",<序号>]` 取第一段；不是数组（测试或旧数据）就用整串，不抛。 */
function sourceIdOf(sourceKey: string): string {
  try {
    const parsed: unknown = JSON.parse(sourceKey)
    if (Array.isArray(parsed) && parsed.length > 0) return String(parsed[0])
  } catch {
    // 不是 JSON 就当整串是 id
  }
  return sourceKey
}

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
  // **一条都不许藏**（用户 2026-11-18）：这个页签就是「所有没进日历的东西」，四类全列，
  // 原因用列区分、可筛选；下面这几个计数只用于诊断参考（谁多谁少一眼看得出）。
  let noStandardRow = 0
  let events = 0
  let noCode = 0
  let periodUnresolved = 0
  let undated = 0
  let superseded = 0
  const promoted = database.prepare('select 1 from mi_calendar_events where source_event_id = ? limit 1')
  for (const row of rows) {
    const key = `${row.provider_id}:${row.source_key}`
    if (seen.has(key)) continue
    seen.add(key)
    if (promoted.get(row.source_key) !== undefined) { superseded += 1; continue }
    // **一条都不许藏**（用户 2026-11-18）：没进日历的东西全部列出来，原因用列区分；
    // 计数照旧统计，供诊断参考。
    if (row.reason === 'no-standard-row') noStandardRow += 1
    // **事件单独一页**（用户 2026-11-18）：判据只看源自己的 `eventKind`（不是标题字面），
    // 事件不参与映射，所以从「未映射」里分出去，进事件页只读展示。
    if (row.reason === 'unknown-event-type') events += 1
    if (row.reason === 'no-code') noCode += 1
    // `bad-period` 是这一档的旧库写法（重算跑过才会变成 `period-unresolved`），两写法同一计数。
    if (row.reason === 'period-unresolved' || row.reason === 'bad-period') periodUnresolved += 1
    const raw = parseRaw(row.raw_json)
    const scheduledDate = text(raw.scheduledDate)
    if (scheduledDate === undefined) { undated += 1; continue }
    if (!scheduledDate.startsWith(input.month)) continue
    const scheduledAt = text(raw.scheduledAt)
    const eventKind = text(raw.eventKind)
    const entry = Object.freeze({
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
    })
    // 事件不进映射列表（它们有自己的页），也不在这里返回行——事件读口只一处。
    if (row.reason !== 'unknown-event-type') entries.push(entry)
  }
  // **一场发布一行**（Chief 2026-11-18）：中英两条只作标签、原因只写一条。合并逻辑只有一份
  // （`marketCalendarUnmappedGrouping`），弹框列表、页签计数、导出都从同一个函数取。
  const grouped = groupUnmappedByRelease(entries.map((entry) => ({
    ...entry,
    sourceId: sourceIdOf(entry.sourceKey),
    hasStandardRow: promoted.get(entry.sourceKey) !== undefined,
  })))
  const merged = grouped.map((group) => {
    const first = group[0]!
    const titles = [...new Set(group.map((item) => item.title))]
    return Object.freeze({
      ...first,
      title: titles.join(' · '),
      // 只有「中英两条并成一条」时才重定原因；单条保持它自己真实的原因（别把 no-code 改写成别的）。
      reason: (group.length > 1 ? mergedReasonOf(group) : first.reason) as CalendarUnmappedReason,
    })
  })
  return Object.freeze({
    entries: Object.freeze(merged), undated, superseded, noStandardRow, events, noCode, periodUnresolved
  })
}
