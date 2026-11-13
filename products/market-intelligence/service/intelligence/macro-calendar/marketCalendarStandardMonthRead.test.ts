import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { readStandardCalendarMonth } from './marketCalendarStandardMonthRead'
import { ensureCalendarStandardTables, upsertCalendarStandardRow, type CalendarStandardRow }
  from './marketCalendarStandardTable'

const base: CalendarStandardRow = {
  countryCode: 'USA', metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-10',
  scheduledDate: '2026-11-10', scheduledAt: '2026-11-10T13:30:00.000Z', timePrecision: 'minute',
  status: 'published', valuesJson: '{"actual":"3.7"}', valueState: 'present',
  sourceProviderId: 'macro-calendar-bls', sourceEventId: 'US.CPI.RELEASE.2026-M10',
  parserVersion: 'v1', observedAt: '2026-11-10T13:31:00.000Z', firstSeenAt: '2026-11-10T13:31:00.000Z'
}
const seed = (database: DatabaseSync) => {
  ensureCalendarStandardTables(database)
  upsertCalendarStandardRow(database, base)
  upsertCalendarStandardRow(database, { ...base, metricKey: 'US.GDP_NOWCAST.SA.ANNUALIZED_QOQ',
    periodKey: '2026-11', scheduledDate: '2026-11-12', rowKind: 'estimate', valuesJson: '{"actual":"2.1"}' })
  upsertCalendarStandardRow(database, { ...base, metricKey: 'US.PPI.NSA.YOY', periodKey: '2026-10',
    scheduledDate: '2026-12-15', sourceEventId: 'US.PPI.RELEASE.2026-M10' })
}
const emptyMonth = (database: DatabaseSync) => {
  const rows = database.prepare('select count(*) n from mi_calendar_events where scheduled_date like ?').get('2099-%') as { n: number }
  return rows.n
}

describe('从标准表读一个月', () => {
  it('日历语义默认不含估算', () => {
    const database = new DatabaseSync(':memory:')
    seed(database)
    const rows = readStandardCalendarMonth(database, { month: '2026-11' })
    expect(rows.map((row) => row.rowKind)).toEqual(['release'])
    expect(rows[0]!.metricKey).toBe('US.CPI.NSA.YOY')
  })

  it('分析侧传 includeEstimates 才看得到估算', () => {
    const database = new DatabaseSync(':memory:')
    seed(database)
    const rows = readStandardCalendarMonth(database, { month: '2026-11', includeEstimates: true })
    expect(rows.map((row) => row.rowKind).sort()).toEqual(['estimate', 'release'])
  })

  it('身份串稳定、出处与状态一起给（少一个消费方就会静默少东西）', () => {
    const database = new DatabaseSync(':memory:')
    seed(database)
    const [row] = readStandardCalendarMonth(database, { month: '2026-11' })
    expect(row!.identityKey).toBe('USA|US.CPI.NSA.YOY|2026-10|2026-11-10')
    expect(row!.observedAt).toBe('2026-11-10T13:31:00.000Z')
    expect(row!.sourceProviderId).toBe('macro-calendar-bls')
    expect(row!.timePrecision).toBe('minute')
    expect(row!.status).toBe('published')
    expect(row!.values.actual).toBe('3.7')
  })

  it('只读本月：跨月的行不出现；真空月返回空数组（与「读不到」是两件事）', () => {
    const database = new DatabaseSync(':memory:')
    seed(database)
    expect(readStandardCalendarMonth(database, { month: '2026-12' }).map((row) => row.metricKey))
      .toEqual(['US.PPI.NSA.YOY'])
    expect(readStandardCalendarMonth(database, { month: '2099-01' })).toEqual([])
    expect(emptyMonth(database)).toBe(0)
  })
})
