import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables } from '../marketCalendarStandardTable'
import { readEventSourceWrites } from './marketCalendarEventSourceWritesRead'

/**
 * 双源读：**修订表给「谁在什么时候写过」，标准表给「现在各来源各是什么值」**。
 * 只读一张都做不出 #47 的验收样本——修订表里没有 narwhal / 0xrouter 的任何一行。
 */
const now = '2026-11-17T07:00:00.000Z'

function setup(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  database.exec(`create table if not exists mi_macro_calendar_revisions (
    revision_id text primary key, event_key text not null, provider_id text not null, scheduled_date text,
    lifecycle_state text not null, consensus_json text, actual_json text, previous_json text, detected_at text)`)
  return database
}

function seedStandard(database: DatabaseSync, metricKey: string, providerId: string,
  status: string, values: Record<string, string>): void {
  database.prepare(`insert into mi_calendar_events
    (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, time_precision, status,
     identity_kind, source_label, value_state, values_json, source_provider_id, source_event_id, parser_version,
     observed_at, first_seen_at, event_type, release_count)
    values ('US', ?, '2026-11', '2026-11-16', '2026-11-16', 'date', ?, 'source', 'x', 'present', ?, ?, ?,
      'v1', ?, ?, 'economic-indicator', 1)`).run(metricKey, status, JSON.stringify(values), providerId,
    `${providerId}-${metricKey}`, now, now)
}

describe('按事件身份取各来源', () => {
  it('帝国大厦那期：标准表两个来源都在，且每行标明是「当前观测」不是「写入记录」', () => {
    const database = setup()
    // 0xrouter 的数组身份 `214790` 通过映射认得这个码；narwhal 直接用码。
    seedStandard(database, 'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL', 'narwhal', 'backfilling', { consensus: '10', previous: '25.5' })
    seedStandard(database, '["214790",79095]', '0xrouter', 'published', { consensus: '18.0', actual: '7.8', previous: '25.5' })
    const read = readEventSourceWrites(database, { metricKey: 'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL' })
    if (read.state !== 'available') throw new Error('unavailable')
    expect(read.providerCount).toBe(2)
    expect(read.rows.every((row) => row.source === 'observation')).toBe(true)
    expect(read.hasRevisionChain).toBe(false)
    const narwhal = read.rows.find((row) => row.providerId === 'narwhal')!
    expect(narwhal).toMatchObject({ status: 'backfilling', consensus: '10', actual: null })
    const router = read.rows.find((row) => row.providerId === '0xrouter')!
    expect(router).toMatchObject({ status: 'published', consensus: '18.0', actual: '7.8' })
  })

  it('修订表里的官方写入记录标成 revision，值取 displayValue；两种来源不混成一句', () => {
    const database = setup()
    database.prepare(`insert into mi_macro_calendar_revisions (revision_id, event_key, provider_id, scheduled_date,
      lifecycle_state, actual_json, detected_at) values ('r1','US.FOMC.2026-10-28','macro-calendar-fed','2026-10-30',
      'released','{"displayValue":"3.75%–4.00%"}','2026-10-30T00:00:00.000Z')`).run()
    const read = readEventSourceWrites(database, { metricKey: 'US.FOMC.2026-10-28' })
    if (read.state !== 'available') throw new Error('unavailable')
    expect(read.rows).toHaveLength(1)
    expect(read.rows[0]).toMatchObject({ source: 'revision', providerId: 'macro-calendar-fed', actual: '3.75%–4.00%' })
    expect(read.hasRevisionChain).toBe(true)
  })

  it('什么都没有时是「读不到」，不是空数组', () => {
    const database = setup()
    expect(readEventSourceWrites(database, { metricKey: 'US.NOPE.SA.MOM' }))
      .toEqual({ state: 'unavailable', reasonCode: 'query-unavailable' })
    expect(readEventSourceWrites(database, { metricKey: '' }))
      .toEqual({ state: 'unavailable', reasonCode: 'query-input-invalid' })
  })
})
