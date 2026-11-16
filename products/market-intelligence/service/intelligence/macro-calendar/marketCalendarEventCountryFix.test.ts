import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { eventCountryFixes, fixCalendarEventCountries } from './marketCalendarEventCountryFix'
import { ensureCalendarStandardTables } from './marketCalendarStandardTable'

/**
 * 事件行的国家按**机构**归属，不按开会地点（15 号文档 §八）：
 * 威廉姆斯在欧洲央行会议上讲仍是 `USA`，拉加德/连恩归 `EMU`（不是 `EU`——`EU` 含非欧元国，
 * 混用会让「欧元区 CPI」与「欧盟 CPI」撞成一个身份）。
 */
const now = '2026-11-17T03:00:00.000Z'

function setup(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  database.exec('create table if not exists mi_macro_calendar_migrations (version integer primary key)')
  return database
}

function seed(database: DatabaseSync, sourceId: string, countryCode: string): void {
  database.prepare(`insert into mi_calendar_events
    (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, time_precision,
     status, identity_kind, source_label, value_state, values_json, source_provider_id, source_event_id,
     parser_version, observed_at, first_seen_at, event_type, release_count)
    values (?, ?, '2026-11-17', '2026-11-17', '2026-11-17', 'date', 'scheduled', 'source', ?, 'missing', '{}',
      '0xrouter', ?, 'v1', ?, ?, 'central-bank-activity', 1)`)
    .run(countryCode, `["${sourceId}",79090]`, `事件 ${sourceId}`, `x-${sourceId}`, now, now)
}

describe('事件国家按机构归属', () => {
  it('威廉姆斯归 USA、拉加德与连恩归 EMU；跑第二遍 0 变更、行数守恒', () => {
    const database = setup()
    seed(database, '45051', 'DE')
    seed(database, '45023', 'US')
    seed(database, '45145', 'US')
    const report = fixCalendarEventCountries(database)
    expect(report.updated).toBe(3)
    const countryOf = (id: string): string => (database.prepare(`select country_code from mi_calendar_events
      where metric_key = ?`).get(`["${id}",79090]`) as { country_code: string }).country_code
    expect(countryOf('45051')).toBe('USA')
    expect(countryOf('45023')).toBe('EMU')
    expect(countryOf('45145')).toBe('EMU')
    expect((database.prepare('select count(*) n from mi_calendar_events').get() as { n: number }).n).toBe(3)
    expect(fixCalendarEventCountries(database)).toEqual({ scanned: 0, updated: 0 })
  })

  it('表格里没有 EU：欧元区一律写 EMU（EU 含非欧元国，混用会撞身份）', () => {
    expect(Object.values(eventCountryFixes)).not.toContain('EU')
    expect(Object.values(eventCountryFixes)).toContain('EMU')
  })

  it('已经是正确国家的行不动（幂等的另一半：不是「改过就算」）', () => {
    const database = setup()
    seed(database, '45051', 'USA')
    expect(fixCalendarEventCountries(database).updated).toBe(0)
  })
})
