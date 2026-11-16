import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables } from '../marketCalendarStandardTable'
import { readSourceValueConflicts } from './marketCalendarSourceConflictsRead'

/**
 * #40 的边界（用户 2026-11-17 定）：**同一发布日、同一字段、两侧都有值且不相等 → 并列 + 标记**。
 *
 * 三条都必须红证：一侧缺值不算冲突（否则标记天天空亮）、不判对错不挑一个（期次不可跨源比较 #56、
 * 单位没入库 #57）、配对键用 `scheduled_date`（`period_key` 跨源不可比）。
 */
const now = '2026-11-17T07:00:00.000Z'

function setup(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  return database
}

/**
 * **两家同身份还必须期次不同才能共存**：标准表主键是 `(国家, 指标码, 期次, 首发布日)`。
 * 真实库里正是这样——narwhal 记统计月 `2026-09`、0xrouter 记发布时刻，所以它们能同一天各占一行。
 * 夹具必须照这个形状造，否则造出来的「多来源组」在真库里根本不存在。
 */
function seed(database: DatabaseSync, providerId: string, metricKey: string,
  scheduledDate: string, values: Record<string, string>, periodKey = 'p', firstScheduled = ''): void {
  database.prepare(`insert into mi_calendar_events
    (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, time_precision, status,
     identity_kind, source_label, value_state, values_json, source_provider_id, source_event_id, parser_version,
     observed_at, first_seen_at, event_type, release_count)
    values ('US', ?, ?, ?, ?, 'date', 'published', 'code', 'x', 'present', ?, ?, ?, 'v1', ?, ?,
      'economic-indicator', 1)`).run(metricKey, periodKey, scheduledDate, firstScheduled || scheduledDate, JSON.stringify(values), providerId,
    `${providerId}-${metricKey}-${periodKey}`, now, now)
}

describe('#40 多源不一致', () => {
  it('两家都有值且不等 → 并列；只有一家有值 → 不算冲突', () => {
    const database = setup()
    // **同期两源**只能靠不同的首发布日共存（主键含它）：这才是「同一期、两个来源」的形状。
    seed(database, 'narwhal', 'US.X.SA.MOM', '2026-11-16', { consensus: '10', previous: '25.5' }, '2026-10', '2026-11-16')
    seed(database, '0xrouter', 'US.X.SA.MOM', '2026-11-16', { consensus: '18', previous: '25.5', actual: '7.8' }, '2026-10', '2026-11-17')
    const read = readSourceValueConflicts(database, { scheduledDate: '2026-11-16' })
    if (read.state !== 'available') throw new Error('unavailable')
    expect(read.multiSourceGroups).toBe(1)
    // 只有预期不一致：实际只有 0xrouter 给（一侧缺值不算冲突）、前值两家相同（不算冲突）。
    expect(read.conflicts).toHaveLength(1)
    expect(read.conflicts[0]).toMatchObject({ field: 'consensus', values: { narwhal: '10', '0xrouter': '18' } })
  })

  it('**同一发布日、期次不同**不是冲突：那是两条不同期的发布（消费信贷那组）', () => {
    const database = setup()
    seed(database, 'narwhal', 'US.CONSUMER_CREDIT.SA.CHANGE', '2026-11-06', { actual: '6.4', previous: '1.9' }, '2026-09')
    seed(database, '0xrouter', 'US.CONSUMER_CREDIT.SA.CHANGE', '2026-11-06', { actual: '27.84', previous: '8.280' }, '2026-10')
    const read = readSourceValueConflicts(database, { scheduledDate: '2026-11-06' })
    if (read.state !== 'available') throw new Error('unavailable')
    // 6.4 与 27.84 是「9 月」和「10 月」两个数——并列成「不一致」等于凭空造事实。
    expect(read.conflicts).toEqual([])
    expect(read.multiSourceGroups).toBe(0)
  })

  it('单一来源的日期没有任何冲突；期次写法不可比时以 scheduled_date 配对', () => {
    const database = setup()
    seed(database, 'narwhal', 'US.Y.SA.MOM', '2026-11-16', { actual: '1' })
    const read = readSourceValueConflicts(database, { scheduledDate: '2026-11-16' })
    if (read.state !== 'available') throw new Error('unavailable')
    expect(read.multiSourceGroups).toBe(0)
    expect(read.conflicts).toEqual([])
    expect(readSourceValueConflicts(database, { scheduledDate: '11/16' }))
      .toEqual({ state: 'unavailable', reasonCode: 'query-input-invalid' })
  })
})
