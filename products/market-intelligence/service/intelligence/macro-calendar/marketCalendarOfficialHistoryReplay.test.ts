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
    const rows = database.prepare('select metric_key, period_key, source_event_id, identity_kind, row_kind, status from mi_calendar_events order by metric_key')
      .all() as { metric_key: string; period_key: string; source_event_id: string; identity_kind: string; row_kind: string; status: string }[]
    expect(rows.map((row) => row.metric_key)).toEqual(['US.CPI.NSA.YOY', 'US.FOMC.2026-12-09'])
    // 期次只留一种写法：修订表里是来源原样的 `2026-M10`，标准表里必须是 `2026-10`。
    // 不归一，同一期在表里会落成两行，且补值那行永远问不到 FRED 的值。
    expect(rows[0]!.period_key).toBe('2026-10')
    expect(rows[0]!.source_event_id).toBe('US.CPI.RELEASE.2026-10')
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

describe('启动时幂等回放（判据是差集，不是迁移标记）', () => {
  it('第一次跑回放；差集为空就跳过，不再写迁移标记', async () => {
    const { ensureOfficialHistoryReplayed, officialHistoryReplayPolicy } = await import('./marketCalendarOfficialHistoryReplay')
    const database = revisionsDatabase()
    ensureCalendarStandardTables(database)
    database.exec('create table if not exists mi_macro_calendar_migrations (version integer primary key)')
    // 老库留下的标记：现在只被清掉，不再决定跑不跑。
    database.prepare('insert or ignore into mi_macro_calendar_migrations(version) values (?)')
      .run(officialHistoryReplayPolicy.migrationVersion)
    expect(ensureOfficialHistoryReplayed(database)).toBe(true)
    const afterFirst = (database.prepare('select count(*) c from mi_calendar_events').get() as { c: number }).c
    expect(database.prepare('select 1 from mi_macro_calendar_migrations where version = ?')
      .get(officialHistoryReplayPolicy.migrationVersion)).toBeUndefined()
    expect(ensureOfficialHistoryReplayed(database)).toBe(false)
    expect((database.prepare('select count(*) c from mi_calendar_events').get() as { c: number }).c).toBe(afterFirst)
  })

  it('回放过之后新到的一条历史修订照样回放（旧代码被标记挡住）', async () => {
    const { ensureOfficialHistoryReplayed } = await import('./marketCalendarOfficialHistoryReplay')
    const database = revisionsDatabase()
    ensureCalendarStandardTables(database)
    database.exec('create table if not exists mi_macro_calendar_migrations (version integer primary key)')
    expect(ensureOfficialHistoryReplayed(database)).toBe(true)
    // 窗口外的历史修订晚到：官方同步只写月份窗口，这种只能靠回放落表。
    database.prepare(`insert into mi_macro_calendar_revisions
      (revision_id, event_key, release_group_key, event_family, event_name_key, country_code, importance, period_key,
       lifecycle_state, revision_kind, scheduled_date, scheduled_at, published_at, detected_at, detected_at_ms,
       recorded_at, actual_json, previous_json, consensus_json, provider_id, descriptor_id, source_url, raw_record_id,
       evidence_hash, evidence_refs_json, snapshot_hash, replaces_revision_id, parser_version, caveats_json, schema_version)
      select 'r4', 'US.CPI.RELEASE.2026-M09', release_group_key, event_family, event_name_key, country_code, importance,
        '2026-M09', lifecycle_state, revision_kind, '2026-10-14', scheduled_at, published_at, detected_at, detected_at_ms,
        recorded_at, actual_json, previous_json, consensus_json, provider_id, descriptor_id, source_url, raw_record_id,
        'h4', evidence_refs_json, 's4', replaces_revision_id, parser_version, caveats_json, schema_version
      from mi_macro_calendar_revisions where revision_id = 'r1'`).run()
    expect(ensureOfficialHistoryReplayed(database)).toBe(true)
    const rows = database.prepare("select count(*) c from mi_calendar_events where source_event_id = 'US.CPI.RELEASE.2026-09'")
      .get() as { c: number }
    expect(rows.c).toBe(1)
    // 补上之后再跑：差集为空，不再回放。
    expect(ensureOfficialHistoryReplayed(database)).toBe(false)
  })
})

