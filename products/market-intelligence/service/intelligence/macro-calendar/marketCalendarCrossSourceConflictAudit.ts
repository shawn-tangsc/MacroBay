import type { DatabaseSync } from 'node:sqlite'

import { calendarStandardTablePolicy } from './marketCalendarStandardTable'
import {
  calendarValueRevisionPolicy, crossSourceConflictDecision, ensureCalendarValueRevisionTable,
  hashIncomingValues, recordCalendarValueRevision, type CalendarValueField
} from './marketCalendarValueRevisionAudit'

/**
 * **跨源数值冲突审计**（Chief 2026-11-21，0.4.5 #18）。
 *
 * 现状：同一期里两家给出不同的 `actual`（失业率 2026-09 的 4.1 / 4.2），
 * 两条行都留着，但**谁也不指认谁**，也没有一条记录说明「哪两家、哪一期、各是什么值」——
 * 出了矛盾只能靠人翻库。
 *
 * 口径（产品经理定，三条都不许改）：
 * 1. **冲突标记进修订表**：不另起一张冲突表，与改值/拒绝覆盖共用 `mi_calendar_value_revisions`；
 * 2. **来源可靠性只存派生计数**：库里不落任何可靠性分数或排名，次数由这张表当场算；
 * 3. **同源两行不互指**：同一家的二读/三读不是「两家矛盾」，一条都不记。
 *
 * 两条互指：A 那行指出 B 的 provider + source_event_id，B 那行指出 A——
 * 这样从任一条都能查到对面，不需要按顺序猜。
 */

/** 一条冲突的一侧：来源、源内 id、这一侧自己的值。 */
export type CrossSourceConflictSide = Readonly<{
  providerId: string
  sourceEventId: string
  firstScheduledDate: string
  field: CalendarValueField
  value: string
  observedAt: string
}>

/** 供读者/盘点看的冲突对：**一对只出现一次**，两侧的值都在。 */
export type CrossSourceConflict = Readonly<{
  countryCode: string
  metricKey: string
  periodKey: string
  field: CalendarValueField
  observedAt: string
  sides: readonly Readonly<{ providerId: string; sourceEventId: string; value: string | null }>[]
}>

/**
 * 记一对（或一组）冲突：按字段分组，**只有「不同来源 + 值不同」才写**。
 *
 * 每条记录：`value_before` 存这一侧的值（不是「改前值」——冲突行不参与取值），
 * `value_after` 恒为 null，`decision='conflict:cross-source'`，并指向对面那一侧。
 * `observed_at` 取两侧较晚的那个：同一份数据重扫一次落同一条（`insert or ignore`），不翻倍。
 */
export function recordCrossSourceConflict(database: DatabaseSync, input: Readonly<{
  countryCode: string; metricKey: string; periodKey: string
  sides: readonly CrossSourceConflictSide[]
}>): number {
  const byField = new Map<CalendarValueField, CrossSourceConflictSide[]>()
  for (const side of input.sides) {
    if (side.value.trim() === '') continue
    byField.set(side.field, [...(byField.get(side.field) ?? []), side])
  }
  let written = 0
  for (const [field, entries] of byField) {
    if (new Set(entries.map((entry) => entry.providerId)).size < 2) continue
    if (new Set(entries.map((entry) => entry.value)).size < 2) continue
    const observedAt = [...entries.map((entry) => entry.observedAt)].sort().at(-1)!
    for (const entry of entries) {
      // 对面取「第一家别的来源」：多于两家时也各指一条，读者从任一入口都能走到对面。
      const other = entries.find((candidate) => candidate.providerId !== entry.providerId)
      if (other === undefined) continue
      const inserted = recordCalendarValueRevision(database, {
        countryCode: input.countryCode, metricKey: input.metricKey, periodKey: input.periodKey,
        firstScheduledDate: entry.firstScheduledDate, field,
        valueBefore: entry.value, valueAfter: null, decision: crossSourceConflictDecision,
        providerId: entry.providerId, sourceEventId: entry.sourceEventId,
        parserVersion: 'cross-source-conflict-v1', observedAt,
        incomingHash: hashIncomingValues({ [field]: entry.value }),
        conflictWithProviderId: other.providerId, conflictWithSourceEventId: other.sourceEventId
      })
      if (inserted) written += 1
    }
  }
  return written
}

/**
 * 待判清单：**一对冲突只出现一次**（两条互指的记录折成一条），按时间倒序。
 * 同一对来源在不同字段上各算一条（actual 与 previous 是两件事）。
 */
