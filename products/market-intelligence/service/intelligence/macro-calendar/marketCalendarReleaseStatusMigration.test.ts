import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureReleaseStatusCheckExtended } from './marketCalendarReleaseStatusMigration'

/**
 * v13 重建表（状态 CHECK 四值 → 五值）的**列保全**（Chief 2026-11-21 发现 #18 的连带缺陷）。
 *
 * 重建用的是当年手写的列清单：之后加进这张表的列（`data_observed_at`、缺值原因三列、
 * `event_type`、`source_release_id`…）如果不在清单里，**会被整列丢掉**——数据没了，
 * 同一次启动里后面的规范化与盘点每条都报 `no such column`，而异常被启动链吞掉，
 * 现场只剩「这条迁移失败，下次启动重试」。
 */
const PRE_V13_EVENTS_DDL = `create table mi_calendar_events (
  country_code text not null, metric_key text not null, period_key text not null,
  scheduled_date text not null, first_scheduled_date text not null, scheduled_at text,
  time_precision text not null check(time_precision in ('minute', 'date')),
  status text not null default 'unknown'
    check(status in ('scheduled', 'published', 'cancelled', 'unknown')),
  identity_kind text not null default 'code' check(identity_kind in ('code', 'source')),
  source_label text, series_id text,
  importance text check(importance in ('high', 'medium', 'low')),
  value_state text check(value_state in ('present', 'missing')),
  row_kind text not null default 'release' check(row_kind in ('release', 'estimate')),
  values_json text not null, source_provider_id text not null, source_event_id text not null,
  parser_version text not null, observed_at text not null, first_seen_at text not null,
  first_published_actual text, first_published_previous text,
  source_label_en text, release_dates_json text, release_count integer not null default 1,
  event_type text, source_release_id text, data_observed_at text,
  missing_reason text, missing_basis text, missing_review_at text,
  primary key(country_code, metric_key, period_key, first_scheduled_date))`

const seed = (database: DatabaseSync): void => {
  database.prepare(`insert into mi_calendar_events
    (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, time_precision,
     status, values_json, source_provider_id, source_event_id, parser_version, observed_at, first_seen_at,
     data_observed_at, missing_reason, event_type, source_release_id)
    values ('US', 'US.CPI.NSA.YOY', '2026-10', '2026-11-10', '2026-11-10', 'date',
      'published', '{"actual":"3.7"}', '0xrouter', 'x-1', 'v1',
      '2026-11-10T13:31:00.000Z', '2026-11-10T13:31:00.000Z',
      '2026-11-09T21:00:00.000Z', 'source-no-value', 'economic-indicator', 'release-7')`).run()
}

describe('v13 状态 CHECK 重建：列与值一个都不许丢', () => {
  it('重建后后加列仍在，旧行的数据时刻与缺值原因原样保留', () => {
    const database = new DatabaseSync(':memory:')
    database.exec('create table mi_macro_calendar_migrations (version integer primary key)')
    database.exec(PRE_V13_EVENTS_DDL)
    database.exec(`create view mi_calendar_releases as select * from mi_calendar_events where row_kind = 'release'`)
    seed(database)
    expect(ensureReleaseStatusCheckExtended(database)).toBe(true)
    const columns = (database.prepare("select name from pragma_table_info('mi_calendar_events')").all() as
      { name: string }[]).map((column) => column.name)
    for (const name of ['data_observed_at', 'missing_reason', 'missing_basis', 'missing_review_at',
      'event_type', 'source_release_id', 'release_count', 'release_dates_json', 'source_label_en']) {
      expect(columns).toContain(name)
    }
    const row = database.prepare(`select data_observed_at, missing_reason, event_type, source_release_id
      from mi_calendar_events where source_event_id = 'x-1'`).get() as Record<string, string | null>
    expect(row).toMatchObject({
      data_observed_at: '2026-11-09T21:00:00.000Z', missing_reason: 'source-no-value',
      event_type: 'economic-indicator', source_release_id: 'release-7'
    })
    // 旧表留作回滚点、视图指向正名。
    expect(database.prepare("select name from sqlite_master where type='table' and name='mi_calendar_events__pre_v13'")
      .get()).toBeDefined()
    const view = database.prepare("select sql from sqlite_master where type='view' and name='mi_calendar_releases'")
      .get() as { sql: string }
    expect(view.sql).not.toContain('__pre_v13')
  })

  it('第二次调用返回 false（幂等），行数不变', () => {
    const database = new DatabaseSync(':memory:')
    database.exec(PRE_V13_EVENTS_DDL)
    database.exec(`create view mi_calendar_releases as select * from mi_calendar_events where row_kind = 'release'`)
    seed(database)
    ensureReleaseStatusCheckExtended(database)
    const count = (): number => Number((database.prepare('select count(*) n from mi_calendar_events')
      .get() as { n: number }).n)
    expect(ensureReleaseStatusCheckExtended(database)).toBe(false)
    expect(count()).toBe(1)
  })
})