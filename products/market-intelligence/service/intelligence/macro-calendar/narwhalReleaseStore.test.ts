import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { createMacroCalendarRepository } from './macroCalendarRepository'
import { timePrecisionOf, type NarwhalReleaseRow } from './narwhalReleaseContracts'

const row = (overrides: Partial<NarwhalReleaseRow> = {}): NarwhalReleaseRow => ({
  releaseId: 'rel-1', providerId: 'narwhal', countryCode: 'USA', scheduledDate: '2026-11-13',
  scheduledAt: '2026-11-13T13:30:00.000Z', dateBasis: 'exact', status: 'scheduled',
  values: [{ measure: 'cpi_yoy', previous: '3.7', consensus: '3.9' }],
  detectedAt: '2026-11-13T00:00:00.000Z', recordedAt: '2026-11-13T00:00:00.000Z',
  ...overrides
})

describe('narwhal release rows', () => {
  it('upserts by release_id — one row per release, not one per fetch', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    try {
      repository.upsertReleaseRow(row())
      repository.upsertReleaseRow(row({ values: [{ measure: 'cpi_yoy', actual: '3.9' }] }))
      const stored = repository.listReleaseRows({ countryCode: 'USA', scheduledDate: '2026-11-13' })
      expect(stored).toHaveLength(1)
      expect(stored[0]!.values[0]!.actual).toBe('3.9')
    } finally { repository.close() }
  })

  it('keeps date_basis, and indicative maps to a date-only precision', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    try {
      repository.upsertReleaseRow(row({ releaseId: 'rel-ind', dateBasis: 'indicative' }))
      const [stored] = repository.listReleaseRows({ countryCode: 'USA', scheduledDate: '2026-11-13' })
      expect(stored!.dateBasis).toBe('indicative')
      // 渲染层拿这个派生：indicative 不许显示到分钟。
      expect(timePrecisionOf(stored!.dateBasis)).toBe('date')
    } finally { repository.close() }
  })
})

describe('first published snapshot', () => {
  it('keeps the very first previous value and never lets a revision overwrite it', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    try {
      expect(repository.recordFirstPublished({ releaseKey: 'rel-1', providerId: 'narwhal', firstPrevious: '29', capturedAt: '2026-11-06T00:00:00.000Z' })).toBe(true)
      // 来源后来修订了 previous（29 → 60）：快照必须还是 29。
      expect(repository.recordFirstPublished({ releaseKey: 'rel-1', providerId: 'narwhal', firstPrevious: '60', capturedAt: '2026-11-07T00:00:00.000Z' })).toBe(false)
      expect(repository.readFirstPublished('rel-1')?.firstPrevious).toBe('29')
    } finally { repository.close() }
  })

  it('returns nothing when the first previous was never captured — the card must say 无法确认，not 0', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    try {
      expect(repository.readFirstPublished('rel-never-seen')).toBeUndefined()
    } finally { repository.close() }
  })
})

describe('migration from the previous storage version', () => {
  it('keeps rows written by version 8 and adds the two new tables', () => {
    const database = new DatabaseSync(':memory:')
    try {
      // 模拟上一版留下的库：迁移表只到 8，且已有一行修订。
      database.exec(`create table mi_macro_calendar_migrations (version integer primary key);
        insert into mi_macro_calendar_migrations(version) values (8);
        create table mi_macro_calendar_revisions (revision_id text primary key, event_key text not null,
          release_group_key text not null, event_family text not null, event_name_key text not null,
          country_code text not null, importance text not null, period_key text not null,
          lifecycle_state text not null, revision_kind text not null, scheduled_date text not null,
          scheduled_at text, published_at text, detected_at text not null, detected_at_ms integer not null,
          recorded_at text not null, actual_json text, previous_json text, consensus_json text,
          provider_id text not null, descriptor_id text not null, source_url text not null,
          raw_record_id text, evidence_hash text not null, evidence_refs_json text not null,
          snapshot_hash text not null, replaces_revision_id text, parser_version text not null,
          caveats_json text not null, schema_version integer not null, unique(event_key, snapshot_hash));
        insert into mi_macro_calendar_revisions(revision_id, event_key, release_group_key, event_family,
          event_name_key, country_code, importance, period_key, lifecycle_state, revision_kind,
          scheduled_date, detected_at, detected_at_ms, recorded_at, provider_id, descriptor_id,
          source_url, evidence_hash, evidence_refs_json, snapshot_hash, parser_version, caveats_json, schema_version)
          values ('old','evt','grp','cpi','us.cpi','US','high','2026-M09','released','official-release',
          '2026-10-14','2026-10-14T00:00:00.000Z',1,'2026-10-14T00:00:00.000Z','macro-calendar-bls',
          'd','u','h','[]','s','p','[]',1);`)
      // 打开仓库＝跑迁移。
      const repository = createMacroCalendarRepository({ storage: { database, filePath: ':memory:', close: () => undefined } })
      expect(repository.listEffectiveMonthAsOf({ monthStart: '2026-10-01', monthEndExclusive: '2026-11-01', asOf: '2026-11-13T00:00:00.000Z', limit: 10 })).toHaveLength(1)
      const versions = database.prepare('select version from mi_macro_calendar_migrations order by version').all() as Array<{ version: number }>
      expect(versions.map(row => row.version)).toContain(9)
      expect(versions.map(row => row.version)).toContain(10)
      expect(database.prepare("select name from sqlite_master where type='table' and name in ('mi_macro_calendar_release_rows','mi_macro_calendar_first_published')").all()).toHaveLength(2)
    } finally { database.close() }
  })
})
