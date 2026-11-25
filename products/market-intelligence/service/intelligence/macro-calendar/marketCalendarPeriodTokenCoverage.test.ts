import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { isCalendarPeriodToken } from './marketCalendarPeriodKey'
import { normalizeOfficialPeriodKey } from './marketCalendarOfficialSourceRows'
import { replayOfficialHistoryIntoStandardTable } from './marketCalendarOfficialHistoryReplay'
import { backfillStandardRowsFromObservations } from './marketCalendarStandardBackfill'
import { ensureCalendarStandardTables } from './marketCalendarStandardTable'
import { zeroXRouterCanonicalIdentity } from './marketCalendarMetricIdentity'

/**
 * **期次令牌的覆盖守卫**（架构师 2026-11-24 复核）。
 *
 * 回放与启动规范化靠 `isCalendarPeriodToken` 区分「这是期次」和「这不是期次」（`SECOND` 这类
 * 修订序号）。令牌集合少一种形状，那个形状的行就会被当成「没解析」反复重算、甚至与正常行分家。
 *
 * 所以五条**真的会产出期次**的路径各钉一例：它们的输出必须被判成令牌。将来加新形状却忘了扩
 * 令牌集合，这里当场红，而不是等库里的行悄悄分成两期。
 */
describe('期次令牌覆盖：五条产期次的路径', () => {
  /** 只放回放要读的那几列：这是一张最小的修订表，不是生产 schema 的副本。 */
  function replayDatabase(revisions: readonly Readonly<{ eventKey: string; eventFamily: string
    eventNameKey: string; scheduledDate: string; periodKey: string }>[]): DatabaseSync {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    database.exec(`create table mi_macro_calendar_revisions (
      event_key text not null, event_family text not null, event_name_key text not null,
      scheduled_date text not null, scheduled_at text, lifecycle_state text not null,
      actual_json text, previous_json text, consensus_json text,
      detected_at_ms integer not null, recorded_at text not null)`)
    const insert = database.prepare(`insert into mi_macro_calendar_revisions
      (event_key, event_family, event_name_key, scheduled_date, scheduled_at, lifecycle_state,
       actual_json, previous_json, consensus_json, detected_at_ms, recorded_at)
      values (?, ?, ?, ?, null, 'released', null, null, null, 1, '2026-11-01T00:00:00.000Z')`)
    for (const revision of revisions) {
      insert.run(revision.eventKey, revision.eventFamily, revision.eventNameKey, revision.scheduledDate)
    }
    return database
  }

  const periodOf = (database: DatabaseSync, metricKey: string): string => {
    replayOfficialHistoryIntoStandardTable(database)
    const row = database.prepare('select period_key from mi_calendar_events where metric_key = ?')
      .get(metricKey) as { period_key: string } | undefined
    if (row === undefined) throw new Error(`没落表：${metricKey}`)
    return String(row.period_key)
  }

  it('月：官方 `2026-M10` 归一（YYYY-MM）与 0xrouter 统计月都落在令牌里', () => {
    const official = normalizeOfficialPeriodKey('2026-M10')
    expect(official).toBe('2026-10')
    expect(isCalendarPeriodToken(official)).toBe(true)
    const source = zeroXRouterCanonicalIdentity({
      countryCode: 'US', indicatorId: '8637', scheduledAt: '2026-11-12T13:30:00.000Z'
    })
    expect(isCalendarPeriodToken(String(source?.periodKey))).toBe(true)
  })

  it('季：回放从 `US.GDP.2026-Q3.SECOND` 取到 `2026-Q3`', () => {
    const database = replayDatabase([{ eventKey: 'US.GDP.2026-Q3.SECOND', eventFamily: 'gdp',
      eventNameKey: 'gdp', scheduledDate: '2026-11-25', periodKey: '2026-Q3' }])
    const period = periodOf(database, 'US.GDP.SA.ANNUALIZED_QOQ')
    expect(period).toBe('2026-Q3')
    expect(isCalendarPeriodToken(period)).toBe(true)
  })

  it('日：回放 FOMC 那类事件行用会议当天（YYYY-MM-DD）', () => {
    const database = replayDatabase([{ eventKey: 'US.FOMC.2026-12-09', eventFamily: 'fomc',
      eventNameKey: 'fomc', scheduledDate: '2026-12-09', periodKey: '2026-12-09' }])
    const period = periodOf(database, 'US.FOMC.2026-12-09')
    expect(period).toBe('2026-12-09')
    expect(isCalendarPeriodToken(period)).toBe(true)
  })

  it('年：年度口径的事件键（`US.GDP.2026`）产出 `2026`，不是空壳', () => {
    const database = replayDatabase([{ eventKey: 'US.GDP.2026', eventFamily: 'gdp',
      eventNameKey: 'gdp', scheduledDate: '2027-01-28', periodKey: '2026' }])
    const period = periodOf(database, 'US.GDP.SA.ANNUALIZED_QOQ')
    expect(period).toBe('2026')
    expect(isCalendarPeriodToken(period)).toBe(true)
  })

  it('事件时刻：回填的 event 分支写到分钟（`YYYY-MM-DDTHH:MM`）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    database.exec(`create table mi_macro_calendar_market_event_observations (
      source_event_id text not null, provider_id text not null, market_fact_key text,
      display_name text not null, country_code text,
      indicator_id text, event_kind text not null, scheduled_date text not null, scheduled_at text,
      consensus_json text, provider_previous_json text, provider_actual_json text, importance text not null,
      measure_keys_json text, last_seen_at text)`)
    // 央行讲话：事件型身份，名字在事件码表里；没有值 → 走 event 分支，期次用时刻本身。
    database.prepare(`insert into mi_macro_calendar_market_event_observations
      (source_event_id, provider_id, market_fact_key, display_name, country_code, indicator_id, event_kind,
       scheduled_date, scheduled_at, consensus_json, provider_previous_json, provider_actual_json,
       importance, measure_keys_json, last_seen_at)
      values ('e-1', '0xrouter', null, 'Central bank speech', 'USA', '44656', 'central-bank-activity',
        '2026-11-17', '2026-11-17T14:00:00.000Z', null, null, null, 'low', '[]', '2026-11-17T15:00:00.000Z')`).run()
    const report = backfillStandardRowsFromObservations(database, {
      providerId: '0xrouter', observedAt: '2026-11-18T00:00:00.000Z'
    })
    expect(report.event).toBe(1)
    const row = database.prepare("select period_key from mi_calendar_events where metric_key = 'evt.central-bank-speech'")
      .get() as { period_key: string }
    expect(row.period_key).toBe('2026-11-17T14:00')
    expect(isCalendarPeriodToken(row.period_key)).toBe(true)
  })
})