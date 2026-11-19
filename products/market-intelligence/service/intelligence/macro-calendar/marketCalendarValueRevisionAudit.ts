import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

import { calendarStandardTablePolicy } from './marketCalendarStandardTable'

/**
 * **来源审计：值修订表**（用户 2026-11-19，31 号文档 §3）。
 *
 * 回答「谁在什么时候把这一格从 A 改成 B，或者拒绝改」。边界：
 * - **审计不是值**：它不决定任何一格显示什么，也不进任何取值链；
 * - **没变化不写**：`value_before === value_after` 且 `decision='write'` 不落行（否则全量重写会把表写爆）；
 * - **拒绝覆盖要写**：`keep:*` 是最需要证据的决定——「为什么这一格没变」比「它变了」更难查。
 *
 * `decision` 是闭集，且**永远不许出现优先级语义**（来源同权后谁后到谁写是唯一规则）。
 */
export const calendarValueRevisionPolicy = Object.freeze({
  table: 'mi_calendar_value_revisions',
  decisions: Object.freeze(['write', 'keep:absent-in-source', 'keep:placeholder-zero',
    'keep:zero-does-not-overwrite'] as const)
})

export type CalendarMergeDecision = typeof calendarValueRevisionPolicy.decisions[number]
export type CalendarValueField = 'actual' | 'previous' | 'consensus'

export type CalendarValueRevisionInput = Readonly<{
  countryCode: string; metricKey: string; periodKey: string; firstScheduledDate: string
  field: CalendarValueField; valueBefore: string | null; valueAfter: string | null
  decision: CalendarMergeDecision; providerId: string; sourceEventId: string; parserVersion: string
  observedAt: string; incomingHash: string; rawRecordId?: string
}>

export function ensureCalendarValueRevisionTable(database: DatabaseSync): void {
  database.exec(`create table if not exists ${calendarValueRevisionPolicy.table} (
    country_code text not null, metric_key text not null, period_key text not null,
    first_scheduled_date text not null, field text not null,
    value_before text, value_after text, decision text not null,
    provider_id text not null, source_event_id text not null, parser_version text not null,
    observed_at text not null, incoming_hash text not null, raw_record_id text,
    primary key(country_code, metric_key, period_key, first_scheduled_date, field, observed_at, provider_id))`)
}

