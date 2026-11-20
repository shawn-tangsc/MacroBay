import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { calendarSourceNameMergePolicy, mergeSameSourceNameRows } from './marketCalendarSameIdentityMerge'
import { ensureCalendarStandardTables, upsertCalendarStandardRow } from './marketCalendarStandardTable'
import { resolveSameSourceIdentityTarget, sourceLabelsForWrite } from './marketCalendarSameIdentityWrite'
import { readCalendarEventIndex } from './rendering/marketCalendarEventIndexRead'

/**
 * 同一件事的中英两条在库里合成一行（迁移 18）。
 *
 * 真库实测 251 组 / 502 行（US 180、DE 78、BEA 1，每组恰好一条中文名、一条英文名）。判据落在
 * 用户能看见的两件事：**表里从两条变一条**、**中文名显示而英文仍搜得到**；外加一条只有做对了才成立的：
 * 台账不许留在被删掉的身份上（否则下次采集把行插回来，合并当场失效）。
 */
const now = '2026-11-17T00:00:00.000Z'

function setup(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  database.exec('create table if not exists mi_macro_calendar_migrations (version integer primary key)')
  return database
}

type RawRow = Readonly<{
  metricKey: string; periodKey: string; label: string; actual?: string
  status?: string; scheduledDate?: string
}>

function insertRaw(database: DatabaseSync, row: RawRow): void {
  const values = JSON.stringify({
    ...(row.actual === undefined ? {} : { actual: row.actual }), previous: '25.5', consensus: '18.0'
  })
  database.prepare(`insert into mi_calendar_events
    (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, scheduled_at, time_precision,
     status, identity_kind, source_label, value_state, values_json, source_provider_id, source_event_id,
     parser_version, observed_at, first_seen_at, event_type, release_count)
    values ('US', ?, ?, ?, ?, null, 'minute', ?, 'source', ?, 'present', ?, '0xrouter', ?, 'v1', ?, ?, 'economic-indicator', 1)`)
    .run(row.metricKey, row.periodKey, row.scheduledDate ?? '2026-11-16', row.scheduledDate ?? '2026-11-16',
      row.status ?? 'published', row.label, values, row.metricKey, now, now)
}

const ZH = '11月纽约联储制造业指数'
const EN = 'New York Fed manufacturing index(Nov)'

