import { describe, expect, it } from 'vitest'

import type { MacroCalendarRevision } from './macroCalendarContracts'
import { createMacroEconomicCalendarQueryService } from './macroEconomicCalendarQueryService'

const AS_OF = '2026-11-01T00:00:00.000Z'
const EVENT_KEY = 'US.FOMC.2026-10-28'
const CREATED_AT = '2026-10-30T08:35:28.000Z'
const ACTUAL_AT = '2026-10-30T14:40:21.000Z'

function revision(overrides: Partial<MacroCalendarRevision> = {}): MacroCalendarRevision {
  return {
    revisionId: 'release',
    eventKey: EVENT_KEY,
    releaseGroupKey: EVENT_KEY,
    eventFamily: 'fomc',
    eventNameKey: 'fomc',
    countryCode: 'US',
    importance: 'high',
    periodKey: '2026-10-28',
    lifecycleState: 'released',
    revisionKind: 'official-release',
    scheduledDate: '2026-10-28',
    publishedAt: '2026-10-28T18:00:00.000Z',
    detectedAt: ACTUAL_AT,
    recordedAt: ACTUAL_AT,
    actual: { displayValue: '3.75%–4.00%', numericValue: 3.875, unit: 'percent' },
    previous: { displayValue: '4.00%–4.25%', numericValue: 4.125, unit: 'percent' },
    providerId: 'macro-calendar-fed',
    descriptorId: 'macro-calendar-fed-statement',
    sourceUrl: 'https://official.invalid/fomc',
    evidenceHash: 'evidence',
    evidenceRefs: [],
    snapshotHash: 'snapshot',
    parserVersion: 'fixture-v1',
    caveats: [],
    ...overrides
  }
}

/**
 * 两个时刻只属于**详情**：月度列表逐条聚合会变成 N+1，而列表也不需要它们。这条用例同时钉住
 * 两件事——详情带着它们，列表不带。
 */
describe('event record times on the detail read', () => {
  it('carries both times on the detail and keeps them off the month list', () => {
    const row = revision()
    const repository = {
      listEffectiveMonthAsOf: () => [row],
      getEffectiveEventAsOf: () => row,
      getEventTimesAsOf: () => ({ createdAt: CREATED_AT, actualDetectedAt: ACTUAL_AT })
    }
    const service = createMacroEconomicCalendarQueryService({ repository })

    const detail = service.getEventDetail({ eventKey: EVENT_KEY, asOf: AS_OF })
    expect(detail.state).toBe('available')
    if (detail.state !== 'available') return
    expect(detail.event.createdAt).toBe(CREATED_AT)
    expect(detail.event.actualDetectedAt).toBe(ACTUAL_AT)
    // 三个时刻互不相等：发布 10-28 18:00、观测 10-30 14:40、落库创建 10-30 08:35。
    expect(detail.event.actualDetectedAt).not.toBe(detail.event.publishedAt)

    const month = service.queryMonth({ month: '2026-10', asOf: AS_OF })
    expect(month.state).toBe('available')
    if (month.state !== 'available') return
    expect(month.events).toHaveLength(1)
    expect(month.events[0]).not.toHaveProperty('createdAt')
    expect(month.events[0]).not.toHaveProperty('actualDetectedAt')
  })
})
