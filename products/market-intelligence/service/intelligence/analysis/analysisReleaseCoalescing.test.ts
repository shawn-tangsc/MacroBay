import { describe, expect, it } from 'vitest'

import type { MetricIntelligenceEvent } from '../schema/intelligenceMetricEvent'
import {
  analysisReleaseCoalescingPolicy,
  findCoveringReleaseAttempt,
  isSameAnalysisRelease,
  resolveAnalysisReleaseIdentity
} from './analysisReleaseCoalescing'

const item = { publishedAt: '2026-11-05T00:00:00.000Z', detectedAt: '2026-11-05T00:58:00.000Z' }

function metricEvent(overrides: Partial<MetricIntelligenceEvent> = {}): MetricIntelligenceEvent {
  return {
    metricEventId: 'metric-1', itemId: 'item-1', sourceId: 'fred-rates-liquidity', metricKey: 'US_2Y_YIELD',
    metricName: 'US 2Y', metricKind: 'treasury-yield', actual: 4.1, period: '2026-11-05',
    releaseTime: '2026-11-05T00:00:00.000Z', comparisonBasis: 'period-change', surpriseDirection: 'unknown',
    metricVersion: 'v1', ...overrides
  }
}

describe('analysis release identity', () => {
  it('reads the publisher, the reporting period and the release moment from the metric event', () => {
    expect(resolveAnalysisReleaseIdentity({ item, metricEvent: metricEvent() })).toEqual({
      key: 'fred-rates-liquidity|2026-11-05', releasedAt: '2026-11-05T00:00:00.000Z'
    })
  })

  it('leaves an item without a metric event alone instead of guessing from its title', () => {
    expect(resolveAnalysisReleaseIdentity({ item, metricEvent: undefined })).toBeUndefined()
  })

  it('still names a release when the source carries no reporting period', () => {
    expect(resolveAnalysisReleaseIdentity({ item, metricEvent: metricEvent({ period: undefined }) })?.key)
      .toBe('fred-rates-liquidity|unstated')
  })

  it('refuses a release moment that is not a canonical instant', () => {
    expect(resolveAnalysisReleaseIdentity({ item, metricEvent: metricEvent({ releaseTime: 'not-a-time' }) })).toBeUndefined()
  })
})

describe('same release', () => {
  const base = { key: 'fred-rates-liquidity|2026-11-05', releasedAt: '2026-11-05T00:00:00.000Z' }

  it('accepts the other indicators of one publication inside the window', () => {
    expect(isSameAnalysisRelease(base, { ...base, releasedAt: '2026-11-05T00:02:00.000Z' })).toBe(true)
  })

  it('refuses a different reporting period even two minutes apart', () => {
    expect(isSameAnalysisRelease(base, { key: 'fred-rates-liquidity|2026-10-05', releasedAt: '2026-11-05T00:02:00.000Z' })).toBe(false)
  })

  it('refuses a different publisher carrying the same period', () => {
    expect(isSameAnalysisRelease(base, { key: 'bls-economic-series|2026-11-05', releasedAt: base.releasedAt })).toBe(false)
  })

  it('refuses the same period released after the window', () => {
    expect(isSameAnalysisRelease(base, { ...base, releasedAt: '2026-11-05T00:11:00.000Z' })).toBe(false)
  })

  it('uses ten minutes as the window', () => {
    expect(analysisReleaseCoalescingPolicy.windowMs).toBe(10 * 60 * 1_000)
  })
})

describe('covering release attempt', () => {
  const identity = { key: 'fred-rates-liquidity|2026-11-05', releasedAt: '2026-11-05T00:00:00.000Z' }
  const now = '2026-11-05T00:59:00.000Z'

  it('finds the attempt already allowed for this release', () => {
    expect(findCoveringReleaseAttempt({ identity, now, attempts: [{ identity, decidedAt: '2026-11-05T00:58:30.000Z' }] }))
      .toEqual({ identity, decidedAt: '2026-11-05T00:58:30.000Z' })
  })

  it('does not cover a release whose attempt has fallen outside the window', () => {
    expect(findCoveringReleaseAttempt({ identity, now, attempts: [{ identity, decidedAt: '2026-11-05T00:45:00.000Z' }] }))
      .toBeUndefined()
  })

  it('does not cover a different release published in the same minute', () => {
    expect(findCoveringReleaseAttempt({
      identity, now, attempts: [{ identity: { ...identity, key: 'fred-rates-liquidity|2026-10-05' }, decidedAt: '2026-11-05T00:58:30.000Z' }]
    })).toBeUndefined()
  })

  it('answers with the newest covering attempt when several exist', () => {
    expect(findCoveringReleaseAttempt({
      identity, now, attempts: [
        { identity, decidedAt: '2026-11-05T00:54:00.000Z' },
        { identity, decidedAt: '2026-11-05T00:58:00.000Z' }
      ]
    })?.decidedAt).toBe('2026-11-05T00:58:00.000Z')
  })
})
