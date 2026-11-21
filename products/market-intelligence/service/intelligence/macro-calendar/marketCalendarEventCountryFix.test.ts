import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { eventCountryFixes, fixCalendarEventCountries } from './marketCalendarEventCountryFix'
import { ensureCalendarStandardTables } from './marketCalendarStandardTable'

/**
 * 事件行的国家按**机构**归属，不按开会地点（15 号文档 §八）：
 * 威廉姆斯在欧洲央行会议上讲仍是 `US`，拉加德/连恩归 `EMU`（不是 `EU`——`EU` 含非欧元国，
 * 混用会让「欧元区 CPI」与「欧盟 CPI」撞成一个身份）。
 *
 * 这一条是**每次启动都跑**的长期规则，不是一次性迁移：过去写成一次性迁移，11-17 之后新采集的
 * 同类事件又按源给的国家落了一批，规则再也没跑。
 */
const now = '2026-11-19T03:00:00.000Z'

function setup(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  database.exec('create table if not exists mi_macro_calendar_migrations (version integer primary key)')
  return database
}

type SeedOptions = Readonly<{ valuesJson?: string; identityKind?: 'code' | 'source'; status?: string }>

function seed(database: DatabaseSync, metricKey: string, countryCode: string, options: SeedOptions = {}): void {
  database.prepare(`insert into mi_calendar_events
    (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, time_precision,
     status, identity_kind, source_label, value_state, values_json, source_provider_id, source_event_id,
     parser_version, observed_at, first_seen_at, event_type, release_count)
    values (?, ?, '2026-11-17', '2026-11-17', '2026-11-17', 'date', ?, ?, ?, 'missing', ?,
      '0xrouter', ?, 'v1', ?, ?, 'central-bank-activity', 1)`)
    .run(countryCode, metricKey, options.status ?? 'scheduled', options.identityKind ?? 'source',
      `事件 ${metricKey}`, options.valuesJson ?? '{}', `x-${metricKey}`, now, now)
}

const identity = (sourceId: string): string => `["${sourceId}",79090]`
const seedEvent = (database: DatabaseSync, sourceId: string, countryCode: string, options: SeedOptions = {}): void =>
  seed(database, identity(sourceId), countryCode, options)

function countryOf(database: DatabaseSync, metricKey: string): string {
  const row = database.prepare('select country_code from mi_calendar_events where metric_key = ?')
    .get(metricKey) as { country_code: string }
  return row.country_code
}