export function listCrossSourceConflicts(database: DatabaseSync, limit = 200): readonly CrossSourceConflict[] {
  ensureCalendarValueRevisionTable(database)
  const rows = database.prepare(`select country_code, metric_key, period_key, field, provider_id,
      source_event_id, value_before, observed_at, conflict_with_provider_id, conflict_with_source_event_id
    from ${calendarValueRevisionPolicy.table}
    where decision = ?
    order by observed_at desc, provider_id asc`).all(crossSourceConflictDecision) as Array<{
      country_code: string; metric_key: string; period_key: string; field: CalendarValueField
      provider_id: string; source_event_id: string; value_before: string | null; observed_at: string
      conflict_with_provider_id: string | null; conflict_with_source_event_id: string | null
    }>
  const valueAt = new Map<string, string | null>()
  for (const row of rows) {
    valueAt.set(`${row.observed_at}|${row.provider_id}|${row.field}|${row.country_code}|${row.metric_key}|${row.period_key}`,
      row.value_before)
  }
  const seen = new Set<string>()
  const out: CrossSourceConflict[] = []
  for (const row of rows) {
    const other = row.conflict_with_provider_id
    if (other === null) continue
    const pair = [row.provider_id, other].sort().join('|')
    const key = `${row.country_code}|${row.metric_key}|${row.period_key}|${row.field}|${pair}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      countryCode: row.country_code, metricKey: row.metric_key, periodKey: row.period_key,
      field: row.field, observedAt: row.observed_at,
      sides: [
        { providerId: row.provider_id, sourceEventId: row.source_event_id, value: row.value_before },
        { providerId: other, sourceEventId: row.conflict_with_source_event_id ?? '',
          value: valueAt.get(`${row.observed_at}|${other}|${row.field}|${row.country_code}|${row.metric_key}|${row.period_key}`) ?? null }
      ]
    })
    if (out.length >= limit) break
  }
  return out
}

/**
 * **来源可靠性：只存派生计数**。按「这家参与过几对冲突」数（一对只算一次），
 * 库里没有任何可靠名列——要展示就现算，避免第二份真相。
 */
export function crossSourceConflictCounts(database: DatabaseSync): readonly Readonly<{
  providerId: string; conflicts: number
}>[] {
  ensureCalendarValueRevisionTable(database)
  const rows = database.prepare(`select provider_id, conflict_with_provider_id
    from ${calendarValueRevisionPolicy.table} where decision = ?`).all(crossSourceConflictDecision) as Array<{
      provider_id: string; conflict_with_provider_id: string | null
    }>
  const pairsByProvider = new Map<string, Set<string>>()
  for (const row of rows) {
    if (row.conflict_with_provider_id === null) continue
    const pair = [row.provider_id, row.conflict_with_provider_id].sort().join('|')
    for (const providerId of [row.provider_id, row.conflict_with_provider_id]) {
      const pairs = pairsByProvider.get(providerId) ?? new Set<string>()
      pairs.add(pair)
      pairsByProvider.set(providerId, pairs)
    }
  }
  return [...pairsByProvider.entries()]
    .map(([providerId, pairs]) => ({ providerId, conflicts: pairs.size }))
    .sort((left, right) => left.providerId.localeCompare(right.providerId))
}

/**
 * 扫描标准表里的真实冲突形状并落记录（幂等）：**同一期、两家以上、值不同**。
 *
 * 只扫 `row_kind='release'` 且 `values_json` 合法（数组身份那批非法 JSON 不参与，
 * 别为了多记一条冲突让整张表的扫描报错——那是 #24 的事）。
 * 返回 `groups` ＝「身份 × 字段」的冲突对数，`recorded` ＝ 这次真正写进去的行数。
 */
export function markCrossSourceConflicts(database: DatabaseSync): Readonly<{ groups: number; recorded: number }> {
  const table = calendarStandardTablePolicy.eventsTable
  ensureCalendarValueRevisionTable(database)
  const groups = database.prepare(`select country_code, metric_key, period_key,
      count(*) as rows, count(distinct source_provider_id) as providers
    from ${table}
    where row_kind = 'release' and json_valid(values_json)
    group by country_code, metric_key, period_key
    having rows > 1 and providers > 1`).all() as Array<{
      country_code: string; metric_key: string; period_key: string; rows: number; providers: number
    }>
  let conflictGroups = 0
  let recorded = 0
  const rowsOf = database.prepare(`select source_provider_id, source_event_id, first_scheduled_date,
      values_json, observed_at, data_observed_at
    from ${table} where country_code = ? and metric_key = ? and period_key = ?
    order by first_scheduled_date asc`)
  for (const group of groups) {
    const rows = rowsOf.all(group.country_code, group.metric_key, group.period_key) as Array<{
      source_provider_id: string; source_event_id: string; first_scheduled_date: string
      values_json: string; observed_at: string; data_observed_at: string | null
    }>
    for (const field of ['actual', 'previous', 'consensus'] as const) {
      const sides = rows.flatMap((row): CrossSourceConflictSide[] => {
        let parsed: Record<string, unknown>
        try { parsed = JSON.parse(row.values_json) as Record<string, unknown> } catch { return [] }
        const value = parsed[field]
        if (typeof value !== 'string' || value.trim() === '') return []
        return [{
          providerId: row.source_provider_id, sourceEventId: row.source_event_id,
          firstScheduledDate: row.first_scheduled_date, field, value,
          observedAt: row.data_observed_at ?? row.observed_at
        }]
      })
      if (new Set(sides.map((side) => side.providerId)).size < 2) continue
      if (new Set(sides.map((side) => side.value.trim())).size < 2) continue
      conflictGroups += 1
      recorded += recordCrossSourceConflict(database, {
        countryCode: group.country_code, metricKey: group.metric_key, periodKey: group.period_key, sides
      })
    }
  }
  return { groups: conflictGroups, recorded }
}
