import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'

import { readCalendarFreshnessFromJobRuns } from './marketCalendarFreshnessFromJobs'
import { createCalendarStandardWriteLayer } from './calendarStandardWriteLayer'
import { reportWriteFailure, backfillStandardRowsFromObservations } from './marketCalendarStandardBackfill'
import { ensureCalendarStandardTables } from './marketCalendarStandardTable'

/**
 * #32 验收（用户 2026-11-19）：**真的把写库失败造出来**，不是只测分支。
 * 造法：表都在、把 `mi_calendar_events` 删掉 → 每一行写入抛错 → 失败码 `standard-write-failed`。
 */
const at = '2026-11-19T12:00:00.000Z'
const providerId = '0xrouter'

function seedStore() {
  // 写入层：成功也建记录（这里先给 0xrouter 一条成功记录，后面才可能有 lastFailure）。
  const writeLayer = createCalendarStandardWriteLayer()
  writeLayer.recordAttempt({ writerId: '0xrouter', at: '2026-11-19T11:00:00.000Z', outcome: { state: 'succeeded' } })
  return writeLayer
}

function brokenDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  database.exec(`create table mi_macro_calendar_market_event_observations (
    source_event_id text, provider_id text, market_fact_key text, display_name text, country_code text,
    indicator_id text, event_kind text, scheduled_date text, scheduled_at text, consensus_json text,
    provider_previous_json text, provider_actual_json text, importance text, measure_keys_json text,
    last_seen_at text)`)
  database.prepare(`insert into mi_macro_calendar_market_event_observations
    (source_event_id, provider_id, market_fact_key, display_name, country_code, indicator_id, event_kind,
     scheduled_date, scheduled_at, consensus_json, provider_previous_json, provider_actual_json,
     importance, measure_keys_json, last_seen_at)
    values ('[\"77\",1]', '0xrouter', null, 'CPI yoy (Sep)', 'USA', '77', 'economic-indicator',
      '2026-10-15', '2026-10-15T12:30:00.000Z', null, null, '3.5', 'high', null, '2026-11-14T00:00:00.000Z')`).run()
  // 写库失败：给标准表挂一个「插入即中止」的触发器——表结构完好（前置查询照常跑），
  // 只有真正落库那一步抛错。这正是「采到了没写进去」的形态。
  database.exec(`create trigger fail_insert before insert on mi_calendar_events
    begin select raise(abort, 'injected write failure'); end`)
  return database
}

describe('#32 写库失败真的能被看见', () => {
  it('回填写入点：造一次 standard-write-failed → 健康记录有 lastWriteFailure、status 不变、日志一行', () => {
    const writeLayer = seedStore()
    const log = vi.fn()
    const report = backfillStandardRowsFromObservations(brokenDatabase(), { providerId, writeLayer, log, observedAt: at })
    expect(report.written).toBe(0)
    // 失败记进**写入层**；采集健康那一列一个字都不动（这里根本没有健康记录）。
    expect(writeLayer.get('0xrouter')!.lastFailure).toMatchObject({ at, firstErrorCode: 'standard-write-failed' })
    expect(writeLayer.get('0xrouter')!.lastSuccessAt).toBe('2026-11-19T11:00:00.000Z')
    expect(log).toHaveBeenCalledWith('warn', 'macro-calendar.standard.write-failed',
      expect.objectContaining({ firstErrorCode: 'standard-write-failed', recorded: true }))
  })

  it('同一处共享 helper 也被官方行写入点调用（recorded=false 表示没有既有健康记录、不编）', () => {
    const log = vi.fn()
    expect(reportWriteFailure(undefined, log, 'macro-calendar-bea',
      { failed: 2, firstErrorCode: 'standard-write-failed' }, at)).toBe(true)
    expect(log).toHaveBeenCalledWith('warn', 'macro-calendar.standard.write-failed',
      expect.objectContaining({ recorded: false, failedRows: 2 }))
  })

  it('freshness 返回值带出 writeFailure（简报线依赖的键）', () => {
    const freshness = readCalendarFreshnessFromJobRuns({
      lastWrittenAt: '2026-11-19T10:00:00.000Z', asOf: at,
      lastWriteFailure: { at, firstErrorCode: 'standard-write-failed' }
    })
    expect(freshness.writeFailure).toEqual({ at, code: 'standard-write-failed' })
  })

  it('没有失败 → freshness 不带这个键（可选键，不编）', () => {
    const freshness = readCalendarFreshnessFromJobRuns({ lastWrittenAt: null, asOf: at })
    expect('writeFailure' in freshness).toBe(false)
  })
})