function count(database: DatabaseSync, table: string): number {
  return Number((database.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n)
}

describe('事件国家按机构归属', () => {
  it('版本 19 早已记过也照样跑：威廉姆斯归 US、拉加德与连恩归 EMU；第二遍 0 变更', () => {
    const database = setup()
    // 老实现第一句就是 `if (done !== undefined) return`——这条记录就是它的短路条件。
    database.prepare('insert into mi_macro_calendar_migrations(version) values (?)').run(19)
    seedEvent(database, '45051', 'DE')
    seedEvent(database, '45023', 'US')
    seedEvent(database, '45145', 'US')
    const report = fixCalendarEventCountries(database)
    expect(report.updated).toBe(3)
    expect(report.merged).toBe(0)
    expect(countryOf(database, identity('45051'))).toBe('US')
    expect(countryOf(database, identity('45023'))).toBe('EMU')
    expect(countryOf(database, identity('45145'))).toBe('EMU')
    expect(count(database, 'mi_calendar_events')).toBe(3)
    expect(fixCalendarEventCountries(database)).toEqual({
      scanned: 0, updated: 0, merged: 0, invalidIdentities: 0, ambiguousIdentities: []
    })
  })

  /**
   * 数组身份的第二段是数字（`["214790",79090]`）——**整串是合法 JSON**，用 `json_extract` 就能取，
   * 不需要按位置截取。真的非法时（下面这条截断了）**跳过并计数**，不许静默当成「没有身份」。
   */
  it('合法 JSON 照常按第一段取身份；非法 JSON 跳过并计数', () => {
    const database = setup()
    seedEvent(database, '45051', 'DE')
    seed(database, '["45052",79090', 'DE')
    const report = fixCalendarEventCountries(database)
    expect(report.invalidIdentities).toBe(1)
    expect(report.updated).toBe(1)
    expect(countryOf(database, identity('45051'))).toBe('US')
    // 非法那条原样留着（不删、不改国家）——读不出身份不等于可以清理它。
    expect(countryOf(database, '["45052",79090')).toBe('DE')
    expect(count(database, 'mi_calendar_events')).toBe(2)
  })

  it('同一身份挂在两个国家下：改正后只剩一行，另一条整行进审计表', () => {
    const database = setup()
    seedEvent(database, '45051', 'DE')
    seedEvent(database, '45051', 'US')
    const report = fixCalendarEventCountries(database)
    expect(report).toMatchObject({ scanned: 1, updated: 0, merged: 1, ambiguousIdentities: [] })
    expect(count(database, 'mi_calendar_events')).toBe(1)
    expect(countryOf(database, identity('45051'))).toBe('US')
    const audit = database.prepare(`select rule, kept_rowkey, deleted_row_json
      from mi_calendar_events__merge_audit_v1`).all() as Array<Record<string, string>>
    expect(audit).toHaveLength(1)
    expect(audit[0].rule).toBe('event-country-collision/keep-existing-country')
    expect(audit[0].kept_rowkey).toBe(`US|${identity('45051')}|2026-11-17|2026-11-17`)
    // 被删的是那条写错国家的整行，值、状态、来源都在，能回查。
    const deleted = JSON.parse(audit[0].deleted_row_json) as Record<string, string>
    expect(deleted.country_code).toBe('DE')
    expect(deleted.metric_key).toBe(identity('45051'))
  })

  it('候选行有 actual、目标国家那行没有：保留有值的那条（actual 优先），另一条进审计', () => {
    const database = setup()
    seedEvent(database, '45051', 'DE', { valuesJson: '{"actual":"0.1%"}' })
    seedEvent(database, '45051', 'US')
    const report = fixCalendarEventCountries(database)
    expect(report).toMatchObject({ scanned: 1, updated: 1, merged: 1 })
    const kept = database.prepare('select country_code, values_json from mi_calendar_events').all() as Array<Record<string, string>>
    expect(kept).toHaveLength(1)
    expect(kept[0].country_code).toBe('US')
    expect(kept[0].values_json).toBe('{"actual":"0.1%"}')
    const keptRule = database.prepare('select rule from mi_calendar_events__merge_audit_v1').get() as { rule: string }
    expect(keptRule.rule).toBe('event-country-collision/actual-priority')
  })

  it('指标行（码身份）不受影响：规则只认同数组身份的事件行', () => {
    const database = setup()
    seed(database, 'DE.IFO_BUSINESS_CLIMATE.NONE.LEVEL', 'DE', { identityKind: 'code' })
    const report = fixCalendarEventCountries(database)
    expect(report).toMatchObject({ scanned: 0, updated: 0, merged: 0 })
    expect(countryOf(database, 'DE.IFO_BUSINESS_CLIMATE.NONE.LEVEL')).toBe('DE')
    expect(count(database, 'mi_calendar_events')).toBe(1)
  })

  it('表格里没有 EU：欧元区一律写 EMU（EU 含非欧元国，混用会撞身份）', () => {
    expect(Object.values(eventCountryFixes)).not.toContain('EU')
    expect(Object.values(eventCountryFixes)).toContain('EMU')
    // 美国与码表、观测表统一成两位，不许再出现第三套写法。
    expect(Object.values(eventCountryFixes)).not.toContain('USA')
  })

  it('已经是正确国家的行不动（幂等的另一半：不是「改过就算」）', () => {
    const database = setup()
    seedEvent(database, '45051', 'US')
    expect(fixCalendarEventCountries(database)).toMatchObject({ scanned: 0, updated: 0, merged: 0 })
  })
})
