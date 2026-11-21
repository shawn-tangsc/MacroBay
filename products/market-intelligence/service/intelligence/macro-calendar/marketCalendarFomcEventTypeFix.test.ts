import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { fixFomcEventTypes } from './marketCalendarFomcEventTypeFix'
import { ensureCalendarStandardTables } from './marketCalendarStandardTable'

/**
 * `US.FOMC.<日期>` 是**事件**（类型 + 日期），不是经济指标。
 *
 * 真库里 57 行被标成 `economic-indicator`，于是被计入指标数、进分级、参与指标口径统计。
 * 判据同时锁住两头：改完这类行不再出现 `economic-indicator`；**身份一个字没变**。
 */
const now = '2026-11-17T07:00:00.000Z'

function setup(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  database.exec('create table if not exists mi_macro_calendar_migrations (version integer primary key)')
  return database
}

function seed(database: DatabaseSync, metricKey: string, eventType: string): void {
  database.prepare(`insert into mi_calendar_events
    (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, time_precision,
     status, identity_kind, source_label, value_state, values_json, source_provider_id, source_event_id,
     parser_version, observed_at, first_seen_at, event_type, release_count)
    values ('US', ?, '2026-12', '2026-12-09', '2026-12-09', 'date', 'scheduled', 'code', '议息会议',
      'missing', '{}', 'narwhal', ?, 'v1', ?, ?, ?, 1)`).run(metricKey, metricKey, now, now, eventType)
}

describe('FOMC 各次会议的类别', () => {
  it('57 类行改为央行活动，身份不变；跑第二遍 0 变更', () => {
    const database = setup()
    seed(database, 'US.FOMC.2026-12-09', 'economic-indicator')
    seed(database, 'US.CPI.NSA.YOY', 'economic-indicator')
    const report = fixFomcEventTypes(database)
    expect(report).toEqual({ scanned: 1, updated: 1 })
    const rows = database.prepare('select metric_key, event_type from mi_calendar_events order by metric_key')
      .all() as unknown as { metric_key: string; event_type: string }[]
    // 身份没动、只改类别；普通指标一行没被碰。
    expect(rows).toEqual([
      { metric_key: 'US.CPI.NSA.YOY', event_type: 'economic-indicator' },
      { metric_key: 'US.FOMC.2026-12-09', event_type: 'central-bank-activity' }
    ])
    expect(fixFomcEventTypes(database)).toEqual({ scanned: 0, updated: 0 })
  })

  it('身份形状不是 `US.FOMC.<日期>` 的不动（`US.FOMC` 这种没有日期）', () => {
    const database = setup()
    seed(database, 'US.FOMC', 'economic-indicator')
    expect(fixFomcEventTypes(database).updated).toBe(0)
  })

  it('跑过一次之后新来的同类行照样被改：判据是当前缺口，不是版本标记', () => {
    const database = setup()
    seed(database, 'US.FOMC.2026-12-09', 'economic-indicator')
    expect(fixFomcEventTypes(database).updated).toBe(1)
    // 下一场会议到了：`backfillCalendarEventTypes` 的前缀规则（不以 `evt.` 开头 ⇒ 经济指标）
    // 会把它补成 `economic-indicator`，所以这个形状每天都能再出现。
    seed(database, 'US.FOMC.2027-01-27', 'economic-indicator')
    expect(fixFomcEventTypes(database)).toEqual({ scanned: 1, updated: 1 })
    const types = database.prepare("select event_type from mi_calendar_events where metric_key like 'US.FOMC.2027%'")
      .all() as unknown as { event_type: string }[]
    expect(types).toEqual([{ event_type: 'central-bank-activity' }])
  })
})
