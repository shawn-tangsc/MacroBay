import { describe, expect, it, vi } from 'vitest'

import type { IntelligencePipeline } from '../application/intelligencePipeline'
import type { MetricIntelligenceEvent } from '../schema/intelligenceMetricEvent'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import { querySentimentOptionsCard, type OptionSkewStoredPoint } from './sentimentOptionsCardQuery'
import { computeOptionSkewDirection } from './sentimentOptionsCardPolicy'

const asOf = '2026-11-21T12:00:00.000Z'

describe('querySentimentOptionsCard', () => {
  it('fails closed for an invalid as-of, timezone or window', () => {
    for (const input of [
      { asOf: '2026-11-21T12:00:00Z', timeZone: 'Asia/Shanghai', windowDays: 30 as const },
      { asOf, timeZone: 'Mars/Olympus', windowDays: 30 as const },
      { asOf, timeZone: 'Asia/Shanghai', windowDays: 45 as never }
    ]) {
      expect(querySentimentOptionsCard({ ...input, pipeline: pipeline({}) })).toEqual({
        asOf: input.asOf,
        windowDays: input.windowDays,
        timeZone: input.timeZone,
        fearGreed: { state: 'unavailable', failureCode: 'fear-greed-query-unavailable' },
        optionSkew: { state: 'unavailable', failureCode: 'option-skew-query-unavailable' }
      })
    }
  })

  it('returns the latest day, a 30-day series and the percentile when 340 days are covered', () => {
    const fixture = history(340, (index) => index === 0 ? 50 : index <= 300 ? 10 : 90)
    const result = querySentimentOptionsCard({ asOf, timeZone: 'Asia/Shanghai', windowDays: 30, pipeline: pipeline(fixture) })

    expect(result.fearGreed.state).toBe('available')
    if (result.fearGreed.state !== 'available') return
    expect(result.fearGreed).toMatchObject({ score: 50, bucket: 'neutral', latestDay: '2026-11-19', daysAgo: 2, stale: true, seriesStart: '2025-12-15' })
    // 30 calendar days ending on the as-of day; the last two have no point yet (the source lags),
    // and that gap stays a gap rather than being filled.
    expect(result.fearGreed.points.map((point) => point.day)).toEqual([
      '2026-11-19', '2026-11-18', '2026-11-17', ...Array.from({ length: 25 }, (_unused, index) => dayBefore('2026-11-16', index))
    ])
    expect(result.fearGreed.percentile).toEqual({ value: 88, basisDays: 340, from: '2025-12-15', to: '2026-11-19' })
  })

  it('does not call 120 days a year: the percentile is absent, not zero', () => {
    const result = querySentimentOptionsCard({ asOf, timeZone: 'Asia/Shanghai', windowDays: 30, pipeline: pipeline(history(120, (index) => index)) })

    expect(result.fearGreed.state).toBe('available')
    if (result.fearGreed.state !== 'available') return
    expect(result.fearGreed.percentile).toBeUndefined()
  })

  it('clamps days-ago at 0 when the reader local day is behind the source day', () => {
    const result = querySentimentOptionsCard({
      asOf: '2026-11-19T02:00:00.000Z',
      timeZone: 'America/Los_Angeles',
      windowDays: 30,
      pipeline: pipeline(history(30, () => 40))
    })

    expect(result.fearGreed.state).toBe('available')
    if (result.fearGreed.state !== 'available') return
    expect(result.fearGreed.latestDay).toBe('2026-11-19')
    expect(result.fearGreed.daysAgo).toBe(0)
  })

  it('marks a reading older than 36 hours as stale but keeps the value', () => {
    const result = querySentimentOptionsCard({ asOf, timeZone: 'Asia/Shanghai', windowDays: 30, pipeline: pipeline(history(30, () => 40)) })

    expect(result.fearGreed.state).toBe('available')
    if (result.fearGreed.state !== 'available') return
    expect(result.fearGreed.stale).toBe(true)
    expect(result.fearGreed.score).toBe(40)
  })

  it('returns empty for the fear side when the store has no visible day at all', () => {
    const result = querySentimentOptionsCard({ asOf, timeZone: 'UTC', windowDays: 30, pipeline: pipeline({}) })
    expect(result.fearGreed).toEqual({ state: 'empty' })
  })

  it('reads "not connected" for the skew half while the source is planned, without touching a store', () => {
    const readOptionSkew = vi.fn(() => ({ points: [] }))
    const result = querySentimentOptionsCard({ asOf, timeZone: 'UTC', windowDays: 30, pipeline: pipeline(history(30, () => 40)), readOptionSkew })

    expect(result.optionSkew).toEqual({ state: 'not-connected' })
    expect(readOptionSkew).not.toHaveBeenCalled()
  })

  it('separates "no skew day yet" from "the latest pull failed"', () => {
    const base = { asOf, timeZone: 'UTC', windowDays: 30 as const, pipeline: pipeline(history(30, () => 40)), readSkewReadiness: () => 'live' }
    expect(querySentimentOptionsCard({ ...base, readOptionSkew: () => ({ points: [] }) }).optionSkew).toEqual({ state: 'empty' })
    expect(querySentimentOptionsCard({ ...base, readOptionSkew: () => ({ points: [], lastFailureCause: 'upstream-http-error' }) }).optionSkew)
      .toEqual({ state: 'unavailable', failureCode: 'option-skew-collect-unavailable', cause: 'upstream-http-error' })
  })

  it('degrades only the skew half when the store cannot be read', () => {
    // A corrupt or unreadable point store must not take the fear-greed half down with it: the card
    // reports one leg as unreadable and keeps the other.
    const result = querySentimentOptionsCard({
      asOf,
      timeZone: 'UTC',
      windowDays: 30,
      pipeline: pipeline(history(30, () => 40)),
      readSkewReadiness: () => 'live',
      readOptionSkew: () => { throw new Error('option-skew store is unreadable') }
    })
    expect(result.optionSkew).toEqual({ state: 'unavailable', failureCode: 'option-skew-query-unavailable' })
    expect(result.fearGreed.state).toBe('available')
  })

  it('computes skew direction from the whole series, not from the chart window', () => {
    const points = skewHistory([3.0, 2.8, 2.6, 2.4, 2.2, 2.0, 1.8, 1.6, 1.4, 1.2])
    const base = { asOf, timeZone: 'UTC', pipeline: pipeline(history(30, () => 40)), readOptionSkew: () => ({ points }), readSkewReadiness: () => 'live' }

    const wide = querySentimentOptionsCard({ ...base, windowDays: 90 })
    const narrow = querySentimentOptionsCard({ ...base, windowDays: 30 })

    expect(wide.optionSkew.state).toBe('available')
    expect(narrow.optionSkew.state).toBe('available')
    if (wide.optionSkew.state !== 'available' || narrow.optionSkew.state !== 'available') return
    expect(wide.optionSkew.direction).toEqual({ kind: 'steeper' })
    expect(narrow.optionSkew.direction).toEqual({ kind: 'steeper' })
    expect(wide.optionSkew.points.length).toBe(10)
  })
})

