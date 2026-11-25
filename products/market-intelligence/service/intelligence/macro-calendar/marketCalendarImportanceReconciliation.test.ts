import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables, upsertCalendarStandardRow } from './marketCalendarStandardTable'
import { reconcileCalendarImportance } from './marketCalendarImportanceReconciliation'
import { createMacroCalendarRepository } from './macroCalendarRepository'
import { createMacroCalendarSqlite } from './macroCalendarSqlite'

/**
 * S4 只读核对（Chief 2026-11-24）：「旧子有档 → 新判未分级 / 新判不同档 / 旧高 → 新高」三张单子，
 * 逐族有账。判据是「删掉哪一处就变错」，不是「跑出个数」。
 */
const standardSeed = (database: DatabaseSync, metricKey: string, legacy: string, periodKey = '2026-09') => {
  upsertCalendarStandardRow(database, {
    countryCode: 'USA', metricKey, periodKey, scheduledDate: '2026-10-03', firstScheduledDate: '2026-10-03',
    timePrecision: 'date', valuesJson: '{}', valueState: 'missing',
    sourceProviderId: 'narwhal', sourceEventId: `${metricKey}-${periodKey}`,
    parserVersion: 'v1', observedAt: '2026-10-03T12:31:00.000Z', firstSeenAt: '2026-10-03T12:31:00.000Z',
    importance: legacy as never
  })
}

describe('核对三张单子：新判是现算的，不是读库里那一列', () => {
  it('旧档 high、表里没有这一族 → 进「有档 → 未分级」，按族计数', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    standardSeed(database, 'US.MYSTERY_FAMILY.SA.LEVEL', 'high')
    const report = reconcileCalendarImportance(database)
    expect(report.totals.standardRows).toBe(1)
    expect(report.totals.gradedNowUngraded).toBe(1)
    expect(report.gradedNowUngraded.byFamily).toEqual([{ family: 'MYSTERY_FAMILY', legacyTier: 'high', count: 1 }])
    expect(report.gradedNowUngraded.rows[0]).toMatchObject({
      table: 'standard', legacyTier: 'high', identity: 'US|US.MYSTERY_FAMILY.SA.LEVEL|2026-09|2026-10-03'
    })
    expect(report.gradedNowUngraded.rows[0]!.newTier).toBeUndefined()
  })

  it('旧档 low、表里判高 → 进「不同档」，并带上新档与依据', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    standardSeed(database, 'US.CPI.NSA.YOY', 'low')
    const report = reconcileCalendarImportance(database)
    expect(report.gradedDifferentTier.byFamily).toEqual([{ family: 'CPI', legacyTier: 'low', count: 1 }])
    expect(report.gradedDifferentTier.rows[0]!.newTier).toBe('high')
    expect(report.gradedDifferentTier.rows[0]!.basis).toContain('利率路径')
  })

  it('旧档 high、新判也 high → 进第三张单子，且不重复计入前两张', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    standardSeed(database, 'US.CPI.NSA.YOY', 'high')
    const report = reconcileCalendarImportance(database)
    expect(report.totals.highNowHigh).toBe(1)
    expect(report.totals.gradedNowUngraded).toBe(0)
    expect(report.totals.gradedDifferentTier).toBe(0)
    expect(report.highNowHigh.byFamily).toEqual([{ family: 'CPI', legacyTier: 'high', count: 1 }])
  })

  it('修订行按 eventFamily 判：官方 123 行全 high 里，判不出来的进未分级', () => {
    const storage = createMacroCalendarSqlite(':memory:')
    const database = storage.database
    const repository = createMacroCalendarRepository({ storage })
    const base = {
      revisionId: 'rev-1', eventKey: 'US.CPI.2026-09', releaseGroupKey: 'US.CPI.2026-09',
      eventFamily: 'cpi' as const, eventNameKey: 'cpi', countryCode: 'US' as const, importance: 'high' as const,
      periodKey: '2026-09', lifecycleState: 'scheduled' as const, revisionKind: 'schedule' as const,
      scheduledDate: '2026-10-15', detectedAt: '2026-10-01T00:00:00.000Z',
      recordedAt: '2026-10-01T00:00:00.000Z', providerId: 'macro-calendar-bls' as const,
      descriptorId: 'macro-calendar-bls-schedule', sourceUrl: 'https://example.test/x',
      evidenceHash: 'h', evidenceRefs: [], snapshotHash: 's', parserVersion: 'v1', caveats: []
    }
    repository.appendIfNew(base)
    // 故意造一条 `eventFamily` 不在封闭表里的行：老库可能有（类型挡得住新写入，挡不住历史），
    // 核对脚本必须把它算进「未分级」而不是崩掉。
    repository.appendIfNew({ ...base, revisionId: 'rev-2', eventKey: 'US.MYSTERY.2026-09',
      releaseGroupKey: 'US.MYSTERY.2026-09', eventFamily: 'mystery' as never, importance: 'high' })
    const report = reconcileCalendarImportance(database)
    expect(report.totals.revisionRows).toBe(2)
    expect(report.totals.highNowHigh).toBe(1)
    expect(report.totals.gradedNowUngraded).toBe(1)
    expect(report.gradedNowUngraded.rows[0]).toMatchObject({ table: 'revision', family: 'mystery', legacyTier: 'high' })
  })

  it('同一份库跑两次结果一致（纯读：无时钟、无随机）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    standardSeed(database, 'US.CPI.NSA.YOY', 'low')
    standardSeed(database, 'US.MYSTERY_FAMILY.SA.LEVEL', 'high', '2026-10')
    expect(JSON.stringify(reconcileCalendarImportance(database)))
      .toBe(JSON.stringify(reconcileCalendarImportance(database)))
  })
})