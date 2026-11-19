import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { createMacroCalendarProviderHealthStore } from './macroCalendarProviderHealthStore'
import { CalendarValueShapeError, ensureCalendarStandardTables, upsertCalendarStandardRow } from './marketCalendarStandardTable'

/**
 * #32 的两块地基（用户 2026-11-19 / 架构师契约）：
 * ① 值形状被拒要能被单独识别（`CalendarValueShapeError`），才不会和「库写不进去」混成一个码；
 * ② `lastWriteFailure` 变化必须进健康历史——否则失败状态变化在历史上看不见。
 */
const base = {
  providerId: 'macro-calendar-fed' as const, status: 'healthy' as const,
  updatedAt: '2026-11-19T04:00:00.000Z', consecutiveFailures: 0, checkpoint: {}
}

describe('标准表写入失败的两块地基', () => {
  it('值形状不合格 → CalendarValueShapeError（与「库写不进去」分开）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    expect(() => upsertCalendarStandardRow(database, {
      countryCode: 'US', metricKey: 'US.TEST.NONE.LEVEL', periodKey: '2026-10',
      scheduledDate: '2026-11-01', timePrecision: 'date' as const,
      valuesJson: '{"actual":{"displayValue":"1.0%"}}',
      sourceProviderId: 'test', sourceEventId: 'x', parserVersion: 'v1',
      observedAt: '2026-11-19T04:00:00.000Z', firstSeenAt: '2026-11-19T04:00:00.000Z'
    })).toThrow(CalendarValueShapeError)
  })

  it('lastWriteFailure 变化进健康历史；没变化不重复记', () => {
    const store = createMacroCalendarProviderHealthStore()
    const failure = { at: '2026-11-19T04:00:00.000Z', failedRows: 2, firstErrorCode: 'standard-write-failed' as const }
    store.appendMaterialChange({ ...base, lastWriteFailure: failure })
    store.appendMaterialChange({ ...base, updatedAt: '2026-11-19T05:00:00.000Z', lastWriteFailure: failure })
    store.appendMaterialChange({
      ...base, updatedAt: '2026-11-19T06:00:00.000Z',
      lastWriteFailure: { ...failure, firstErrorCode: 'value-shape-rejected' }
    })
    const snapshot = store.getCurrent('macro-calendar-fed')!
    expect(snapshot.lastWriteFailure?.firstErrorCode).toBe('value-shape-rejected')
    // 同一个失败重复写两次只留一条历史，换码再留一条——不重复记、也不漏记。
    expect(store.getAsOf('macro-calendar-fed', '2026-11-19T04:30:00.000Z').state?.lastWriteFailure?.firstErrorCode)
      .toBe('standard-write-failed')
  })
})
