import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { backfillCalendarEventTypes } from './marketCalendarEventTypeBackfill'
import { ensureCalendarStandardTables } from './marketCalendarStandardTable'

/**
 * 回填的判据是**当前缺口**，不是「跑过一次」。
 *
 * 今晚的真因：入口有一道版本闸，第一次跑完写个标记就永远返回，于是之后每次采集新进来的行都留着
 * 空的 `event_type`——标记在、缺口也在，两边看起来都正常，而且没有任何地方会报错。
 */
const now = '2026-11-17T03:00:00.000Z'

function setup(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  database.exec('create table if not exists mi_macro_calendar_migrations (version integer primary key)')
  database.exec(`create table if not exists mi_macro_calendar_market_event_observations (
    source_event_id text not null, event_kind text not null, importance text, provider_id text)`)
  return database
}

function insertEvent(database: DatabaseSync, id: string): void {
  database.prepare(`insert into mi_calendar_events
    (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, time_precision,
     status, identity_kind, source_label, value_state, values_json, source_provider_id, source_event_id,
     parser_version, observed_at, first_seen_at, release_count)
    values ('DE', ?, '2026-11', '2026-11-20', '2026-11-20', 'date', 'scheduled', 'source', '德国指标', 'missing', '{}',
      '0xrouter', ?, 'v1', ?, ?, 1)`).run(`["${id}",79090]`, `["${id}",79090]`, now, now)
  database.prepare('insert into mi_macro_calendar_market_event_observations values (?, ?, ?, ?)')
    .run(`["${id}",79090]`, 'economic-indicator', 'high', '0xrouter')
}

describe('事件类型回填按缺口跑', () => {
  it('第一次补完后再来一批新行，第二次仍然会补——不是「跑过一次就跳过」', () => {
    const database = setup()
    insertEvent(database, '214811')
    expect(backfillCalendarEventTypes(database).eventTypeFilled).toBe(1)

    // 采集又写进来一行新的（真实场景：每次采集都会有新行）
    database.prepare(`insert into mi_calendar_events
      (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, time_precision,
       status, identity_kind, source_label, value_state, values_json, source_provider_id, source_event_id,
       parser_version, observed_at, first_seen_at, release_count)
      values ('DE', '["214814",79091]', '2026-11', '2026-11-20', '2026-11-20', 'date', 'scheduled', 'source',
        '德国指标', 'missing', '{}', '0xrouter', '["214814",79091]', 'v1', ?, ?, 1)`).run(now, now)
    database.prepare('insert into mi_macro_calendar_market_event_observations values (?, ?, ?, ?)')
      .run('["214814",79091]', 'central-bank-activity', null, '0xrouter')

    const second = backfillCalendarEventTypes(database)
    expect(second.pending).toBe(1)
    expect(second.eventTypeFilled).toBe(1)
    const types = database.prepare('select event_type from mi_calendar_events order by metric_key').all() as { event_type: string }[]
    expect(types.map((row) => row.event_type)).toEqual(['economic-indicator', 'central-bank-activity'])
  })

  it('没有缺口时返回 0，并且不留版本标记（否则下次又会「标记在、缺口在」）', () => {
    const database = setup()
    insertEvent(database, '214811')
    backfillCalendarEventTypes(database)
    expect(backfillCalendarEventTypes(database)).toMatchObject({ pending: 0, eventTypeFilled: 0 })
    const markers = database.prepare('select count(*) n from mi_macro_calendar_migrations').get() as { n: number }
    expect(markers.n).toBe(0)
  })
})