describe('computeOptionSkewDirection', () => {
  const day = (offset: number): string => new Date(Date.parse('2026-11-19T00:00:00.000Z') - offset * 86_400_000).toISOString().slice(0, 10)
  const series = (values: number[]): Array<{ day: string; riskReversal: number }> => values.map((riskReversal, index) => ({ day: day(index), riskReversal }))

  it('is stale before anything else when the latest day is more than two days old', () => {
    expect(computeOptionSkewDirection({ points: series([3, 2, 1, 0, -1]), daysAgo: 3 })).toEqual({ kind: 'unknown', reason: 'stale' })
  })

  it('is insufficient below five non-empty days', () => {
    expect(computeOptionSkewDirection({ points: series([3, 2, 1, 0]), daysAgo: 0 })).toEqual({ kind: 'unknown', reason: 'insufficient' })
  })

  it('is discontinuous when five points span more than ten days', () => {
    const points = [
      { day: day(0), riskReversal: 3 },
      { day: day(4), riskReversal: 2 },
      { day: day(8), riskReversal: 1 },
      { day: day(12), riskReversal: 0 },
      { day: day(16), riskReversal: -1 }
    ]
    expect(computeOptionSkewDirection({ points, daysAgo: 0 })).toEqual({ kind: 'unknown', reason: 'discontinuous' })
  })

  it('treats less than half a point as "basically unchanged"', () => {
    expect(computeOptionSkewDirection({ points: series([3, 2.9, 3.1, 3.0, 2.6]), daysAgo: 0 })).toEqual({ kind: 'flat' })
  })

  it('names the two directions', () => {
    expect(computeOptionSkewDirection({ points: series([3, 2.5, 2, 1.5, 1]), daysAgo: 0 })).toEqual({ kind: 'steeper' })
    expect(computeOptionSkewDirection({ points: series([1, 1.5, 2, 2.5, 3]), daysAgo: 0 })).toEqual({ kind: 'flatter' })
  })
})

function dayBefore(anchor: string, offset: number): string {
  return new Date(Date.parse(`${anchor}T00:00:00.000Z`) - offset * 86_400_000).toISOString().slice(0, 10)
}

function history(days: number, scoreFor: (index: number) => number): { metrics: MetricIntelligenceEvent[]; items: IntelligenceItem[] } {
  const metrics: MetricIntelligenceEvent[] = []
  const items: IntelligenceItem[] = []
  for (let index = 0; index < days; index += 1) {
    const releaseTime = new Date(Date.parse('2026-11-19T00:00:00.000Z') - index * 86_400_000).toISOString()
    const id = `item-${index}`
    metrics.push({
      metricEventId: `metric-${index}`, itemId: id, sourceId: 'alternative-fear-greed', metricKey: 'FEAR_GREED_INDEX',
      metricName: 'Fear & Greed Index', metricKind: 'fear-greed', actual: scoreFor(index), releaseTime,
      comparisonBasis: 'level', surpriseDirection: 'unknown', metricVersion: 'v1'
    })
    items.push({
      itemId: id, primaryRawRecordId: `raw-${index}`, canonicalDedupeKey: `dedupe-${index}`, sourceId: 'alternative-fear-greed',
      eventType: 'metric', title: 'Fear & Greed', sourceCategory: 'metric', sourceTrust: 'aggregator',
      detectedAt: releaseTime, timelineStatus: 'evaluated', normalizerVersion: 'v1'
    })
  }
  return { metrics, items }
}

function skewHistory(values: number[]): OptionSkewStoredPoint[] {
  return values.map((riskReversal, index) => {
    const observedAt = new Date(Date.parse('2026-11-19T08:00:00.000Z') - index * 86_400_000).toISOString()
    return {
      day: observedAt.slice(0, 10), observedAt, riskReversal, putIv25: 55 + riskReversal / 2, callIv25: 55 - riskReversal / 2,
      tenorDays: 30, expiries: ['2026-12-18T08:00:00.000Z', '2027-01-15T08:00:00.000Z']
    }
  })
}

function pipeline(input: { metrics?: MetricIntelligenceEvent[]; items?: IntelligenceItem[] }): IntelligencePipeline {
  return {
    listMetricEvents: () => input.metrics ?? [],
    listItems: () => input.items ?? []
  } as IntelligencePipeline
}