describe('迁移 18：中英两条在库里合成一行', () => {
  it('同一数组身份同一期：留中文名那行，英文原文进 `source_label_en`，删掉英文那行', () => {
    const database = setup()
    insertRaw(database, { metricKey: '["214790",79090]', periodKey: '2026-11-16T13:30', label: EN, actual: '7.8' })
    insertRaw(database, { metricKey: '["214790",79095]', periodKey: '2026-11-16T13:30', label: ZH, actual: '7.8' })
    const report = mergeSameSourceNameRows(database)
    expect(report).toMatchObject({ groups: 1, mergedGroups: 1, removedRows: 1, englishNameStored: 1 })
    const rows = database.prepare('select metric_key, source_label, source_label_en, values_json from mi_calendar_events')
      .all() as unknown as Record<string, string>[]
    expect(rows).toHaveLength(1)
    // 留下的必须是**中文名那条的身份**：显示名靠它，改成英文那条就等于把中文名换回英文。
    expect(rows[0]!.metric_key).toBe('["214790",79095]')
    expect(rows[0]!.source_label).toBe(ZH)
    expect(rows[0]!.source_label_en).toBe(EN)
    expect(JSON.parse(rows[0]!.values_json).actual).toBe('7.8')
  })

  it('台账改指到留下的那一行：下次采集英文 id 能被认回，不会把行插回来', () => {
    const database = setup()
    insertRaw(database, { metricKey: '["214790",79090]', periodKey: '2026-11-16T13:30', label: EN })
    insertRaw(database, { metricKey: '["214790",79095]', periodKey: '2026-11-16T13:30', label: ZH })
    const ledger = 'insert into mi_calendar_event_source_ids (provider_id, source_event_id, country_code, metric_key, period_key, first_scheduled_date, observed_at) values (?,?,?,?,?,?,?)'
    database.prepare(ledger).run('0xrouter', '["214790",79090]', 'US', '["214790",79090]', '2026-11-16T13:30', '2026-11-16', now)
    database.prepare(ledger).run('0xrouter', '["214790",79095]', 'US', '["214790",79095]', '2026-11-16T13:30', '2026-11-16', now)
    const report = mergeSameSourceNameRows(database)
    expect(report.ledgerRewritten).toBe(1)
    const kept = database.prepare(`select metric_key from mi_calendar_event_source_ids where source_event_id = '["214790",79090]'`)
      .get() as { metric_key: string }
    expect(kept.metric_key).toBe('["214790",79095]')
    // 台账指向的身份必须真的存在——否则「孤儿」判据红。
    const orphans = Number((database.prepare(`select count(*) n from mi_calendar_event_source_ids l
      where not exists (select 1 from mi_calendar_events e where e.country_code = l.country_code
        and e.metric_key = l.metric_key and e.period_key = l.period_key
        and e.first_scheduled_date = l.first_scheduled_date)`).get() as { n: number }).n)
    expect(orphans).toBe(0)
  })

  it('跑第二遍 0 变更；备份表留着合并前的两行', () => {
    const database = setup()
    insertRaw(database, { metricKey: '["214790",79090]', periodKey: '2026-11-16T13:30', label: EN })
    insertRaw(database, { metricKey: '["214790",79095]', periodKey: '2026-11-16T13:30', label: ZH })
    mergeSameSourceNameRows(database)
    const again = mergeSameSourceNameRows(database)
    expect(again).toMatchObject({ groups: 0, mergedGroups: 0, removedRows: 0 })
    const backup = database.prepare(`select count(*) n from ${calendarSourceNameMergePolicy.backupTable}`).get() as { n: number }
    expect(backup.n).toBe(2)
  })

  it('同月改期不合并：那是两次排期记录，并掉就是改历史', () => {
    const database = setup()
    insertRaw(database, { metricKey: '["214634",78802]', periodKey: '2026-11-12T16:05', label: '10月批发物价指数(月率)', status: 'missing' })
    insertRaw(database, { metricKey: '["214634",78803]', periodKey: '2026-11-12T16:05', label: 'Wholesale Price Index (MoM)(Oct)', status: 'missing' })
    insertRaw(database, { metricKey: '["214634",78802]', periodKey: '2026-11-13T07:00', label: '10月批发物价指数(月率)', actual: '0.4%' })
    insertRaw(database, { metricKey: '["214634",78803]', periodKey: '2026-11-13T07:00', label: 'Wholesale Price Index (MoM)(Oct)', actual: '0.4%' })
    const report = mergeSameSourceNameRows(database)
    // 每一期各合一次；两期之间不合并。
    expect(report).toMatchObject({ groups: 2, mergedGroups: 2, removedRows: 2, rescheduledKept: 1 })
    const rows = database.prepare('select period_key from mi_calendar_events order by period_key').all() as unknown as { period_key: string }[]
    expect(rows.map((row) => row.period_key)).toEqual(['2026-11-12T16:05', '2026-11-13T07:00'])
  })

  it('标准码身份的同码行不参与：那是另一次发布（二读/三读），不是重复', () => {
    const database = setup()
    insertRaw(database, { metricKey: 'US.GDP.SA.ANNUALIZED_QOQ', periodKey: '2026-Q3', label: '第三季度实际GDP初值', status: 'scheduled', scheduledDate: '2026-11-25' })
    insertRaw(database, { metricKey: 'US.GDP.SA.ANNUALIZED_QOQ', periodKey: '2026-Q3', label: '第三季度实际GDP初值', status: 'scheduled', scheduledDate: '2026-12-23' })
    const report = mergeSameSourceNameRows(database)
    expect(report).toMatchObject({ groups: 0, removedRows: 0 })
    expect((database.prepare('select count(*) n from mi_calendar_events').get() as { n: number }).n).toBe(2)
  })
})

