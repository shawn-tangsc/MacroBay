import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { createStandardMonthPageReader } from './marketCalendarStandardMonthPage'
import { ensureCalendarStandardTables, upsertCalendarStandardRow, type CalendarStandardRow }
  from './marketCalendarStandardTable'

const base: CalendarStandardRow = {
  countryCode: 'USA', metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-10',
  scheduledDate: '2026-11-10', scheduledAt: '2026-11-10T13:30:00.000Z', timePrecision: 'minute',
  status: 'published', valuesJson: '{"actual":"3.7"}', valueState: 'present', importance: 'high',
  sourceProviderId: 'macro-calendar-bls', sourceEventId: 'US.CPI.RELEASE.2026-M10',
  parserVersion: 'v1', observedAt: '2026-11-10T13:31:00.000Z', firstSeenAt: '2026-11-10T13:31:00.000Z'
}
const reader = (database: DatabaseSync) => createStandardMonthPageReader({
  database,
  resolveTitle: (row) => row.sourceLabel ?? 'T:'.concat(row.metricKey),
  sourceOf: () => 'Narwhal' as const
})
const seeded = (events: number): DatabaseSync => {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  for (let index = 0; index < events; index += 1) {
    const day = String((index % 28) + 1).padStart(2, '0')
    upsertCalendarStandardRow(database, { ...base, metricKey: `US.TEST_${index}.SA.MOM`, periodKey: '2026-10',
      scheduledDate: `2026-11-${day}`, scheduledAt: `2026-11-${day}T13:30:00.000Z`,
      sourceEventId: `r-${index}` })
  }
  return database
}

describe('月查询接标准表：四件契约', () => {
  it('分页：一页最多 100 条，游标是 UUID，翻完总条数 = 各页之和', () => {
    const query = reader(seeded(150))
    const first = query.queryMonth({ month: '2026-11', locale: 'zh', asOf: '2026-11-14T00:00:00.000Z' })
    expect(first.state).toBe('available')
    if (first.state !== 'available') return
    expect(first.events).toHaveLength(100)
    expect(first.nextCursor).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
    const second = query.queryMonth({ month: '2026-11', locale: 'zh', asOf: '2026-11-14T00:00:00.000Z',
      cursor: first.nextCursor! })
    if (second.state !== 'available') throw new Error('second page unavailable')
    expect(second.events).toHaveLength(50)
    expect(second.nextCursor).toBeUndefined()
    expect(first.events.length + second.events.length).toBe(150)
  })

  it('sources 恰好三条、顺序对齐 kinds；某一类没有行是 success-empty，不是 success', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, base)   // 只有指标型
    const page = reader(database).queryMonth({ month: '2026-11', locale: 'zh', asOf: '2026-11-14T00:00:00.000Z' })
    if (page.state !== 'available') throw new Error('unavailable')
    expect(page.sources.map((source) => source.eventType))
      .toEqual(['economic-indicator', 'financial-event', 'central-bank-activity'])
    expect(page.sources.map((source) => source.status)).toEqual(['success', 'success-empty', 'success-empty'])
  })

  it('月内校验与非法游标：越界行不进页；乱造游标返回不可用（不是空页）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, base)
    upsertCalendarStandardRow(database, { ...base, metricKey: 'US.OTHER.SA.MOM', periodKey: '2026-11',
      scheduledDate: '2026-12-02', scheduledAt: '2026-12-02T13:30:00.000Z', sourceEventId: 'r-x' })
    const query = reader(database)
    const page = query.queryMonth({ month: '2026-11', locale: 'zh', asOf: '2026-11-14T00:00:00.000Z' })
    if (page.state !== 'available') throw new Error('unavailable')
    expect(page.events).toHaveLength(1)
    expect(page.events[0]!.scheduledAt.startsWith('2026-11-')).toBe(true)
    expect(query.queryMonth({ month: '2026-11', locale: 'zh', asOf: '2026-11-14T00:00:00.000Z',
      cursor: 'page-2' }).state).toBe('unavailable')
  })

  it('读失败 → unavailable（不许变成空页）；参数不合法 → input-invalid', () => {
    const database = new DatabaseSync(':memory:')   // 没建表：查询必然抛
    expect(reader(database).queryMonth({ month: '2026-11', locale: 'zh', asOf: '2026-11-14T00:00:00.000Z' }))
      .toEqual({ state: 'unavailable', failureCode: 'query-unavailable' })
    expect(reader(database).queryMonth({ month: '11-2026' })).toEqual({ state: 'unavailable',
      failureCode: 'input-invalid' })
  })
})
