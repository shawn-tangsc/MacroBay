import { describe, expect, it } from 'vitest'

import {
  canonicalIdentityKey,
  keepRowsNotCoveredByNarwhal,
  narwhalCanonicalIdentityKey,
  narwhalMeasureMetricKeys,
  zeroXRouterCanonicalIdentity,
  zeroXRouterIndicatorIdentities,
  type ZeroXRouterPeriodRule
} from './marketCalendarMetricIdentity'

/**
 * 身份表的数据守卫：**一张表只许一种理解**。
 *
 * 两个源内码指向同一个 `metric_key` 是允许的（同一事件的另一个测度口径可以合并），但
 * **同一个源内码被登记两次**、或**同一个 `metric_key` 在同一个源里有两个码**都是错的：
 * 前者是表写乱了，后者会让两条不同的事件认成一条。
 */
describe('identity tables stay one-to-one', () => {
  it('registers each source code once', () => {
    expect(Object.keys(narwhalMeasureMetricKeys)).toHaveLength(new Set(Object.keys(narwhalMeasureMetricKeys)).size)
    expect(Object.keys(zeroXRouterIndicatorIdentities)).toHaveLength(
      new Set(Object.keys(zeroXRouterIndicatorIdentities)).size)
  })

  it('never maps two different Narwhal measures onto one metric key', () => {
    const byMetricKey = new Map<string, string>()
    for (const [measure, metricKey] of Object.entries(narwhalMeasureMetricKeys)) {
      const existing = byMetricKey.get(metricKey)
      expect(existing === undefined || existing === measure, `metric key ${metricKey} is claimed twice`).toBe(true)
      byMetricKey.set(metricKey, measure)
    }
  })

  it('keeps every period rule inside the closed set', () => {
    const rules: readonly ZeroXRouterPeriodRule[] = ['month', 'week_end', 'quarter']
    for (const [indicatorId, entry] of Object.entries(zeroXRouterIndicatorIdentities)) {
      expect(rules, `indicator ${indicatorId}`).toContain(entry.periodRule)
      expect(entry.metricKey.length).toBeGreaterThan(0)
    }
  })
})

describe('canonical identity follows the source, not the display name', () => {
  it('reads the period from the release, and derives nothing from the title', () => {
    expect(narwhalCanonicalIdentityKey('USA|US.CPI.NSA.YOY|2026-10')).toBe('USA|US.CPI.NSA.YOY|2026-10')
    expect(narwhalCanonicalIdentityKey('USA|US.CPI.NSA.YOY')).toBeUndefined()
    expect(narwhalCanonicalIdentityKey('USA||2026-10')).toBeUndefined()
  })

  it('gives every 0xRouter row with a known indicator its own period', () => {
    const month = zeroXRouterCanonicalIdentity({ countryCode: 'USA', indicatorId: '8637', scheduledAt: '2026-11-10T13:30:00.000Z' })
    expect(month).toEqual({ countryCode: 'USA', metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-10' })
    const quarter = zeroXRouterCanonicalIdentity({ countryCode: 'USA', indicatorId: '10117', scheduledAt: '2026-11-25T13:30:00.000Z' })
    expect(quarter?.periodKey).toBe('2026-Q3')
    const weekEnd = zeroXRouterCanonicalIdentity({ countryCode: 'USA', indicatorId: '9417', scheduledAt: '2026-11-03T13:55:00.000Z' })
    expect(weekEnd?.periodKey).toBe('2026-10-31')
  })

  it('leaves a row without a stable code unmapped instead of guessing from its name', () => {
    // 讲话、会议、选举这类行没有指标身份：它们不参与合并，按原样从旧源出。
    expect(zeroXRouterCanonicalIdentity({ countryCode: 'USA', indicatorId: null, scheduledAt: '2026-11-10T13:30:00.000Z' }))
      .toBeUndefined()
    expect(zeroXRouterCanonicalIdentity({ countryCode: 'USA', indicatorId: 'not-registered', scheduledAt: '2026-11-10T13:30:00.000Z' }))
      .toBeUndefined()
  })
})

describe('merging two sources keeps what the new source cannot cover', () => {
  const row = (indicatorId: string | null, scheduledAt = '2026-11-10T13:30:00.000Z') =>
    ({ row: { countryCode: 'USA', indicatorId, scheduledAt } })

  it('drops the old row when the same identity is already covered by the new source', () => {
    const covered = row('8637')
    const identity = zeroXRouterCanonicalIdentity(covered.row)!
    const kept = keepRowsNotCoveredByNarwhal([covered], new Set([canonicalIdentityKey(identity)]))
    expect(kept).toHaveLength(0)
  })

  it('keeps the old row when the new source has no such identity', () => {
    const uncovered = row('8637')
    const kept = keepRowsNotCoveredByNarwhal([uncovered], new Set(['USA|US.CORE_CPI.NSA.YOY|2026-10']))
    expect(kept).toHaveLength(1)
  })

  it('keeps rows that carry no identity at all — speeches and meetings are never covered', () => {
    const noIdentity = row(null)
    const kept = keepRowsNotCoveredByNarwhal([noIdentity], new Set(['USA|US.CPI.NSA.YOY|2026-10']))
    expect(kept).toHaveLength(1)
  })

  it('does nothing at all while the new source is still empty', () => {
    const rows = [row('8637'), row(null)]
    expect(keepRowsNotCoveredByNarwhal(rows, new Set())).toBe(rows)
  })
})
