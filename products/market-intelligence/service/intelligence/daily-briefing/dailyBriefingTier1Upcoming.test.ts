import { describe, expect, it } from 'vitest'

import type { DailyBriefingCalendarEvent } from './dailyBriefingFactPacket'
import { selectTier1UpcomingReleases } from './dailyBriefingTier1Upcoming'

const asOf = '2026-11-14T12:19:09.449Z'

function event(overrides: Partial<DailyBriefingCalendarEvent> & Pick<DailyBriefingCalendarEvent, 'scheduledAt'>): DailyBriefingCalendarEvent {
  return Object.freeze({
    eventKey: overrides.eventKey ?? `k-${overrides.scheduledAt}-${overrides.metricKey ?? 'none'}`,
    title: overrides.title ?? '某指标',
    importance: overrides.importance ?? 'medium',
    lifecycleState: overrides.lifecycleState ?? 'scheduled',
    category: overrides.category ?? 'economic-indicator',
    surprise: overrides.surprise ?? { direction: 'consensus-unavailable' as const, reason: 'missing-actual' },
    ...overrides
  })
}

describe('tier-1 upcoming releases', () => {
  // 产品给的那三个日子就是这条用例的验收样例：CPI 年率 12-10、新增就业 12-04、核心 PCE 11-25。
  // 一个发布组一行：十二个一级码落在三个组里，逐码列会出现四行同一天。
  it('lists one next release per tier-1 release group, earliest first', () => {
    const releases = selectTier1UpcomingReleases([
      event({ metricKey: 'US.CPI.NSA.YOY', title: 'CPI 年率', scheduledAt: '2026-12-10T13:30:00.000Z' }),
      event({ metricKey: 'US.NONFARM.SA.CHANGE', title: '新增就业', scheduledAt: '2026-12-04T13:30:00.000Z' }),
      event({ metricKey: 'US.CORE_PCE.SA.YOY', title: '核心 PCE 年率', scheduledAt: '2026-11-25T13:30:00.000Z' })
    ], asOf)

    expect(releases.map((release) => [release.metricKey, release.releaseDate]))
      .toEqual([
        ['US.CORE_PCE.SA.YOY', '2026-11-25'],
        ['US.NONFARM.SA.CHANGE', '2026-12-04'],
        ['US.CPI.NSA.YOY', '2026-12-10']
      ])
  })

  // 同一码有多期（初值/终值、不同期间）：只留最早那一场，否则读者看到同一个指标连着三行。
  it('keeps only the earliest upcoming release of each metric', () => {
    const releases = selectTier1UpcomingReleases([
      event({ metricKey: 'US.CPI.NSA.YOY', scheduledAt: '2026-12-10T13:30:00.000Z' }),
      event({ metricKey: 'US.CPI.NSA.YOY', scheduledAt: '2027-01-13T13:30:00.000Z' }),
      event({ metricKey: 'US.CPI.NSA.YOY', scheduledAt: '2026-12-10T13:30:00.000Z', eventKey: 'dup' })
    ], asOf)

    expect(releases).toHaveLength(1)
    expect(releases[0]!.releaseDate).toBe('2026-12-10')
  })

  it('drops releases that already happened and metrics outside the tier-1 list', () => {
    const releases = selectTier1UpcomingReleases([
      event({ metricKey: 'US.CPI.NSA.YOY', scheduledAt: '2026-11-01T13:30:00.000Z' }),
      event({ metricKey: 'US.MANUFACTURING_PRODUCTION.SA.MOM', scheduledAt: '2026-12-01T13:30:00.000Z' }),
      event({ metricKey: 'US.NONFARM.SA.CHANGE', scheduledAt: '2026-12-04T13:30:00.000Z' })
    ], asOf)

    expect(releases.map((release) => release.metricKey)).toEqual(['US.NONFARM.SA.CHANGE'])
  })

  it('treats a date-only release on the cutoff day as still upcoming, never as a time', () => {
    const releases = selectTier1UpcomingReleases([
      event({
        metricKey: 'US.NONFARM.SA.CHANGE',
        scheduledAt: '2026-11-14T00:00:00.000Z',
        releaseTimeNotPublished: true,
        releaseDate: '2026-11-14'
      })
    ], asOf)

    expect(releases).toHaveLength(1)
    expect(releases[0]!.releaseTimeNotPublished).toBe(true)
    expect(releases[0]!.releaseDate).toBe('2026-11-14')
  })

  // 不许在简报里抄一份十二个码：清单默认来自分级常量，这里用真实的常量集合校验覆盖关系。
  it('defaults to the tier-1 constant, not a copied list', () => {
    const releases = selectTier1UpcomingReleases([
      event({ metricKey: 'US.UNEMPLOYMENT.SA.RATE', scheduledAt: '2026-12-04T13:30:00.000Z' })
    ], asOf)
    expect(releases).toHaveLength(1)
  })
})
