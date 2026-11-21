import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { mergeCrossSourceCalendarRows } from './marketCalendarCrossSourceMerge'
import { ensureCalendarStandardTables, upsertCalendarStandardRow } from './marketCalendarStandardTable'

/**
 * 跨源同名合并是**缺口型**，不是一次性迁移。
 *
 * 写入端还会继续产生这种形状：标准表主键含 `first_scheduled_date`，而写入端只在**同一来源**内
 * 认回身份；两家来源对同一次发布的首次排期看法不同（改期、补排）就是两行。所以判据必须是
 * 「现在还有多少组要合」，不是「这条迁移跑过没有」。
 */
const now = '2026-11-21T03:00:00.000Z'

function setup(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  return database
}

function seed(database: DatabaseSync, input: Readonly<{
  periodKey: string
  providerId: string
  firstScheduledDate: string
  scheduledDate: string
  actual?: string
}>): void {
  upsertCalendarStandardRow(database, {
    countryCode: 'USA',
    metricKey: 'US.CPI.NSA.YOY',
    periodKey: input.periodKey,
    scheduledDate: input.scheduledDate,
    firstScheduledDate: input.firstScheduledDate,
    timePrecision: 'date',
    status: 'published',
    valuesJson: input.actual === undefined ? JSON.stringify({ previous: '3.6' }) : JSON.stringify({ actual: input.actual }),
    sourceProviderId: input.providerId,
    sourceEventId: `${input.providerId}|${input.periodKey}|${input.firstScheduledDate}`,
    parserVersion: 'v1',
    observedAt: now,
    firstSeenAt: now
  })
}

describe('跨源同名合并的判据', () => {
  it('合并一组之后又来一组新的同类重复：第二次调用照样合并（旧代码在这里被标记挡住）', () => {
    const database = setup()
    // 第一期：官方与市场两家对同一次发布的首次排期差一天 ⇒ 两行，值不冲突。
    seed(database, { periodKey: '2026-10', providerId: 'macro-calendar-bls',
      firstScheduledDate: '2026-11-10', scheduledDate: '2026-11-10', actual: '3.7' })
    seed(database, { periodKey: '2026-10', providerId: '0xrouter',
      firstScheduledDate: '2026-11-11', scheduledDate: '2026-11-11' })
    const first = mergeCrossSourceCalendarRows(database)
    expect(first.groups).toBe(1)
    expect(first.mergedGroups).toBe(1)
    expect(database.prepare("select count(*) as n from mi_calendar_events where metric_key='US.CPI.NSA.YOY' and period_key='2026-10'")
      .get()).toEqual({ n: 1 })

    // 下一期又是同一形状（改期后两家首次排期不同）——新行进库后必须还能被合。
    seed(database, { periodKey: '2026-11', providerId: 'macro-calendar-bls',
      firstScheduledDate: '2026-12-10', scheduledDate: '2026-12-10', actual: '3.8' })
    seed(database, { periodKey: '2026-11', providerId: '0xrouter',
      firstScheduledDate: '2026-12-11', scheduledDate: '2026-12-11' })
    const second = mergeCrossSourceCalendarRows(database)
    expect(second.groups).toBe(1)
    expect(second.mergedGroups).toBe(1)
    expect(database.prepare("select count(*) as n from mi_calendar_events where metric_key='US.CPI.NSA.YOY' and period_key='2026-11'")
      .get()).toEqual({ n: 1 })
  })

  it('没有重复组时返回 0 组，且不写迁移标记（标记行会被清掉）', () => {
    const database = setup()
    database.exec('create table if not exists mi_macro_calendar_migrations (version integer primary key)')
    database.prepare('insert or ignore into mi_macro_calendar_migrations(version) values (17)').run()
    seed(database, { periodKey: '2026-10', providerId: '0xrouter',
      firstScheduledDate: '2026-11-10', scheduledDate: '2026-11-10', actual: '3.7' })
    const report = mergeCrossSourceCalendarRows(database)
    expect(report.groups).toBe(0)
    expect(report.mergedGroups).toBe(0)
    expect(database.prepare('select count(*) as n from mi_macro_calendar_migrations where version = 17').get()).toEqual({ n: 0 })
  })
})