/** 本次 incoming values 的 sha256（键排序后序列化）：重放时能一眼认出「同一笔」。 */
export function hashIncomingValues(values: Readonly<Record<string, string | undefined>>): string {
  const canonical = Object.keys(values).sort().map((key) => [key, values[key] ?? null])
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

/** 写一行审计；**`write` 且值没变直接返回 false，不碰表**。 */
export function recordCalendarValueRevision(database: DatabaseSync, input: CalendarValueRevisionInput): boolean {
  if (input.decision === 'write' && input.valueBefore === input.valueAfter) return false
  ensureCalendarValueRevisionTable(database)
  database.prepare(`insert or ignore into ${calendarValueRevisionPolicy.table}
    (country_code, metric_key, period_key, first_scheduled_date, field, value_before, value_after, decision,
     provider_id, source_event_id, parser_version, observed_at, incoming_hash, raw_record_id)
    values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    input.countryCode, input.metricKey, input.periodKey, input.firstScheduledDate, input.field,
    input.valueBefore, input.valueAfter, input.decision, input.providerId, input.sourceEventId,
    input.parserVersion, input.observedAt, input.incomingHash, input.rawRecordId ?? null)
  return true
}

/**
 * 详情并列行的读数：**只服务「来源 / 更新于」，不参与取值**。
 * 「更新于」只取 `decision='write'` 的最后一行——`keep:*` 是拒绝覆盖的证据，值并没有更新。
 */
export function readCalendarValueRevisions(
  database: DatabaseSync,
  key: Readonly<{ countryCode: string; metricKey: string; periodKey: string; firstScheduledDate: string }>
): Readonly<{
  state: 'recorded' | 'not-recorded' | 'unreadable'
  /** 按字段分组的并列条目（同 field 的多次变更按时间倒序）。 */
  byField: Readonly<Partial<Record<CalendarValueField, readonly Readonly<{ valueBefore: string | null
    valueAfter: string | null; decision: CalendarMergeDecision; providerId: string; observedAt: string }>[]>>>
  revisions: readonly Readonly<{ field: string; valueBefore: string | null; valueAfter: string | null
    decision: CalendarMergeDecision; providerId: string; observedAt: string }>[]
  updatedAt: string | null
  latestWriteProviderId: string | null
  /** `state='unreadable'` 时的原因（读库失败 ≠ 没有记录）。 */
  reason?: string
}> {
  /**
   * **「没有审计记录」与「读不到」必须分开**（用户 2026-11-20）：前者是历史期次（显示「未记录」），
   * 后者是错误态（带重试），两者都返回空数组就是把读失败画成「没有」。
   */
  let rows: Array<{ field: string; value_before: string | null; value_after: string | null
    decision: CalendarMergeDecision; provider_id: string; observed_at: string }>
  try {
    const exists = database.prepare(`select 1 from sqlite_master where type='table' and name=?`)
      .get(calendarValueRevisionPolicy.table)
    if (exists === undefined) {
      return { state: 'not-recorded', byField: {}, revisions: [], updatedAt: null, latestWriteProviderId: null }
    }
    rows = database.prepare(`select field, value_before, value_after, decision, provider_id, observed_at
      from ${calendarValueRevisionPolicy.table}
      where country_code=? and metric_key=? and period_key=? and first_scheduled_date=?
      order by observed_at desc`).all(key.countryCode, key.metricKey, key.periodKey, key.firstScheduledDate) as typeof rows
  } catch (error) {
    return { state: 'unreadable', byField: {}, revisions: [], updatedAt: null, latestWriteProviderId: null,
      reason: (error as Error)?.message ?? 'unknown' }
  }
  if (rows.length === 0) {
    return { state: 'not-recorded', byField: {}, revisions: [], updatedAt: null, latestWriteProviderId: null }
  }
  const byField: Partial<Record<CalendarValueField, Array<{ valueBefore: string | null; valueAfter: string | null
    decision: CalendarMergeDecision; providerId: string; observedAt: string }>>> = {}
  for (const row of rows) {
    const entry = { valueBefore: row.value_before, valueAfter: row.value_after, decision: row.decision,
      providerId: row.provider_id, observedAt: row.observed_at }
    ;(byField[row.field as CalendarValueField] ??= []).push(entry)
  }
  const latestWrite = rows.find((row) => row.decision === 'write')
  return {
    state: 'recorded',
    byField,
    revisions: rows.map((row) => ({ field: row.field, valueBefore: row.value_before, valueAfter: row.value_after,
      decision: row.decision, providerId: row.provider_id, observedAt: row.observed_at })),
    updatedAt: latestWrite?.observed_at ?? null,
    latestWriteProviderId: latestWrite?.provider_id ?? null
  }
}

/** 盘点第 7 项（用户 2026-11-20）：这张表随每次改值增长，**必须可见**——条数 + 最近一条时刻。 */
export function inspectCalendarValueRevisions(database: DatabaseSync): Readonly<{
  rows: number; latestObservedAt: string | null
}> {
  try {
    const exists = database.prepare(`select 1 from sqlite_master where type='table' and name=?`)
      .get(calendarValueRevisionPolicy.table)
    if (exists === undefined) return { rows: 0, latestObservedAt: null }
    const row = database.prepare(`select count(*) as n, max(observed_at) as latest
      from ${calendarValueRevisionPolicy.table}`).get() as { n: number; latest: string | null }
    return { rows: Number(row.n), latestObservedAt: row.latest }
  } catch { return { rows: 0, latestObservedAt: null } }
}

/** 一致性守卫：每格最新一条 `write` 的 `value_after` 必须等于当前 `values_json` 该字段。 */
export function calendarValueRevisionMismatches(database: DatabaseSync): number {
  const table = calendarStandardTablePolicy.eventsTable
  const exists = database.prepare(`select 1 from sqlite_master where type='table' and name=?`)
    .get(calendarValueRevisionPolicy.table)
  if (exists === undefined) return 0
  /**
   * **两套断言，分开判**（用户 2026-11-20，Chief 钉死）：
   * - `decision='write'` → `value_after` 必须等于当前 `values_json` 那格；
   * - `keep:*` → `value_after IS NULL`，且**当前值仍等于被保住的旧值**（这才是「拒绝覆盖」的证据）。
   * 写成一条全量断言会在每条 keep 上都报红，然后必然有人把守卫放宽成永远通过。
   */
  const rows = database.prepare(`select a.field, a.value_before, a.value_after, a.decision, e.values_json
    from ${calendarValueRevisionPolicy.table} a
    join ${table} e on e.country_code=a.country_code and e.metric_key=a.metric_key
      and e.period_key=a.period_key and e.first_scheduled_date=a.first_scheduled_date
    where a.observed_at = (select max(b.observed_at) from ${calendarValueRevisionPolicy.table} b
        where b.country_code=a.country_code and b.metric_key=a.metric_key and b.period_key=a.period_key
          and b.first_scheduled_date=a.first_scheduled_date and b.field=a.field)`).all() as
    Array<{ field: string; value_before: string | null; value_after: string | null
      decision: CalendarMergeDecision; values_json: string }>
  let mismatched = 0
  for (const row of rows) {
    let current: string | null
    try {
      const values = JSON.parse(row.values_json) as Record<string, unknown>
      current = values[row.field] === undefined || values[row.field] === null ? null : String(values[row.field])
    } catch { mismatched += 1; continue }
    if (row.decision === 'write') { if (current !== row.value_after) mismatched += 1 }
    else if (row.value_after !== null || current !== row.value_before) mismatched += 1
  }
  return mismatched
}
