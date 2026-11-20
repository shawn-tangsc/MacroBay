import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureRevisionImportanceNullable } from './marketCalendarStorageReclaim'

/**
 * `mi_macro_calendar_revisions.importance` 从 `not null` 放宽成可空。
 *
 * 触发原因：记录契约改成「源没说就不写」，写入端写 `importance ?? null`；列还写着 `not null` 时，
 * 官方日程那两条源（草稿本来不带重要性）每轮都失败，连续 15 次，日志只有一句「run failed」。
 * 实测原文：`NOT NULL constraint failed: mi_macro_calendar_revisions.importance`。
 */

/** 迁移前的旧形状：`importance text not null`，一条有值的旧行。 */
function oldShapeDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  database.exec(`create table mi_macro_calendar_revisions (
    revision_id text primary key, event_key text not null, release_group_key text not null,
    event_family text not null, event_name_key text not null, country_code text not null,
    importance text not null, period_key text not null, lifecycle_state text not null,
    revision_kind text not null, scheduled_date text not null, scheduled_at text, published_at text,
    detected_at text not null, detected_at_ms integer not null, recorded_at text not null,
    actual_json text, previous_json text, consensus_json text, provider_id text not null,
    descriptor_id text not null, source_url text not null, raw_record_id text, evidence_hash text not null,
    evidence_refs_json text not null, snapshot_hash text not null, replaces_revision_id text,
    parser_version text not null, caveats_json text not null, schema_version integer not null,
    unique(event_key, snapshot_hash))`)
  database.exec(`create index idx_mi_calendar_event_visible on mi_macro_calendar_revisions(event_key, detected_at_ms desc, recorded_at desc)`)
  database.prepare(`insert into mi_macro_calendar_revisions
    (revision_id, event_key, release_group_key, event_family, event_name_key, country_code, importance,
     period_key, lifecycle_state, revision_kind, scheduled_date, detected_at, detected_at_ms, recorded_at,
     provider_id, descriptor_id, source_url, evidence_hash, evidence_refs_json, snapshot_hash,
     parser_version, caveats_json, schema_version)
    values ('old-1','US.FOMC.2026-12-09','g','fomc','fomc','US','high','2026-12','scheduled',
      'official-release','2026-12-09','2026-11-13T00:00:00.000Z',1762992000000,'2026-11-13T00:00:00.000Z',
      'macro-calendar-fed','macro-calendar-fed-schedule','https://x','h','[]','snap-1','v1','[]',1)`).run()
  return database
}

const insert = (database: DatabaseSync, importance: string | null, id: string): void => {
  database.prepare(`insert into mi_macro_calendar_revisions
    (revision_id, event_key, release_group_key, event_family, event_name_key, country_code, importance,
     period_key, lifecycle_state, revision_kind, scheduled_date, detected_at, detected_at_ms, recorded_at,
     provider_id, descriptor_id, source_url, evidence_hash, evidence_refs_json, snapshot_hash,
     parser_version, caveats_json, schema_version)
    values (?,'US.FOMC.2026-12-09','g','fomc','fomc','US',?,'2026-12','scheduled','official-release',
      '2026-12-09','2026-11-14T00:00:00.000Z',1763088000000,'2026-11-14T00:00:00.000Z',
      'macro-calendar-fed','macro-calendar-fed-schedule','https://x','h','[]',?,'v1','[]',1)`).run(id, importance, `snap-${id}`)
}

describe('记录表 importance 放宽迁移', () => {
  it('旧行原样保留、值不丢，迁完之后不带重要性的记录能写进去', () => {
    const database = oldShapeDatabase()
    expect(ensureRevisionImportanceNullable(database)).toBe(true)
    const rows = database.prepare('select revision_id, importance from mi_macro_calendar_revisions order by revision_id')
      .all() as { revision_id: string; importance: string | null }[]
    expect(rows).toEqual([{ revision_id: 'old-1', importance: 'high' }])   // 读上一版写的行：还在、值还在
    expect(() => insert(database, null, 'new-null')).not.toThrow()          // 这次能写进去了
    expect(() => insert(database, 'medium', 'new-medium')).not.toThrow()
    expect(database.prepare('select count(*) as c from mi_macro_calendar_revisions').get()).toEqual({ c: 3 })
  })

  it('幂等：已经是可空时什么都不做，也不报错', () => {
    const database = oldShapeDatabase()
    expect(ensureRevisionImportanceNullable(database)).toBe(true)
    expect(ensureRevisionImportanceNullable(database)).toBe(false)
    expect(database.prepare('select count(*) as c from mi_macro_calendar_revisions').get()).toEqual({ c: 1 })
  })

  it('唯一约束与索引都还在（迁移重建的不只是列）', () => {
    const database = oldShapeDatabase()
    ensureRevisionImportanceNullable(database)
    insert(database, null, 'dup')
    // 同 (event_key, snapshot_hash) 再插一次必须被唯一约束拦住：约束跟着表一起重建了。
    expect(() => insert(database, null, 'dup')).toThrow(/UNIQUE/)
    const indexes = database.prepare("select name from sqlite_master where type = 'index' and tbl_name = 'mi_macro_calendar_revisions'")
      .all() as { name: string }[]
    expect(indexes.map((index) => index.name)).toContain('idx_mi_calendar_event_visible')
  })
})
