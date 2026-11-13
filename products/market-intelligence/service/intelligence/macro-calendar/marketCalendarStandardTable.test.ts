import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import {
  ensureCalendarStandardTables, findCalendarStandardRowBySource, recordCalendarUnmapped, upsertCalendarStandardRow,
  type CalendarStandardRow
} from './marketCalendarStandardTable'

const base: CalendarStandardRow = {
  countryCode: 'USA', metricKey: 'US.NONFARM.SA.CHANGE', periodKey: '2026-10',
  scheduledDate: '2026-11-06', scheduledAt: '2026-11-06T13:30:00.000Z', timePrecision: 'minute',
  valuesJson: JSON.stringify({ actual: '165', previous: '29' }), sourceProviderId: 'narwhal',
  sourceEventId: 'r-1', parserVersion: 'v1', observedAt: '2026-11-06T13:31:00.000Z',
  firstSeenAt: '2026-11-06T13:31:00.000Z', firstPublishedActual: '165', firstPublishedPrevious: '29'
}

const rows = (database: DatabaseSync) =>
  database.prepare('select * from mi_calendar_events').all() as Record<string, unknown>[]

describe('标准日历表', () => {
  it('一身份一行：同身份再写是覆盖，不是新增', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, base)
    upsertCalendarStandardRow(database, { ...base, observedAt: '2026-11-13T09:00:00.000Z' })
    expect(rows(database)).toHaveLength(1)
  })

  it('修订覆盖值，但首发布值冻结（非农 29 不会被 60 冲掉）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, base)
    // 来源修订：previous 从 29 变 60，observed_at 也更新。
    upsertCalendarStandardRow(database, { ...base,
      valuesJson: JSON.stringify({ actual: '165', previous: '60' }),
      observedAt: '2026-11-13T09:00:00.000Z',
      firstPublishedActual: '165', firstPublishedPrevious: '60' })
    const [row] = rows(database)
    expect(JSON.parse(String(row!.values_json)).previous).toBe('60')  // 值跟着修订走
    expect(row!.first_published_previous).toBe('29')                  // 首发布值冻结
    expect(row!.first_published_actual).toBe('165')
    expect(row!.first_seen_at).toBe(base.firstSeenAt)                 // 首见时间也不动
    expect(row!.observed_at).toBe('2026-11-13T09:00:00.000Z')         // 观测时间跟着走
  })

  it('空值不覆盖有值：先落了值的行，再被一条值空的行认领，值不许被抹成 {}', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, base)
    // 后写的是「还没有值」的那一版（同身份、同源 id）：值区清空是事实，但不能抹掉已有的值。
    upsertCalendarStandardRow(database, { ...base, valuesJson: '{}', observedAt: '2026-11-13T09:00:00.000Z' })
    const [row] = rows(database)
    expect(JSON.parse(String(row!.values_json)).actual).toBe('165')
  })

  it('没映射上的行进 unmapped、不进日历，且重复记录幂等', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const entry = { providerId: 'narwhal', sourceKey: 'r-2', detectedAt: '2026-11-13T09:00:00.000Z',
      rawJson: '{"name":"unknown"}', reason: 'unknown-measure' as const }
    recordCalendarUnmapped(database, entry)
    recordCalendarUnmapped(database, entry)
    expect((database.prepare('select count(*) c from mi_calendar_unmapped').get() as { c: number }).c).toBe(1)
    expect(rows(database)).toHaveLength(0)
  })
})

