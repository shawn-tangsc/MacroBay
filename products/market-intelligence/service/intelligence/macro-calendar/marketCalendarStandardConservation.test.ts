import { describe, expect, it } from 'vitest'

import { calendarStandardConservation, type CalendarStandardSourceTotals }
  from './marketCalendarStandardConservation'
import type { NarwhalStandardRowInput } from './narwhal-calendar/narwhalCalendarObservationBatches'

const indicator = (sourceEventId: string, metricKey: string): NarwhalStandardRowInput => ({
  kind: 'indicator', countryCode: 'USA', metricKey, periodKey: '2026-10',
  scheduledDate: '2026-11-13', scheduledAt: '2026-11-13T13:30:00.000Z', sourceEventId
})
const event = (sourceEventId: string): NarwhalStandardRowInput => ({
  kind: 'event', countryCode: 'USA', metricKey: 'evt.central-bank-speech', periodKey: '2026-11-13T13:30',
  scheduledDate: '2026-11-13', scheduledAt: '2026-11-13T13:30:00.000Z', sourceEventId
})
const totals = (over: Partial<CalendarStandardSourceTotals>): CalendarStandardSourceTotals =>
  ({ releases: 0, measures: 0, measuresOnEventReleases: 0, ...over })

describe('两层守恒式：不假红', () => {
  it('5 条事件 + 3 条指标，两个差额都是 0', () => {
    const rows = ['e1', 'e2', 'e3', 'e4', 'e5'].map(event)
      .concat(['m1', 'm2', 'm3'].map((id) => indicator(id, `US.K${id}`)))
    const conservation = calendarStandardConservation({
      sourceTotals: totals({ releases: 8, measures: 3 }), rows, unmapped: [], failed: 0
    })
    // 事件行不进测度层：算进去会恒报 −5 的假红。
    expect(conservation.measureDiff).toBe(0)
    expect(conservation.releaseDiff).toBe(0)
    expect(conservation.landedMeasures).toBe(3)
  })

  it('事件型发布带值时，那个 measure 记「显式排除」而不是差异', () => {
    // 实测有 1 条无期间发布带 1 个 value（利率决议）：它随事件行走，永远变不成指标行。
    const conservation = calendarStandardConservation({
      sourceTotals: totals({ releases: 1, measures: 1, measuresOnEventReleases: 1 }),
      rows: [event('fed-decision')], unmapped: [], failed: 0
    })
    expect(conservation.measureDiff).toBe(0)
    expect(conservation.excludedMeasures).toBe(1)
  })

  it('一条发布 2 个 measure 落表、1 个未映射：按 id 取并集，不重复认领', () => {
    const conservation = calendarStandardConservation({
      sourceTotals: totals({ releases: 1, measures: 3 }),
      rows: [indicator('mixed', 'US.A'), indicator('mixed', 'US.B')],
      unmapped: [{ sourceKey: 'mixed', measureKeys: ['not_in_table'] }], failed: 0
    })
    expect(conservation.releaseDiff).toBe(0)
    expect(conservation.measureDiff).toBe(0)
    expect(conservation.creditedReleases).toBe(1)
  })

  it('有期间但没有任何值：记 no-values（0 个 measure），两层都不差', () => {
    const conservation = calendarStandardConservation({
      sourceTotals: totals({ releases: 1, measures: 0 }),
      rows: [], unmapped: [{ sourceKey: 'empty', measureKeys: [] }], failed: 0
    })
    expect(conservation.releaseDiff).toBe(0)
    expect(conservation.measureDiff).toBe(0)
    expect(conservation.creditedReleases).toBe(1)
  })
})

describe('两层守恒式：不假绿', () => {
  it('构造阶段被吞掉一条发布（既不在 rows 也不在 unmapped）→ 发布层差额非 0', () => {
    const conservation = calendarStandardConservation({
      sourceTotals: totals({ releases: 3, measures: 2 }),
      rows: [indicator('kept-1', 'US.A'), indicator('kept-2', 'US.B')],
      unmapped: [], failed: 0
    })
    // 这就是 b2e9231 那版测不出来的东西：从产物反推时被减数跟着少，永远平。
    // 少一条被认领 = 输入比认领多 1（重复认领才是 −1）。
    expect(conservation.releaseDiff).toBe(1)
  })

  it('某个 measure 没落表也没进未映射 → 测度层差额非 0', () => {
    const conservation = calendarStandardConservation({
      sourceTotals: totals({ releases: 1, measures: 2 }),
      rows: [indicator('r1', 'US.A')], unmapped: [], failed: 0
    })
    expect(conservation.releaseDiff).toBe(0)
    expect(conservation.measureDiff).toBe(1)
  })
})
