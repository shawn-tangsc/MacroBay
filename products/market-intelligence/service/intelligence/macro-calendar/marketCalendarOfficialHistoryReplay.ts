import type { DatabaseSync } from 'node:sqlite'

import { getMacroCalendarReleaseValueMapping } from './macroCalendarReleaseValueMappingPolicy'
import { dualWriteMeasureRows } from './marketCalendarStandardDualWrite'
import { recordCalendarUnmapped } from './marketCalendarStandardTable'

/**
 * **把官方修订表的历史回放进标准表**（S1，契约 §8）。
 *
 * 为什么必须做：AI 分析与日报要统一改成只读标准表，而标准表现在只有 2026-11/12 两个月；
 * 直接切会丢掉修订表里的 2021→2027 官方历史。Agent 工具还能传任意 `month`，窗口外的月份
 * 会拿到空——「这个月没有发布」和「我们只回放了 N 年」在读者和 AI 眼里分不开，所以**不设窗口**。
 *
 * 三条边界：
 * 1. **只读修订表、只走 `dualWriteMeasureRows` 这一个写入端**（零值判据、逐字段合并、身份 upsert 都在那边）；
 * 2. **幂等**：`source_event_id` 用修订行的 `event_key`（官方写标准表时就是这么写的，逐条对得上），
 *    `parser_version` 独立，跑两遍第二遍 `inserted=0`；
 * 3. **差集可选**：`O(M) \\ S(M)` 按月给出（按 `source_event_id` 去重后比），映射不出码的进 `unmapped`
 *    并带原因，绝不静默丢行。
 */
export const officialHistoryReplayPolicy = Object.freeze({
  parserVersion: 'official-history-replay-v1',
  providerId: 'macro-calendar-official-replay'
})

type RevisionRow = Readonly<{
  event_key: string
  event_family: string
  event_name_key: string
  scheduled_date: string
  scheduled_at: string | null
  lifecycle_state: string
  actual_json: string | null
  previous_json: string | null
  consensus_json: string | null
}>

export type OfficialHistoryReplayReport = Readonly<{
  revisions: number
  written: number
  /** 映射不出指标码、也不在事件清单里的行：进工作清单，带原因。 */
  unmapped: number
  /** 每月 `O(M) \\ S(M)`：修订表该月事件 key 减去标准表已写的同 key。 */
  monthlyDiff: Readonly<Record<string, readonly string[]>>
}>

const displayOf = (json: string | null): string | undefined => {
  if (json === null || json === '') return undefined
  try {
    const parsed = JSON.parse(json) as { displayValue?: unknown }
    return typeof parsed.displayValue === 'string' ? parsed.displayValue : undefined
  } catch { return undefined }
}

/** 一条修订 → 标准行（指标行用发布映射取码；FOMC 这类没有指标码的走事件码，身份到分钟）。 */
function rowsFor(revision: RevisionRow): Record<string, unknown> | undefined {
  const mapping = getMacroCalendarReleaseValueMapping(revision.event_name_key)
  const minute = revision.scheduled_at === null ? undefined : revision.scheduled_at.slice(0, 16)
  const scheduledDate = revision.scheduled_date
  if (scheduledDate === '') return undefined
  const shared = {
    countryCode: 'USA',
    // 视图 `mi_calendar_releases` 只出 `row_kind='release'`：写成别的，分析读得到、界面读不到。
    rowKind: 'release' as const,
    scheduledDate,
    sourceEventId: revision.event_key,
    ...(revision.scheduled_at === null ? {} : { scheduledAt: revision.scheduled_at }),
    timePrecision: revision.scheduled_at === null ? 'date' as const : 'minute' as const,
    status: revision.lifecycle_state === 'released' ? 'published' as const : 'scheduled' as const,
    ...(displayOf(revision.previous_json) === undefined ? {} : { previous: displayOf(revision.previous_json)! }),
    ...(displayOf(revision.consensus_json) === undefined ? {} : { consensus: displayOf(revision.consensus_json)! }),
    ...(displayOf(revision.actual_json) === undefined ? {} : { actual: displayOf(revision.actual_json)! })
  }
  if (mapping !== undefined) {
    // 指标行：期间取源给的期次（`event_key` 里带的那一段已在修订行里定型，这里不推断）。
    const periodKey = revision.event_key.split('.').at(-1) ?? ''
    if (periodKey === '') return undefined
    return { ...shared, metricKey: mapping.metricKey, periodKey }
  }
  if (revision.event_family === 'fomc') {
    /**
     * 决议类**不能另起一套身份**：标准表里已经有 FOMC 行，用的是
     * `US.FOMC.<首发布日>` + `identity_kind='source'`（来源自己给的名字 `fomc`）。
     * 按 `evt.fomc` + 分钟写，同一场会议会出现两行（主键不同、去重也合不到一起）。
     */
    return { ...shared, metricKey: `US.FOMC.${scheduledDate}`, periodKey: scheduledDate,
      identityKind: 'source' as const, sourceLabel: revision.event_name_key }
  }
  return undefined
}

