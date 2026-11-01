import { describe, expect, it } from 'vitest'

import type { MetricIntelligenceEvent } from '../schema/intelligenceMetricEvent'
import { readPublishedTargetRange } from './readPublishedTargetRange'

const event = (overrides: Partial<MetricIntelligenceEvent>): MetricIntelligenceEvent => ({
  metricEventId: 'e', itemId: 'i', sourceId: 'fred-rates-liquidity', metricKey: 'FED_TARGET_RANGE_UPPER',
  metricName: 'x', metricKind: 'rate', actual: 4, unit: 'percent', period: '2026-10-28',
  releaseTime: '2026-10-28T00:00:00.000Z', comparisonBasis: 'level', surpriseDirection: 'inline',
  ...overrides
} as MetricIntelligenceEvent)

describe('published target range', () => {
  it('takes the newest of each bound', () => {
    expect(readPublishedTargetRange([
      event({ metricKey: 'FED_TARGET_RANGE_UPPER', actual: 4, releaseTime: '2026-10-28T00:00:00.000Z' }),
      event({ metricKey: 'FED_TARGET_RANGE_LOWER', actual: 3.75, releaseTime: '2026-10-28T00:00:00.000Z' }),
      event({ metricKey: 'FED_TARGET_RANGE_UPPER', actual: 3.5, releaseTime: '2026-09-17T00:00:00.000Z' })
    ])).toEqual({ lowerPercent: 3.75, upperPercent: 4 })
  })

  it('refuses a half range or an inverted one', () => {
    expect(readPublishedTargetRange([event({ metricKey: 'FED_TARGET_RANGE_UPPER' })])).toBeUndefined()
    expect(readPublishedTargetRange([
      event({ metricKey: 'FED_TARGET_RANGE_UPPER', actual: 3.5 }),
      event({ metricKey: 'FED_TARGET_RANGE_LOWER', actual: 3.75 })
    ])).toBeUndefined()
  })

  it('ignores events from other sources', () => {
    expect(readPublishedTargetRange([
      event({ sourceId: 'other', metricKey: 'FED_TARGET_RANGE_UPPER' }),
      event({ sourceId: 'other', metricKey: 'FED_TARGET_RANGE_LOWER' })
    ])).toBeUndefined()
  })
})
