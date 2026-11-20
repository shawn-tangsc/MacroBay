import type { DatabaseSync } from 'node:sqlite'

import { getMacroCalendarReleaseValueMapping } from './macroCalendarReleaseValueMappingPolicy'
import { displayValueFromJson, valueObjectFromJson } from './marketCalendarValueEncoding'
import { calendarNumericJsonFromSourceValues } from './marketCalendarNumericParse'
import { calendarNumericUnitHintForMetricKey } from './marketCalendarNumericUnits'
import { normalizeCalendarPeriodKey, normalizeCalendarSourceEventId } from './marketCalendarPeriodKey'
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
  providerId: 'macro-calendar-official-replay',
  /**
   * 迁移标记（`mi_macro_calendar_migrations.version`）**只用于清理老库里的那一行**，
   * 不再当判据（2026-11-21）：回放是缺口型，不是一次性迁移。
   *
   * 为什么：写入端还会继续产生这种形状——启动时的官方同步只按**月份窗口**写标准表
   * （`syncOfficialStandardRows`），窗口外的历史修订只能由回放落表；而修订本身是持续到达的
   * （补排、改期、晚到的旧期）。标记在、缺口在，两边看起来都正常：真库实测有 6 条修订
   * 既不在一行上、也不在台账里，永远不会被回放。
   */
  migrationVersion: 12
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
  /** 展示串在、解析不出数值的条数（`unparsed`，方案 §3.2）：我们的问题，按轮计数。 */
  numericUnparsed: number
  /** 每月 `O(M) \\ S(M)`：修订表该月事件 key 减去标准表已写的同 key。 */
  monthlyDiff: Readonly<Record<string, readonly string[]>>
}>

// 值编码的解释只有一处（`marketCalendarValueEncoding`）：这里不再各写一份。
const displayOf = (json: string | null): string | undefined => displayValueFromJson(json)

/**
 * 一条修订 → 标准行（指标行用发布映射取码；FOMC 这类没有指标码的走事件码，身份到分钟）。
 *
 * 返回行时一并给出 `numericUnparsed`：这一行**展示串在、解析不出**的值的个数（方案 §3.2 的
 * 「我们的问题」，与「源没给值」分开）；一行三个值分别计。数值优先取修订里源的 `numericValue`，没有才解析展示串，
 * 单位按该码的量纲补（`3.7` 这种没有百分号的展示串靠它）。
 */