describe('视图折叠：同一指标同一期重发多次', () => {
  const viewRows = (database: DatabaseSync) =>
    database.prepare('select scheduled_date, values_json from mi_calendar_releases order by scheduled_date').all() as
      { scheduled_date: string; values_json: string }[]
  const write = (database: DatabaseSync, over: Partial<CalendarStandardRow>) =>
    upsertCalendarStandardRow(database, { ...base, ...over })

  it('带值的那行留下，空的折掉（ADP 十月：源发了三次）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    write(database, { scheduledDate: '2026-11-04', valuesJson: '{"actual":"165"}' })
    write(database, { scheduledDate: '2026-11-05', valuesJson: '{}', valueState: 'not-provided' })
    write(database, { scheduledDate: '2026-11-06', valuesJson: '{}', valueState: 'not-provided' })
    const view = viewRows(database)
    expect(view).toHaveLength(1)
    expect(view[0]!.scheduled_date).toBe('2026-11-04')
  })

  it('两行都带值 → 两行都留（密歇根初值/终值是真两次发布）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    write(database, { scheduledDate: '2026-11-14', valuesJson: '{"actual":"51.0"}' })
    write(database, { scheduledDate: '2026-11-28', valuesJson: '{"actual":"53.2"}' })
    expect(viewRows(database)).toHaveLength(2)
  })

  it('整期都没有值 → 只留首见那行，不能折成 0 行', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    write(database, { scheduledDate: '2026-11-05', valuesJson: '{}' })
    write(database, { scheduledDate: '2026-11-06', valuesJson: '{}' })
    const view = viewRows(database)
    expect(view).toHaveLength(1)
    expect(view[0]!.scheduled_date).toBe('2026-11-05')
  })

  it('不同期间互不影响（折叠键含期间）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    write(database, { periodKey: '2026-10', valuesJson: '{}' })
    write(database, { periodKey: '2026-11', valuesJson: '{"actual":"1"}' })
    expect(viewRows(database)).toHaveLength(2)
  })
})

describe('一次发布一行：四次判红口径', () => {
  const write = (database: DatabaseSync, over: Partial<CalendarStandardRow>) =>
    upsertCalendarStandardRow(database, { ...base, ...over })

  it('同一期间两次真实发布（初值 11-06 / 终值 11-20）→ 两行', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    write(database, { sourceEventId: 'r-prelim', scheduledAt: '2026-11-06T15:00:00.000Z' })
    write(database, { sourceEventId: 'r-final', scheduledDate: '2026-11-20', scheduledAt: '2026-11-20T15:00:00.000Z' })
    expect(rows(database)).toHaveLength(2)
  })

  it('同一发布修订 → 仍一行，且其次发布时刻不变', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    write(database, {})
    write(database, { valuesJson: JSON.stringify({ actual: '165', previous: '60' }),
      observedAt: '2026-11-13T09:00:00.000Z' })
    const [row] = rows(database)
    expect(rows(database)).toHaveLength(1)
    expect(row!.first_scheduled_date).toBe(base.scheduledDate)
  })

  it('源改期（同源同 source_event_id）→ 仍一行，显示时刻跟着变', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    write(database, {})
    const found = findCalendarStandardRowBySource(database, { sourceProviderId: 'narwhal', sourceEventId: 'r-1' })!
    write(database, { scheduledDate: '2026-11-07', scheduledAt: '2026-11-07T13:30:00.000Z', firstScheduledDate: found.firstScheduledDate })
    const [row] = rows(database)
    expect(rows(database)).toHaveLength(1)
    expect(row!.scheduled_date).toBe('2026-11-07')
    expect(row!.first_scheduled_date).toBe(base.scheduledDate)
  })
})

describe('日历只读视图', () => {
  it('视图只出 release，estimate 出不来；基表里两行都在', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, { ...base, sourceEventId: 'r-release' })
    upsertCalendarStandardRow(database, { ...base, sourceEventId: 'r-estimate', rowKind: 'estimate',
      metricKey: 'US.GDP_NOWCAST.SA.ANNUALIZED_QOQ', periodKey: '2026-Q4' })
    const view = database.prepare('select count(*) c from mi_calendar_releases').get() as { c: number }
    const all = rows(database)
    expect(view.c).toBe(1)
    expect(all).toHaveLength(2)
    expect(all.filter((row) => row.row_kind === 'estimate')).toHaveLength(1)
  })
})

describe('同一天两源合并：时刻取 minute 那一方', () => {
  it('官方只有日期后写，也不抹掉市场的 13:30', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    // 市场先写：有时刻
    upsertCalendarStandardRow(database, { ...base, sourceProviderId: 'narwhal', sourceEventId: 'm-1',
      scheduledAt: '2026-11-06T13:30:00.000Z', timePrecision: 'minute' })
    // 官方后写：同一天、只有日期、没有时刻
    upsertCalendarStandardRow(database, { ...base, sourceProviderId: 'bls', sourceEventId: 'o-1',
      scheduledAt: undefined, timePrecision: 'date' })
    const [row] = rows(database)
    expect(row!.scheduled_at).toBe('2026-11-06T13:30:00.000Z')  // 时刻没被抹掉
    expect(row!.time_precision).toBe('minute')                   // 精度不反向降级
  })
})