export function replayOfficialHistoryIntoStandardTable(database: DatabaseSync, input?: Readonly<{
  write?: boolean
}>): OfficialHistoryReplayReport {
  const write = input?.write ?? true
  const table = database.prepare("select 1 from sqlite_master where type = 'table' and name = 'mi_macro_calendar_revisions'").get()
  if (table === undefined) return { revisions: 0, written: 0, unmapped: 0, monthlyDiff: {} }
  // 生效行：同一 `event_key` 取最新一条（修订表是 append-only，`event_key` 是身份）。
  const revisions = database.prepare(`select event_key, event_family, event_name_key, scheduled_date, scheduled_at,
      lifecycle_state, actual_json, previous_json, consensus_json
    from mi_macro_calendar_revisions
    order by event_key, detected_at_ms asc, recorded_at asc`).all() as unknown as RevisionRow[]
  const latest = new Map<string, RevisionRow>()
  for (const revision of revisions) latest.set(revision.event_key, revision)
  const observedAt = new Date().toISOString()
  const rows: Record<string, unknown>[] = []
  let unmapped = 0
  for (const revision of latest.values()) {
    const mapped = rowsFor(revision)
    if (mapped === undefined) {
      unmapped += 1
      if (write) {
        recordCalendarUnmapped(database, { providerId: officialHistoryReplayPolicy.providerId,
          sourceKey: revision.event_key, detectedAt: observedAt,
          rawJson: JSON.stringify({ eventFamily: revision.event_family, eventNameKey: revision.event_name_key }),
          reason: 'unknown-measure' })
      }
      continue
    }
    rows.push(mapped)
  }
  const written = write && rows.length > 0
    ? dualWriteMeasureRows(database, { providerId: officialHistoryReplayPolicy.providerId,
      parserVersion: officialHistoryReplayPolicy.parserVersion, observedAt, rows: rows as never }).written
    : 0
  return { revisions: latest.size, written, unmapped, monthlyDiff: write ? measureMonthlyDiff(database) : {} }
}

/**
 * 逐月 `O(M) \ S(M)`：修订表该月的 `event_key` 减去标准表里同 `source_event_id` 的行。
 *
 * **按发布去重**（`event_key` 一次发布一个），不按标准表行数——标准表把一次发布展开成多个测度行，
 * 按行比会把「8 次发布」看成「25 条」，读的人以为覆盖过头。
 */
export function measureMonthlyDiff(database: DatabaseSync): Readonly<Record<string, readonly string[]>> {
  const missing = database.prepare(`select r.event_key as event_key, substr(r.scheduled_date, 1, 7) as month
    from mi_macro_calendar_revisions r
    where not exists (select 1 from mi_calendar_events e where e.source_event_id = r.event_key)`).all() as unknown as
    { event_key: string; month: string }[]
  const result: Record<string, string[]> = {}
  for (const row of missing) (result[row.month] ??= []).push(row.event_key)
  return result
}