function rowsFor(revision: RevisionRow): Readonly<{ row: Record<string, unknown>; numericUnparsed: number }> | undefined {
  const mapping = getMacroCalendarReleaseValueMapping(revision.event_name_key)
  const hint = mapping === undefined ? undefined : calendarNumericUnitHintForMetricKey(mapping.metricKey)
  const numeric = calendarNumericJsonFromSourceValues({
    actual: valueObjectFromJson(revision.actual_json),
    previous: valueObjectFromJson(revision.previous_json),
    consensus: valueObjectFromJson(revision.consensus_json)
  }, hint === undefined ? undefined : { unit: hint })
  const scored = { numericUnparsed: numeric.unparsedFields }
  const minute = revision.scheduled_at === null ? undefined : revision.scheduled_at.slice(0, 16)
  const scheduledDate = revision.scheduled_date
  if (scheduledDate === '') return undefined
  const shared = {
    countryCode: 'USA',
    // 视图 `mi_calendar_releases` 只出 `row_kind='release'`：写成别的，分析读得到、界面读不到。
    rowKind: 'release' as const,
    // 回放也知道「这是什么」：fomc 是央行活动，其余（cpi/就业/PCE/GDP）都是经济指标。
    eventType: (revision.event_family === 'fomc' ? 'central-bank-activity' : 'economic-indicator') as
      'economic-indicator' | 'central-bank-activity',
    scheduledDate,
    // 来源 id 与期次同归一：`2026-M10` 是 BLS 内部的参考期写法，标准表只留 `2026-10` 这一种。
    sourceEventId: normalizeCalendarSourceEventId(revision.event_key),
    // 数值列：源给的数优先、没有才解析展示串（`numeric` 见上）。
    numericJson: numeric.json,
    ...(revision.scheduled_at === null ? {} : { scheduledAt: revision.scheduled_at }),
    timePrecision: revision.scheduled_at === null ? 'date' as const : 'minute' as const,
    status: revision.lifecycle_state === 'released' ? 'published' as const : 'scheduled' as const,
    ...(displayOf(revision.previous_json) === undefined ? {} : { previous: displayOf(revision.previous_json)! }),
    ...(displayOf(revision.consensus_json) === undefined ? {} : { consensus: displayOf(revision.consensus_json)! }),
    ...(displayOf(revision.actual_json) === undefined ? {} : { actual: displayOf(revision.actual_json)! })
  }
  if (mapping !== undefined) {
    // 指标行：期间取源给的期次，**但按 `YYYY-MM` 归一**（来源原样是 `2026-M10`）。
    // 不归一，同一期会在标准表里落成两行，补值那行永远问不到 FRED 的值。
    const rawPeriod = revision.event_key.split('.').at(-1) ?? ''
    if (rawPeriod === '') return undefined
    const periodKey = normalizeCalendarPeriodKey(rawPeriod)
    return { row: { ...shared, metricKey: mapping.metricKey, periodKey }, ...scored }
  }
  if (revision.event_family === 'fomc') {
    /**
     * 决议类**不能另起一套身份**：标准表里已经有 FOMC 行，用的是
     * `US.FOMC.<首发布日>` + `identity_kind='source'`（来源自己给的名字 `fomc`）。
     * 按 `evt.fomc` + 分钟写，同一场会议会出现两行（主键不同、去重也合不到一起）。
     */
    return { row: { ...shared, metricKey: `US.FOMC.${scheduledDate}`, periodKey: scheduledDate,
      identityKind: 'source' as const, sourceLabel: revision.event_name_key }, ...scored }
  }
  return undefined
}

export function replayOfficialHistoryIntoStandardTable(database: DatabaseSync, input?: Readonly<{
  write?: boolean
}>): OfficialHistoryReplayReport {
  const write = input?.write ?? true
  const table = database.prepare("select 1 from sqlite_master where type = 'table' and name = 'mi_macro_calendar_revisions'").get()
  if (table === undefined) return { revisions: 0, written: 0, unmapped: 0, numericUnparsed: 0, monthlyDiff: {} }
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
  let numericUnparsed = 0
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
    numericUnparsed += mapped.numericUnparsed
    rows.push(mapped.row)
  }
  const written = write && rows.length > 0
    ? dualWriteMeasureRows(database, { providerId: officialHistoryReplayPolicy.providerId,
      parserVersion: officialHistoryReplayPolicy.parserVersion, observedAt, rows: rows as never }).written
    : 0
  return { revisions: latest.size, written, unmapped, numericUnparsed,
    monthlyDiff: write ? measureMonthlyDiff(database) : {} }
}

/**
 * 标准表里「这条发布已经落下来了」的 id 集合：行上的当前 id + 台账里记过的 id。
 *
 * 为什么必须带上台账：一行只能存一个 id，同一次发布被别的来源后写覆盖后，原 id 只留在台账里。
 * 只认行上的 id，同一件事会被差集报成「丢了一条」。
 *
 * **两边都归一后再比**（2026-11-21）：官方同步写的是来源原样的 `…2026-M10`，回放写的是
 * `…2026-10`，同一个发布两种写法。只归一一边，同一件事会被差集报成「丢了一条」——
 * 那正是「标记在、缺口在」里被当成新缺口的那批。
 */
function knownSourceIds(database: DatabaseSync): Set<string> {
  const known = new Set<string>()
  const add = (value: string): void => { known.add(normalizeCalendarSourceEventId(value)) }
  for (const row of database.prepare('select source_event_id from mi_calendar_events').all() as unknown as
    { source_event_id: string }[]) add(row.source_event_id)
  const ledgerTable = database.prepare("select 1 from sqlite_master where type = 'table' and name = 'mi_calendar_event_source_ids'").get()
  if (ledgerTable !== undefined) {
    for (const row of database.prepare('select source_event_id from mi_calendar_event_source_ids').all() as unknown as
      { source_event_id: string }[]) add(row.source_event_id)
  }
  return known
}

