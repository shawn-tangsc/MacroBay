import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables } from './marketCalendarStandardTable'
import { measureMonthlyDiff, replayOfficialHistoryIntoStandardTable } from './marketCalendarOfficialHistoryReplay'

/** 一张最小的修订表副本：两族指标 + 一场 FOMC，日期跨 2021 与 2026。 */
function revisionsDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  database.exec(`create table mi_macro_calendar_revisions (
    revision_id text primary key, event_key text not null, release_group_key text not null, event_family text not null,
    event_name_key text not null, country_code text not null, importance text not null, period_key text not null,
    lifecycle_state text not null, revision_kind text not null, scheduled_date text not null, scheduled_at text,
    published_at text, detected_at text not null, detected_at_ms integer not null, recorded_at text not null,
    actual_json text, previous_json text, consensus_json text, provider_id text not null, descriptor_id text not null,
    source_url text not null, raw_record_id text, evidence_hash text not null, evidence_refs_json text not null,
    snapshot_hash text not null, replaces_revision_id text, parser_version text not null, caveats_json text not null,
    schema_version integer not null, unique(event_key, snapshot_hash))`)
  toRows(database, 'mi_macro_calendar_revisions')
  return database
}

function toRows(database: DatabaseSync, table: string): void {
  const insert = (values: unknown[]) => database.prepare(`insert into ${table}
    (revision_id, event_key, release_group_key, event_family, event_name_key, country_code, importance, period_key,
     lifecycle_state, revision_kind, scheduled_date, scheduled_at, published_at, detected_at, detected_at_ms,
     recorded_at, actual_json, previous_json, consensus_json, provider_id, descriptor_id, source_url, raw_record_id,
     evidence_hash, evidence_refs_json, snapshot_hash, replaces_revision_id, parser_version, caveats_json, schema_version)
    values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...values as never[])
  insert(['r1', 'US.CPI.RELEASE.2026-M10', 'G.CPI', 'consumer-price-index', 'cpi', 'US', 'high', '2026-10',
    'released', 'official-release', '2026-11-10', '2026-11-10T13:30:00.000Z', null, '2026-11-10T13:31:00.000Z',
    1762771860000, '2026-11-10T13:31:00.000Z', JSON.stringify({ displayValue: '3.7' }),
    JSON.stringify({ displayValue: '3.6' }), JSON.stringify({ displayValue: '3.5' }),
    'macro-calendar-bls', 'd', 'https://x', null, 'h1', '[]', 's1', null, 'v1', '[]', 1])
  insert(['r2', 'US.FOMC.2026-12-09', 'G.FOMC', 'fomc', 'fomc', 'US', 'high', '2026-12-09',
    'scheduled', 'official-release', '2026-12-09', null, null, '2026-12-01T00:00:00.000Z',
    1764547200000, '2026-12-01T00:00:00.000Z', null, null, null,
    'macro-calendar-fed', 'd', 'https://x', null, 'h2', '[]', 's2', null, 'v1', '[]', 1])
  insert(['r3', 'US.SOMETHING_UNMAPPED.2026-M11', 'G.X', 'mystery-family', 'mystery', 'US', 'high', '2026-11',
    'scheduled', 'official-release', '2026-11-20', null, null, '2026-11-01T00:00:00.000Z',
    1761955200000, '2026-11-01T00:00:00.000Z', null, null, null,
    'macro-calendar-bls', 'd', 'https://x', null, 'h3', '[]', 's3', null, 'v1', '[]', 1])
}

describe('官方历史回放（S1）', () => {
  it('指标行落到发布映射的码，FOMC 沿用标准表里已有的身份（US.FOMC.<首发布日> + source）', () => {
    const database = revisionsDatabase()
    ensureCalendarStandardTables(database)
    const report = replayOfficialHistoryIntoStandardTable(database)
    const rows = database.prepare('select metric_key, identity_kind, row_kind, status from mi_calendar_events order by metric_key')
      .all() as { metric_key: string; identity_kind: string; row_kind: string; status: string }[]
    expect(rows.map((row) => row.metric_key)).toEqual(['US.CPI.NSA.YOY', 'US.FOMC.2026-12-09'])
    const fomc = rows.find((row) => row.metric_key === 'US.FOMC.2026-12-09')!
    // 另起一套 `evt.fomc` 身份会让同一场会议在主键层面出现两行。
    expect(fomc.identity_kind).toBe('source')
    // 视图只出 release：写成别的，分析读得到、界面读不到。
    expect(rows.every((row) => row.row_kind === 'release')).toBe(true)
    expect(report.revisions).toBe(3)
    expect(report.unmapped).toBe(1)
    expect(report.written).toBe(2)
  })

  it('跑两遍幂等：第二遍不新增，逐月差集为空', () => {
    const database = revisionsDatabase()
    ensureCalendarStandardTables(database)
    replayOfficialHistoryIntoStandardTable(database)
    const before = (database.prepare('select count(*) c from mi_calendar_events').get() as { c: number }).c
    replayOfficialHistoryIntoStandardTable(database)
    expect((database.prepare('select count(*) c from mi_calendar_events').get() as { c: number }).c).toBe(before)
    // 差集里只剩那条映射不出的（它按设计进 unmapped，不进标准表）。
    expect(measureMonthlyDiff(database)).toEqual({ '2026-11': ['US.SOMETHING_UNMAPPED.2026-M11'] })
  })

  it('同一场 FOMC 在主键层面只有一行（12-09 这场）', () => {
    const database = revisionsDatabase()
    ensureCalendarStandardTables(database)
    replayOfficialHistoryIntoStandardTable(database)
    const count = (database.prepare("select count(*) c from mi_calendar_events where metric_key = 'US.FOMC.2026-12-09'").get() as { c: number }).c
    expect(count).toBe(1)
  })
})

describe('启动时幂等回放（迁移标记）', () => {
  it('第一次跑回放并写标记，第二次直接跳过（不重放、不改行）', async () => {
    const { ensureOfficialHistoryReplayed, officialHistoryReplayPolicy } = await import('./marketCalendarOfficialHistoryReplay')
    const database = revisionsDatabase()
    ensureCalendarStandardTables(database)
    database.exec('create table if not exists mi_macro_calendar_migrations (version integer primary key)')
    expect(ensureOfficialHistoryReplayed(database)).toBe(true)
    const afterFirst = (database.prepare('select count(*) c from mi_calendar_events').get() as { c: number }).c
    expect(database.prepare('select 1 from mi_macro_calendar_migrations where version = ?')
      .get(officialHistoryReplayPolicy.migrationVersion)).toBeDefined()
    expect(ensureOfficialHistoryReplayed(database)).toBe(false)
    expect((database.prepare('select count(*) c from mi_calendar_events').get() as { c: number }).c).toBe(afterFirst)
  })
})
