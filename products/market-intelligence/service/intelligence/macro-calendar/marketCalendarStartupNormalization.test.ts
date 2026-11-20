import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { normalizeCalendarStandardRows } from './marketCalendarStartupNormalization'
import { ensureCalendarStandardTables } from './marketCalendarStandardTable'

/**
 * 启动链幂等规范化（用户 2026-11-19 批）：重算 `value_state` → 桶一 → 期次解析 → 桶二。
 *
 * 用例按六条约束写：只做三类动作、删改都进审计、第二遍 0 变更、三类行不许误伤
 * （有 actual 的行 / 事件行 / 期次解不出的行）。
 */
const now = '2026-11-19T03:20:00.000Z'
const nowIso = '2026-11-19T03:20:00.000Z'

function setup(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  database.exec('create table if not exists mi_macro_calendar_migrations (version integer primary key)')
  return database
}

type Seed = Readonly<{
  countryCode?: string
  metricKey: string
  periodKey: string
  firstScheduledDate: string
  valuesJson?: string
  valueState?: string
  status?: string
  eventType?: string
  identityKind?: 'code' | 'source'
}>

let seq = 0
function seed(database: DatabaseSync, over: Seed): void {
  seq += 1
  database.prepare(`insert into mi_calendar_events
    (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, time_precision,
     status, identity_kind, value_state, values_json, source_provider_id, source_event_id,
     parser_version, observed_at, first_seen_at, event_type, release_count)
    values (?, ?, ?, ?, ?, 'date', ?, ?, ?, ?, 'test', ?, 'v1', ?, ?, ?, 1)`)
    .run(over.countryCode ?? 'US', over.metricKey, over.periodKey, over.firstScheduledDate,
      over.firstScheduledDate, over.status ?? 'published', over.identityKind ?? 'code',
      over.valueState ?? 'missing', over.valuesJson ?? '{}', `x-${seq}`, now, now, over.eventType ?? null)
}

const run = (database: DatabaseSync) => normalizeCalendarStandardRows(database, { nowIso })
const rows = (database: DatabaseSync) =>
  database.prepare('select rowid, * from mi_calendar_events order by rowid').all() as Array<Record<string, unknown>>

describe('启动链幂等规范化', () => {
  it('虚标 present（只有前值）→ 重算成 missing；真正的 actual 一行不动', () => {
    const database = setup()
    seed(database, { metricKey: 'US.A.NONE.LEVEL', periodKey: '2026-10', firstScheduledDate: '2026-11-01',
      valuesJson: '{"previous":"1.0"}', valueState: 'present' })
    seed(database, { metricKey: 'US.B.NONE.LEVEL', periodKey: '2026-10', firstScheduledDate: '2026-11-01',
      valuesJson: '{"actual":"0%"}', valueState: 'present' })
    const report = run(database)
    expect(report.valueStateToMissing).toBe(1)
    const after = rows(database)
    const flagged = after.find((row) => row.metric_key === 'US.A.NONE.LEVEL')!
    expect(flagged.value_state).toBe('missing')
    const real = after.find((row) => row.metric_key === 'US.B.NONE.LEVEL')!
    // `0%` 是真值：状态与数值都不许被动。
    expect(real.value_state).toBe('present')
    expect(real.values_json).toBe('{"actual":"0%"}')
    expect(run(database)).toMatchObject({ valueStateToMissing: 0, periodsResolved: 0, droppedRows: 0 })
  })

  it('事件行的 unknown 期次按活动日期解；行还在、不被并', () => {
    const database = setup()
    seed(database, { metricKey: '["45051",79090]', periodKey: 'unknown:["45051",79090]',
      firstScheduledDate: '2026-11-17', eventType: 'central-bank-activity', identityKind: 'source' })
    const report = run(database)
    expect(report.periodsResolved).toBe(1)
    const after = rows(database)
    expect(after).toHaveLength(1)
    expect(after[0]!.period_key).toBe('2026-11-17')
  })

  it('同国家+码+期次两行 → 合并成一行，被删整行进审计并记规则分支', () => {
    const database = setup()
    seed(database, { metricKey: 'US.C.NONE.LEVEL', periodKey: '2026-10', firstScheduledDate: '2026-10-01',
      valuesJson: '{"actual":"1.0"}', valueState: 'present' })
    seed(database, { metricKey: 'US.C.NONE.LEVEL', periodKey: '2026-10', firstScheduledDate: '2026-10-05',
      valuesJson: '{"actual":"1.2"}', valueState: 'present' })
    const report = run(database)
    expect(report.droppedRows).toBe(1)
    const after = rows(database)
    expect(after).toHaveLength(1)
    // 都有 actual → 取首发布日最晚那条（修订值）。
    expect(after[0]!.first_scheduled_date).toBe('2026-10-05')
    const audit = database.prepare('select rule, deleted_row_json from mi_calendar_events__merge_audit_v1')
      .all() as Array<{ rule: string; deleted_row_json: string }>
    expect(audit).toHaveLength(1)
    expect(audit[0]!.rule).toBe('period-resolve-dup/latest-when-all-have-actual')
    expect(JSON.parse(audit[0]!.deleted_row_json).first_scheduled_date).toBe('2026-10-01')
  })

  it('期次解不出的行原样保留（不删、不改期次），第二遍 0 变更', () => {
    const database = setup()
    seed(database, { metricKey: '["999999",1]', periodKey: 'unknown:["999999",1]',
      firstScheduledDate: '2026-11-10', identityKind: 'source' })
    const report = run(database)
    expect(report.unresolvedPeriods).toBe(1)
    expect(report.droppedRows).toBe(0)
    const after = rows(database)
    expect(after).toHaveLength(1)
    expect(after[0]!.period_key).toBe('unknown:["999999",1]')
    expect(run(database)).toMatchObject({
      valueStateToPresent: 0, valueStateToMissing: 0, periodsResolved: 0,
      mergedRows: 0, droppedRows: 0, unresolvedPeriods: 1
    })
  })

  it('桶一：有正常期次行的 unknown 重复 → 先并值后删，正常行不动其已有值', () => {
    const database = setup()
    seed(database, { metricKey: 'US.D.NONE.LEVEL', periodKey: '2026-10', firstScheduledDate: '2026-11-05',
      valuesJson: '{"previous":"4.6%"}' })
    seed(database, { metricKey: 'US.D.NONE.LEVEL', periodKey: 'unknown:US~US.D.NONE.LEVEL~2026-11-05',
      firstScheduledDate: '2026-11-05', valuesJson: '{"previous":"9.9%","actual":"4.85%"}' })
    const report = run(database)
    expect(report.droppedRows).toBe(1)
    const after = rows(database)
    expect(after).toHaveLength(1)
    // 保留行原来有 previous，不许被覆盖；actual 是保留行没有的，必须补上。
    expect(after[0]!.values_json).toBe('{"previous":"4.6%","actual":"4.85%"}')
    expect(after[0]!.value_state).toBe('present')
    const rule = (database.prepare('select rule from mi_calendar_events__merge_audit_v1').get() as { rule: string }).rule
    expect(rule).toBe('merged-value-then-delete')
  })
})
