import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { dualWriteMeasureRows } from './marketCalendarStandardDualWrite'
import { ensureCalendarStandardTables } from './marketCalendarStandardTable'
import { calendarValueRevisionMismatches, readCalendarValueRevisions } from './marketCalendarValueRevisionAudit'

/**
 * 来源审计（31 号文档 §3）：谁在什么时候把这一格从 A 改成 B，或者拒绝改。
 * 两条最容易翻车的：**value_before 必须取 upsert 之前的旧值**、**keep:* 的守卫要另判**。
 */
const key = { countryCode: 'US', metricKey: 'US.NONFARM.SA.CHANGE', periodKey: '2026-10', firstScheduledDate: '2026-11-01' }
const write = (database: DatabaseSync, actual: string, providerId: string, observedAt: string) =>
  dualWriteMeasureRows(database, { providerId, parserVersion: 'v1', observedAt, rows: [{
    countryCode: 'US', metricKey: key.metricKey, periodKey: key.periodKey, scheduledDate: key.firstScheduledDate,
    sourceEventId: `x-${providerId}-${observedAt}`, actual, status: 'published' as const
  }] })
const audit = (database: DatabaseSync) => readCalendarValueRevisions(database, key)
const count = (database: DatabaseSync, sql: string) => Number((database.prepare(sql).get() as { n: number }).n)

function setup(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  return database
}

describe('来源审计', () => {
  it('改值写一行、value_before 是旧值；幂等重写同一值 0 行', () => {
    const database = setup()
    write(database, '1.0', '0xrouter', '2026-11-19T01:00:00.000Z')
    expect(audit(database).revisions).toHaveLength(1)
    expect(audit(database).revisions[0]).toMatchObject({ field: 'actual', valueBefore: null, valueAfter: '1.0', decision: 'write' })
    // 第二个来源改成 2.0：再写一行，before 必须是 1.0（**不是刚写进去的 2.0**）。
    write(database, '2.0', 'narwhal', '2026-11-19T02:00:00.000Z')
    const revisions = audit(database).revisions
    expect(revisions).toHaveLength(2)
    expect(revisions[0]).toMatchObject({ valueBefore: '1.0', valueAfter: '2.0', providerId: 'narwhal' })
    expect(audit(database).updatedAt).toBe('2026-11-19T02:00:00.000Z')
    // 幂等重写同一值：不新增。
    write(database, '2.0', 'narwhal', '2026-11-19T03:00:00.000Z')
    expect(audit(database).revisions).toHaveLength(2)
  })

  it('拒绝覆盖写一行：value_after 为 NULL，当前值仍是旧值，守卫不误报', () => {
    const database = setup()
    write(database, '3.5', '0xrouter', '2026-11-19T01:00:00.000Z')
    // 未发布却带 0 → 占位，拒绝覆盖（keep:placeholder-zero）。
    dualWriteMeasureRows(database, { providerId: 'narwhal', parserVersion: 'v1', observedAt: '2026-11-19T02:00:00.000Z',
      rows: [{ countryCode: 'US', metricKey: key.metricKey, periodKey: key.periodKey, scheduledDate: key.firstScheduledDate,
        sourceEventId: 'x-zero', actual: '0', status: 'scheduled' as const }] })
    const keep = audit(database).revisions.find((row) => row.decision === 'keep:placeholder-zero')
    expect(keep).toMatchObject({ valueBefore: '3.5', valueAfter: null })
    // 「更新于」只取 decision='write' 的最后一行，keep 不参与。
    expect(audit(database).updatedAt).toBe('2026-11-19T01:00:00.000Z')
    expect(calendarValueRevisionMismatches(database)).toBe(0)
  })

  it('没有审计记录的期次是「未记录」，不拿标准表更新时间冒充', () => {
    const database = setup()
    expect(audit(database)).toMatchObject({ state: 'not-recorded', updatedAt: null, revisions: [] })
  })

  it('绕过合并路径直接改值 → 守卫报红（审计与当前值不一致）', () => {
    const database = setup()
    write(database, '1.0', '0xrouter', '2026-11-19T01:00:00.000Z')
    expect(calendarValueRevisionMismatches(database)).toBe(0)
    database.prepare(`update mi_calendar_events set values_json='{"actual":"9.9"}'`).run()
    expect(calendarValueRevisionMismatches(database)).toBe(1)
    expect(count(database, 'select count(*) n from mi_calendar_value_revisions')).toBe(1)
  })
})