/** 修订表里「能落表、但标准表还没有」的发布——启动闸用的就是这个差集，不是版本标记。 */
export function pendingOfficialHistoryRevisions(database: DatabaseSync): readonly string[] {
  const table = database.prepare("select 1 from sqlite_master where type = 'table' and name = 'mi_macro_calendar_revisions'").get()
  if (table === undefined) return []
  const revisions = database.prepare(`select event_key, event_family, event_name_key, scheduled_date, scheduled_at,
      lifecycle_state, actual_json, previous_json, consensus_json
    from mi_macro_calendar_revisions
    order by event_key, detected_at_ms asc, recorded_at asc`).all() as unknown as RevisionRow[]
  const latest = new Map<string, RevisionRow>()
  for (const revision of revisions) latest.set(revision.event_key, revision)
  const known = knownSourceIds(database)
  const pending: string[] = []
  for (const revision of latest.values()) {
    // 映射不出码的按设计进 `unmapped`、不进标准表——**不算缺口**，否则回放每次启动都会重跑。
    const built = rowsFor(revision)
    if (built === undefined) continue
    if (known.has(normalizeCalendarSourceEventId(String(built.row.sourceEventId)))) continue
    pending.push(revision.event_key)
  }
  return pending
}

/**
 * 逐月 `O(M) \ S(M)`：修订表该月的 `event_key` 减去标准表里同 `source_event_id` 的行。
 *
 * **按发布去重**（`event_key` 一次发布一个），不按标准表行数——标准表把一次发布展开成多个测度行，
 * 按行比会把「8 次发布」看成「25 条」，读的人以为覆盖过头。
 */
export function measureMonthlyDiff(database: DatabaseSync): Readonly<Record<string, readonly string[]>> {
  // 两边都按期次归一后比：行里存的是 `US.CPI.NSA.YOY.RELEASE.2026-10`（标准表只留一种写法），
  // 修订表里还是来源原样的 `…2026-M10`。只归一一边，同一件事会被差集报成「丢了一条」。
  const revisions = database.prepare(`select event_key as event_key, substr(scheduled_date, 1, 7) as month
    from mi_macro_calendar_revisions`).all() as unknown as { event_key: string; month: string }[]
  const known = knownSourceIds(database)
  const result: Record<string, string[]> = {}
  for (const row of revisions) {
    if (known.has(normalizeCalendarSourceEventId(row.event_key))) continue
    ;(result[row.month] ??= []).push(row.event_key)
  }
  return result
}

/**
 * 启动时调用：**判据是差集**——还有「能落表、但表里没有」的发布就回放一次。
 *
 * 不做成版本标记（团队规范「Backfills: Gap Or Marker, Never Both」）：官方同步只写月份窗口内的
 * 修订，窗口外的历史修订只能靠回放；而修订是持续到达的（补排、改期、晚到的旧期）。真库实测
 * 有 6 条修订既不在行上、也不在台账里——标记挡着永远不会补。改成差集后：没有缺口就只做一次
 * 轻量比对，有缺口就补，补完下一轮自然为 0。
 *
 * 返回是否真的跑了回放。
 */
export function ensureOfficialHistoryReplayed(database: DatabaseSync, input?: Readonly<{ write?: boolean }>): boolean {
  const write = input?.write ?? true
  let pending: readonly string[]
  try {
    // 老库里的标记行同笔清掉：留着会让下一个人以为这条还受版本闸控制。
    if (database.prepare("select 1 from sqlite_master where type = 'table' and name = 'mi_macro_calendar_migrations'").get() !== undefined) {
      database.prepare('delete from mi_macro_calendar_migrations where version = ?')
        .run(officialHistoryReplayPolicy.migrationVersion)
    }
    pending = pendingOfficialHistoryRevisions(database)
  } catch { return false }
  if (pending.length === 0) return false
  if (!write) return true
  database.exec('begin')
  try {
    replayOfficialHistoryIntoStandardTable(database)
    database.exec('commit')
    return true
  } catch (error) {
    try { database.exec('rollback') } catch { /* 保留原始错误 */ }
    throw error
  }
}
