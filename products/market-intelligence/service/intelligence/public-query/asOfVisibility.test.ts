import { describe, expect, it } from 'vitest'

import { MARKET_INTELLIGENCE_QUERY_CAVEATS } from './queryContracts'
import {
  compareIsoTime,
  isValidIsoTime,
  isVisibleAsOf,
  isWithinEventTimeWindow,
  normalizeMaxItems,
  normalizeTimeWindow,
  VISIBLE_AT
} from './asOfVisibility'

describe('asOfVisibility', () => {
  it('hides items when detectedAt is after asOf even if publishedAt is earlier', () => {
    const item = {
      detectedAt: '2026-07-08T11:30:00.000Z',
      publishedAt: '2026-07-08T10:00:00.000Z'
    }
    expect(isVisibleAsOf(VISIBLE_AT.item(item), '2026-07-08T10:30:00.000Z')).toBe(false)
    expect(isVisibleAsOf(item.publishedAt, '2026-07-08T10:30:00.000Z')).toBe(true)
  })

  it('hides impacts and sentiment aggregates updated after asOf', () => {
    expect(isVisibleAsOf(VISIBLE_AT.impact({ createdAt: '2026-07-08T11:00:00.000Z' }), '2026-07-08T10:00:00.000Z')).toBe(
      false
    )
    expect(
      isVisibleAsOf(VISIBLE_AT.sentimentAggregate({ updatedAt: '2026-07-08T11:00:00.000Z' }), '2026-07-08T10:00:00.000Z')
    ).toBe(false)
  })

  it('treats missing visible timestamps as not visible', () => {
    expect(isVisibleAsOf(undefined, '2026-07-08T10:00:00.000Z')).toBe(false)
    expect(compareIsoTime(undefined, '2026-07-08T10:00:00.000Z')).toBeLessThan(0)
  })

  it('treats invalid visibleAt and asOf timestamps as not visible', () => {
    expect(isVisibleAsOf('not-a-date', '2026-07-08T10:00:00.000Z')).toBe(false)
    expect(isVisibleAsOf('2026-07-08T09:00:00.000Z', 'not-a-date')).toBe(false)
    expect(isVisibleAsOf('not-a-date', 'also-invalid')).toBe(false)
    expect(isValidIsoTime('not-a-date')).toBe(false)
    expect(isValidIsoTime('2026-07-08T10:00:00.000Z')).toBe(true)
  })

  it('sorts invalid timestamps after valid timestamps in compareIsoTime', () => {
    expect(compareIsoTime('not-a-date', '2026-07-08T10:00:00.000Z')).toBeGreaterThan(0)
    expect(compareIsoTime('2026-07-08T10:00:00.000Z', 'not-a-date')).toBeLessThan(0)
    expect(compareIsoTime('not-a-date', 'also-invalid')).toBe(0)
  })

  it('rejects invalid from, to, and asOf when normalizing time windows', () => {
    const invalidAsOf = normalizeTimeWindow({
      asOf: 'not-a-date',
      from: '2026-07-08T08:00:00.000Z',
      to: '2026-07-08T09:00:00.000Z'
    })
    expect(invalidAsOf.asOf).toBe('not-a-date')
    expect(invalidAsOf.to).toBe('2026-07-08T09:00:00.000Z')
    expect(invalidAsOf.from).toBe('2026-07-08T08:00:00.000Z')
    expect(invalidAsOf.caveats).toContain(MARKET_INTELLIGENCE_QUERY_CAVEATS.invalidVisibleTimestamp)
    expect(isVisibleAsOf('2026-07-08T08:30:00.000Z', invalidAsOf.asOf)).toBe(false)

    const invalidTo = normalizeTimeWindow({
      asOf: '2026-07-08T10:00:00.000Z',
      to: 'not-a-date'
    })
    expect(invalidTo.to).toBe('2026-07-08T10:00:00.000Z')
    expect(invalidTo.caveats).toContain(MARKET_INTELLIGENCE_QUERY_CAVEATS.invalidVisibleTimestamp)

    const invalidFrom = normalizeTimeWindow({
      asOf: '2026-07-08T10:00:00.000Z',
      from: 'not-a-date'
    })
    expect(invalidFrom.from).toBeUndefined()
    expect(invalidFrom.caveats).toContain(MARKET_INTELLIGENCE_QUERY_CAVEATS.invalidVisibleTimestamp)
  })

  it('excludes invalid event timestamps from event windows', () => {
    const window = normalizeTimeWindow({
      asOf: '2026-07-08T10:00:00.000Z',
      from: '2026-07-08T08:00:00.000Z'
    })

    expect(isWithinEventTimeWindow('not-a-date', window)).toBe(false)
    expect(isWithinEventTimeWindow('2026-07-08T09:00:00.000Z', window)).toBe(true)
    expect(
      isWithinEventTimeWindow('2026-07-08T09:00:00.000Z', {
        from: 'not-a-date',
        to: '2026-07-08T10:00:00.000Z'
      })
    ).toBe(true)
    expect(
      isWithinEventTimeWindow('2026-07-08T09:00:00.000Z', {
        from: '2026-07-08T08:00:00.000Z',
        to: 'not-a-date'
      })
    ).toBe(false)
  })

  it('normalizes time windows and lookback caveats', () => {
    const window = normalizeTimeWindow({
      asOf: '2026-07-08T10:00:00.000Z',
      from: '2026-07-08T08:00:00.000Z',
      lookbackWindowMs: 3_600_000
    })

    expect(window.to).toBe('2026-07-08T10:00:00.000Z')
    expect(window.from).toBe('2026-07-08T08:00:00.000Z')
    expect(window.caveats).toContain(MARKET_INTELLIGENCE_QUERY_CAVEATS.explicitWindowOverrodeLookback)
  })

  it('derives from using lookbackWindowMs when from is absent', () => {
    const window = normalizeTimeWindow({
      asOf: '2026-07-08T10:00:00.000Z',
      lookbackWindowMs: 3_600_000
    })

    expect(window.from).toBe('2026-07-08T09:00:00.000Z')
  })

  it('caps maxItems at 100', () => {
    expect(normalizeMaxItems(500)).toEqual({ value: 100, truncated: true })
    expect(normalizeMaxItems(undefined)).toEqual({ value: 20, truncated: false })
  })
})
