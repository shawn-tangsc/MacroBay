import { describe, expect, it, vi } from 'vitest'

import type { MarketCalendarEvent } from '../../../contracts/macro/marketCalendarQueryContracts'

/**
 * 「阈值判据只有一处实现」的**可判定**版本。
 *
 * 读代码看见 import 不算证据：下一个人完全可以在这里抄一份常量，import 那行还在，行为却已经
 * 分叉了。所以这里把共享实现换掉，看采集侧跟不跟着变：
 *
 * - 共享判据恒假 → 再大的偏差也不许发（抄了一份常量的实现会照样发，这条当场红）；
 * - 共享判据恒真 → 连「符合预期」的也发（抄了阈值的实现会照样不发，同样红）。
 *
 * 两个方向都断，才叫「真的在用它」。这与今晚反复用的做法是同一条：改坏必须红。
 */
const trigger = vi.fn<(assessment: unknown) => boolean>(() => false)

vi.mock('../../../contracts/macro/marketCalendarSurprise', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../contracts/macro/marketCalendarSurprise')>()
  return {
    ...actual,
    exceedsSurpriseTrigger: (assessment: unknown) => trigger(assessment)
  }
})

const { selectLandedReleases } = await import('./macroEventLandedNotifier')

const asOf = '2026-09-10T12:00:00.000Z'

function event(overrides: Partial<MarketCalendarEvent> = {}): MarketCalendarEvent {
  return {
    eventKey: 'batch-hmac-1',
    observationKey: 'US.CPI.RELEASE.2026-M08',
    title: 'CPI',
    countryCode: 'US',
    eventType: 'economic-indicator',
    importance: 'high',
    scheduledAt: '2026-09-10T10:00:00.000Z',
    consensus: { displayValue: '2' },
    providerPrevious: { displayValue: '2' },
    providerActual: { displayValue: '3' },
    source: '0xRouter',
    sourceObservedAt: asOf,
    coverage: 'observed-unverified',
    ...overrides
  }
}

describe('macro event landed threshold usage', () => {
  it('asks the shared threshold instead of carrying its own copy of the rule', () => {
    // A release 50% above consensus, so nothing but the shared decision can be keeping it quiet.
    trigger.mockReturnValue(false)
    expect(selectLandedReleases([event()], asOf).landings).toEqual([])
    expect(selectLandedReleases([event()], asOf).suppressed).toEqual({ notComparable: 0, belowThreshold: 1 })
    expect(trigger).toHaveBeenCalled()

    // And the other direction: when the shared decision says yes, a release that landed exactly on
    // consensus goes out too. A copied 5%/0.2pp comparison would keep it silent here.
    trigger.mockReturnValue(true)
    expect(selectLandedReleases([event({ providerActual: { displayValue: '2' } })], asOf).landings).toEqual([
      { eventId: 'US.CPI.RELEASE.2026-M08', releaseAt: '2026-09-10T10:00:00.000Z' }
    ])
  })
})
