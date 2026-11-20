import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables } from './marketCalendarStandardSchema'
import { dualWriteMeasureRows } from './marketCalendarStandardDualWrite'
import { narwhalStandardSourceEventId } from './marketCalendarSourceEventId'

/**
 * **同一发布改了排期 → 仍是同一行**（架构师 2026-11-21 批 (b)，方案 §2.4）。
 *
 * 判别器只有源内 `release_id`：身份是四段、含排期日，日期一变 id 就变，只按 id 找不到旧行。
 * 两个日期各管一件事：`first_scheduled_date` 冻结（身份用它），`scheduled_date` 更新（展示用它）。
 * 旧行 `source_release_id` 为 NULL → 无法判别，按老行为新建行并计数。
 */
const METRIC = 'US.MICHIGAN_CURRENT.NONE.LEVEL'
const PERIOD = '2026-11'

const rowOf = (over: Readonly<Record<string, unknown>> = {}) => ({
  countryCode: 'USA', metricKey: METRIC, periodKey: PERIOD,
  scheduledDate: '2026-11-06', sourceReleaseId: 'release-1',
  sourceEventId: narwhalStandardSourceEventId({
    countryCode: 'USA', metricKey: METRIC, periodKey: PERIOD, firstScheduledDate: '2026-11-06'
  }),
  identityKind: 'code' as const, status: 'published' as const, timePrecision: 'minute' as const,
  actual: '51', previous: '46.7', ...over
})

const write = (database: DatabaseSync, rows: readonly ReturnType<typeof rowOf>[]) =>
  dualWriteMeasureRows(database, {
    providerId: 'narwhal', parserVersion: 'probe-v1', observedAt: '2026-11-13T09:00:00.000Z',
    rows: rows as never
  })

const rows = (database: DatabaseSync) =>
  database.prepare('select scheduled_date, first_scheduled_date, source_event_id, source_release_id, values_json' +
    ', (select count(*) from mi_calendar_event_source_ids) as ledger from mi_calendar_events')
    .all() as Record<string, unknown>[]

describe('同一发布改排期：冻结首排期、更新显示排期', () => {
  it('同一 release_id、日期从 11-06 改到 11-20：1 行，first 冻结、scheduled 更新、台账 1 条', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    write(database, [rowOf()])
    const before = rows(database)[0]!
    write(database, [rowOf({
      scheduledDate: '2026-11-20',
      sourceEventId: narwhalStandardSourceEventId({
        countryCode: 'USA', metricKey: METRIC, periodKey: PERIOD, firstScheduledDate: '2026-11-20'
      })
    })])
    const after = rows(database)
    expect(after).toHaveLength(1)
    // 展示日期跟着源走
    expect(after[0]!.scheduled_date).toBe('2026-11-20')
    // 身份与首排期冻结
    expect(after[0]!.first_scheduled_date).toBe('2026-11-06')
    expect(after[0]!.source_event_id).toBe(before.source_event_id)
    expect(after[0]!.source_release_id).toBe('release-1')
    // 台账不新增：身份没变
    expect(Number(after[0]!.ledger)).toBe(1)
  })

  it('同一 release_id、同一日期重发：幂等，仍 1 行', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    write(database, [rowOf()])
    write(database, [rowOf({ actual: '52' })])
    const after = rows(database)
    expect(after).toHaveLength(1)
    expect(JSON.parse(String(after[0]!.values_json)).actual).toBe('52')
  })

  it('不同 release_id、同期两次真实发布：2 行（既有契约，不许合并）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    write(database, [rowOf()])
    write(database, [rowOf({
      sourceReleaseId: 'release-2', scheduledDate: '2026-11-20', actual: '46.7',
      sourceEventId: narwhalStandardSourceEventId({
        countryCode: 'USA', metricKey: METRIC, periodKey: PERIOD, firstScheduledDate: '2026-11-20'
      })
    })])
    const after = rows(database)
    expect(after).toHaveLength(2)
    expect(after.map((row) => row.first_scheduled_date).sort()).toEqual(['2026-11-06', '2026-11-20'])
  })

  it('旧行没有判别器（NULL）、带 id 的写入改了日期：新行 + 计数 1（不静默）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    // 旧版本写进去的行：没有 source_release_id
    write(database, [rowOf({ sourceReleaseId: undefined })])
    const counts = write(database, [rowOf({
      scheduledDate: '2026-11-20',
      sourceEventId: narwhalStandardSourceEventId({
        countryCode: 'USA', metricKey: METRIC, periodKey: PERIOD, firstScheduledDate: '2026-11-20'
      })
    })])
    expect(rows(database)).toHaveLength(2)
    expect(counts.legacyUnjudged).toBe(1)
  })

  it('读上一版写的行：`source_release_id` 为 NULL 的行照常读得出（不变成「读不到」）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    write(database, [rowOf({ sourceReleaseId: undefined })])
    const after = rows(database)
    expect(after).toHaveLength(1)
    expect(after[0]!.source_release_id).toBeNull()
    expect(JSON.parse(String(after[0]!.values_json)).actual).toBe('51')
  })
})