describe('写入侧认回同一件事的另一条名字', () => {
  it('英文那条后到：不新增行，英文名进 `source_label_en`', () => {
    const database = setup()
    const base = {
      countryCode: 'US', periodKey: '2026-11-16T13:30', scheduledDate: '2026-11-16', timePrecision: 'minute' as const,
      status: 'published' as const, identityKind: 'source' as const, valuesJson: '{"actual":"7.8"}',
      sourceProviderId: '0xrouter', parserVersion: 'v1', observedAt: now, firstSeenAt: now, eventType: 'economic-indicator' as const
    }
    upsertCalendarStandardRow(database, { ...base, metricKey: '["214790",79095]', sourceLabel: ZH, sourceEventId: '78995' })
    upsertCalendarStandardRow(database, { ...base, metricKey: '["214790",79090]', sourceLabel: EN, sourceEventId: '78990' })
    const rows = database.prepare('select metric_key, source_label, source_label_en from mi_calendar_events').all() as unknown as Record<string, string>[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.source_label).toBe(ZH)
    expect(rows[0]!.source_label_en).toBe(EN)
  })

  it('英文先到、中文后到：显示名挪成中文，英文原文名不丢', () => {
    const database = setup()
    const target = resolveSameSourceIdentityTarget(database, {
      countryCode: 'US', sourceProviderId: '0xrouter', metricKey: '["214790",79095]', periodKey: '2026-11-16T13:30'
    })
    expect(target).toBeUndefined()
    expect(sourceLabelsForWrite(undefined, EN)).toEqual({ sourceLabel: EN, sourceLabelEn: null })
    expect(sourceLabelsForWrite({ metricKey: '["214790",79090]', periodKey: 'p', firstScheduledDate: 'd',
      sourceLabel: EN, sourceLabelEn: null }, ZH)).toEqual({ sourceLabel: ZH, sourceLabelEn: EN })
    // 中文名已经在显示位上，英文名后到时不许把它换掉。
    expect(sourceLabelsForWrite({ metricKey: 'm', periodKey: 'p', firstScheduledDate: 'd',
      sourceLabel: ZH, sourceLabelEn: null }, EN)).toEqual({ sourceLabel: ZH, sourceLabelEn: EN })
  })

  it('周度指标同月多次发布不认回：期次不同就是两次发布', () => {
    const database = setup()
    const base = {
      countryCode: 'US', metricKey: '["214634",78802]', scheduledDate: '2026-11-06', timePrecision: 'date' as const,
      status: 'published' as const, identityKind: 'source' as const, valuesJson: '{}',
      sourceProviderId: '0xrouter', parserVersion: 'v1', observedAt: now, firstSeenAt: now
    }
    upsertCalendarStandardRow(database, { ...base, periodKey: '2026-11-06', sourceEventId: 'a' })
    upsertCalendarStandardRow(database, { ...base, periodKey: '2026-11-13', sourceEventId: 'b' })
    expect((database.prepare('select count(*) n from mi_calendar_events').get() as { n: number }).n).toBe(2)
  })
})

describe('表里从两条变一条之后，名字仍然两种都搜得到', () => {
  it('中文名显示，搜 `New York Fed` 与搜「纽约联储」各命中 1 条', () => {
    const database = setup()
    insertRaw(database, { metricKey: '["214790",79090]', periodKey: '2026-11-16T13:30', label: EN, actual: '7.8' })
    insertRaw(database, { metricKey: '["214790",79095]', periodKey: '2026-11-16T13:30', label: ZH, actual: '7.8' })
    mergeSameSourceNameRows(database)
    const all = readCalendarEventIndex(database, { today: '2026-11-17' })
    expect(all.state).toBe('available')
    if (all.state !== 'available') return
    expect(all.total).toBe(1)
    expect(all.rows[0]!.sourceLabel).toBe(ZH)
    const english = readCalendarEventIndex(database, { today: '2026-11-17', nameQuery: 'New York Fed' })
    const chinese = readCalendarEventIndex(database, { today: '2026-11-17', nameQuery: '纽约联储' })
    expect(english.state === 'available' ? english.total : -1).toBe(1)
    expect(chinese.state === 'available' ? chinese.total : -1).toBe(1)
  })
})
