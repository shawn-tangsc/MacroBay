import { describe, expect, it } from 'vitest'

import type { MacroEconomicCalendarEventView } from '../../../contracts/macro/economicCalendarQueryContracts'
import type { MacroEconomicCalendarMonthResult } from '../macro-calendar/macroEconomicCalendarQueryService'
import { projectMacroCalendar } from './marketAnalysisContextProjection'

/**
 * 冻结快照守卫：`createdAt` / `actualDetectedAt` 挂在**共享**的事件视图上，分析侧也 import 同一个
 * 类型；如果它们被顺手喂进事实集，就会静默进入冻结契约而不触发版本进位。
 *
 * 这条用例造一份"带这两个字段"的月结果——生产里只有详情会填，这里故意让月结果也带上，正是为了
 * 证明投影不搬运它们：把 `projectMacroCalendar` 改成整对象拷贝时，它会红。
 */
const AS_OF = '2026-11-06T14:00:00.000Z'

function eventWithDetailTimes(): MacroEconomicCalendarEventView {
  return {
    eventKey: 'US.CPI.RELEASE.2026-M10',
    releaseGroupKey: 'US.CPI.RELEASE.2026-M10',
    eventFamily: 'consumer-price-index',
    titleKey: 'cpi',
    countryCode: 'US',
    importance: 'high',
    periodKey: '2026-M10',
    lifecycleState: 'released',
    coverage: 'available',
    scheduledDate: '2026-11-05',
    scheduledAt: '2026-11-05T12:30:00.000Z',
    releaseTimeSource: 'official',
    detectedAt: '2026-11-05T12:30:41.000Z',
    // 只有详情会填的两个字段，这里故意塞进月结果。
    createdAt: '2026-11-01T08:00:00.000Z',
    actualDetectedAt: '2026-11-05T12:30:41.000Z',
    actual: { displayValue: '3.1%', numericValue: 3.1, unit: 'percent' },
    previous: { displayValue: '3.0%', numericValue: 3, unit: 'percent' },
    consensus: null,
    consensusState: 'unavailable',
    surprise: 'consensus-unavailable',
    providerIds: ['macro-calendar-bls'],
    caveats: []
  }
}

describe('the frozen analysis facts', () => {
  it('never carry the two detail-only times', () => {
    const official: MacroEconomicCalendarMonthResult = { state: 'available', asOf: AS_OF, events: [eventWithDetailTimes()] }
    const facts: Array<Record<string, unknown>> = []
    const caveats = new Set<string>()
    const observations: Record<string, unknown> = {}

    projectMacroCalendar(
      { official, provider: undefined },
      AS_OF,
      facts as never,
      new Map(),
      caveats,
      observations as never
    )

    // 投影确实吃到了这条事件（不是空跑），否则下面"没有字段"就没有意义。
    expect(facts.length).toBeGreaterThan(0)
    const serialized = JSON.stringify(facts)
    expect(serialized).not.toContain('createdAt')
    expect(serialized).not.toContain('actualDetectedAt')
    expect(serialized).not.toContain('2026-11-01T08:00:00.000Z')
    for (const fact of facts) {
      expect(Object.keys(fact)).not.toContain('createdAt')
      expect(Object.keys(fact)).not.toContain('actualDetectedAt')
    }
  })
})
