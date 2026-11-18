import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import {
  ensureCalendarStandardTables, recordCalendarUnmapped
} from './marketCalendarStandardTable'
import { narwhalStandardRowInputsDetailed } from './narwhal-calendar/narwhalCalendarObservationBatches'
import type { NarwhalParsedRelease } from './narwhal-calendar/narwhalCalendarParser'

/**
 * **没能通过码表进入标准表的数据，必须在未映射表里留一条**（Chief 2026-11-18 定）。
 *
 * 这条守卫的价值：以后谁新加一个过滤分支却忘了记录，测试当场红——而不是三周后读者问
 * 「这条数据怎么不见了」。所以每个会拦下数据的入口各一条用例，且都断言**重复跑不变成两行**。
 */
const base = {
  timezone: 'America/New_York', seriesId: 'no-such-series', country: 'JP',
  status: 'scheduled', dateBasis: 'exact' as const, eventDate: '2026-11-13'
}
const release = (over: Partial<NarwhalParsedRelease>): NarwhalParsedRelease =>
  ({ ...base, releaseId: 'r-unmapped', at: '2026-11-13T13:30:00.000Z', name: '在庫', values: [], ...over }) as NarwhalParsedRelease

const rowsOf = (database: DatabaseSync) =>
  database.prepare('select source_key, reason from mi_calendar_unmapped').all() as { source_key: string; reason: string }[]

describe('未映射表的完整性守卫：每个拦下数据的分支都要留一条', () => {
  it('测度不认识（unknown-measure）：有行、原因正确、重复跑不新增', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const input = narwhalStandardRowInputsDetailed([release({
      period: '2026-10', values: [{ measure: 'mystery_measure', concept: 'x', actual: '1' }]
    })])
    for (const item of input.unmapped) {
      recordCalendarUnmapped(database, {
        providerId: 'narwhal', sourceKey: item.sourceKey, detectedAt: '2026-11-13T13:31:00.000Z',
        rawJson: JSON.stringify({ name: item.name }), reason: item.reason
      })
    }
    for (const item of input.unmapped) {
      recordCalendarUnmapped(database, {
        providerId: 'narwhal', sourceKey: item.sourceKey, detectedAt: '2026-11-13T13:32:00.000Z',
        rawJson: JSON.stringify({ name: item.name }), reason: item.reason
      })
    }
    expect(rowsOf(database)).toEqual([{ source_key: 'r-unmapped', reason: 'unknown-measure' }])
  })

  it('事件类型没登记（unknown-event-type）：有行、原因正确、重复跑不新增', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const input = narwhalStandardRowInputsDetailed([release({ name: '某个没人登记过的活动' })])
    for (const item of input.unmapped) {
      recordCalendarUnmapped(database, {
        providerId: 'narwhal', sourceKey: item.sourceKey, detectedAt: '2026-11-13T13:31:00.000Z',
        rawJson: JSON.stringify({ name: item.name }), reason: item.reason
      })
    }
    recordCalendarUnmapped(database, {
      providerId: 'narwhal', sourceKey: input.unmapped[0]!.sourceKey,
      detectedAt: '2026-11-13T13:33:00.000Z', rawJson: '{}', reason: input.unmapped[0]!.reason
    })
    expect(rowsOf(database)).toEqual([{ source_key: 'r-unmapped', reason: 'unknown-event-type' }])
  })

  it('闭集里的每种原因都能落一行，且同一个源 id 只留第一次', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const reasons = ['unknown-measure', 'unknown-event-type', 'bad-period', 'bad-identity',
      'no-values', 'missing-country', 'no-code', 'no-standard-row', 'period-unresolved'] as const
    for (const reason of reasons) {
      recordCalendarUnmapped(database, {
        providerId: 'narwhal', sourceKey: `k-${reason}`, detectedAt: '2026-11-13T13:31:00.000Z',
        rawJson: '{}', reason
      })
    }
    expect(rowsOf(database).map((row) => row.reason).sort()).toEqual([...reasons].sort())
  })
})