/**
 * N2：历史回放这条腿也把修订表里**源给的数值**带进标准表。
 *
 * 修订表 `actual_json` 存的是整个值对象（`{displayValue, numericValue, unit}`），以前只解出展示串。
 * 这条腿补的是窗口外的历史行——不回放它的数，跨源比较在历史上永远是「数值未记录」。
 */
describe('回放把源自报的数值带进数值列（N2）', () => {
  it('修订里有 numericValue + unit → 数值列可算；只给展示串 → 按量纲提示解析', () => {
    const database = revisionsDatabase()
    ensureCalendarStandardTables(database)
    // r1 已经有 `{displayValue:'3.7'}`：按 CPI 年率的量纲提示落 percent。
    database.prepare(`insert into mi_macro_calendar_revisions
      (revision_id, event_key, release_group_key, event_family, event_name_key, country_code, importance, period_key,
       lifecycle_state, revision_kind, scheduled_date, scheduled_at, published_at, detected_at, detected_at_ms,
       recorded_at, actual_json, previous_json, consensus_json, provider_id, descriptor_id, source_url, raw_record_id,
       evidence_hash, evidence_refs_json, snapshot_hash, replaces_revision_id, parser_version, caveats_json, schema_version)
      select 'r5', 'US.PCE.RELEASE.2026-M09', release_group_key, event_family, event_name_key, country_code, importance,
        '2026-M09', 'released', 'official-release', '2026-10-30', scheduled_at, published_at, detected_at, detected_at_ms,
        recorded_at, ?, ?, consensus_json, provider_id, descriptor_id, source_url, raw_record_id,
        'h5', evidence_refs_json, 's5', replaces_revision_id, parser_version, caveats_json, schema_version
      from mi_macro_calendar_revisions where revision_id = 'r1'`).run(
      JSON.stringify({ displayValue: '2.4%', numericValue: 2.4, unit: 'percent-yoy' }),
      JSON.stringify({ displayValue: '2.1%', numericValue: 2.1, unit: 'percent-yoy' }))
    replayOfficialHistoryIntoStandardTable(database)
    const rows = database.prepare(`select metric_key, numeric_json from mi_calendar_events
      where metric_key in ('US.CPI.NSA.YOY', 'US.PCE.NSA.YOY') order by metric_key`)
      .all() as { metric_key: string; numeric_json: string }[]
    expect(rows).toHaveLength(2)
    // 展示串没有百分号（3.7）也按年率量纲落 percent；有 numericValue 的直接用源的数。
    expect(JSON.parse(rows[0]!.numeric_json)).toMatchObject({ state: 'available', unit: 'percent', values: { actual: 3.7 } })
    expect(JSON.parse(rows[1]!.numeric_json)).toMatchObject({
      state: 'available', unit: 'percent', values: { actual: 2.4, previous: 2.1 }
    })
  })

  it('解析不出的展示串进回放汇总计数，不当成 0', () => {
    const database = revisionsDatabase()
    ensureCalendarStandardTables(database)
    // 三个值全解不出：这一行就是 `unparsed`（一个值解不出、别的解出来是 `available`，见上一例）。
    database.prepare(`update mi_macro_calendar_revisions
      set actual_json = ?, previous_json = null, consensus_json = null where revision_id = 'r1'`)
      .run(JSON.stringify({ displayValue: '--' }))
    const report = replayOfficialHistoryIntoStandardTable(database)
    expect(report.numericUnparsed).toBe(1)
    const row = database.prepare("select numeric_json from mi_calendar_events where metric_key = 'US.CPI.NSA.YOY'")
      .get() as { numeric_json: string }
    expect(JSON.parse(row.numeric_json)).toMatchObject({ state: 'unparsed' })
    expect(JSON.parse(row.numeric_json).values).toBeUndefined()
  })
})
