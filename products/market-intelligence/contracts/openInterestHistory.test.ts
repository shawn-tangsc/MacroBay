import { describe, expect, it } from 'vitest'

import {
  isCanonicalOpenInterestTime,
  isOpenInterestChange,
  isOpenInterestNotional,
  isOpenInterestSeries,
  isOpenInterestWindow,
  openInterestHistoryPolicy,
  openInterestUnavailable,
  openInterestWindows
} from './openInterestHistory'

const point = (offsetMs: number, notionalUsd = 8_000_000_000) => ({
  observedAt: new Date(Date.UTC(2026, 9, 29, 0, 0) + offsetMs).toISOString(),
  notionalUsd
})

describe('open interest policy', () => {
  it('pins the request limits the endpoint actually enforces', () => {
    expect(openInterestHistoryPolicy.requestLimit).toEqual({ openInterest: 500, klines: 672 })
    expect(openInterestHistoryPolicy.storedPeriod).toBe('15m')
    expect(openInterestHistoryPolicy.maximumDtoBytes).toBe(32 * 1024)
    expect(Object.isFrozen(openInterestHistoryPolicy)).toBe(true)
    expect([...openInterestWindows]).toEqual(['7d', '24h'])
  })

  it('allows 172 points on the 7-day window, because the fold yields 168 or 169', () => {
    expect(openInterestHistoryPolicy.windows['7d'].maximumPointsPerAsset).toBe(172)
    expect(openInterestHistoryPolicy.windows['24h'].maximumPointsPerAsset).toBe(100)
  })
})

describe('open interest guards', () => {
  it('accepts only canonical UTC instants with milliseconds', () => {
    expect(isCanonicalOpenInterestTime('2026-10-29T00:00:00.000Z')).toBe(true)
    expect(isCanonicalOpenInterestTime('2026-10-29T00:00:00Z')).toBe(false)
    expect(isCanonicalOpenInterestTime('2026-10-29T00:00:00.000+08:00')).toBe(false)
    expect(isCanonicalOpenInterestTime(1_790_000_000_000)).toBe(false)
    expect(isCanonicalOpenInterestTime('2026-02-30T00:00:00.000Z')).toBe(false)
  })

  it('accepts a notional amount only when it is a finite, non-negative number', () => {
    expect(isOpenInterestNotional(0)).toBe(true)
    expect(isOpenInterestNotional(8_000_000_000.12345678)).toBe(true)
    expect(isOpenInterestNotional(-1)).toBe(false)
    expect(isOpenInterestNotional(Number.NaN)).toBe(false)
    expect(isOpenInterestNotional(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isOpenInterestNotional('8000000000')).toBe(false)
  })

  it('rejects a change that cannot be a percentage', () => {
    expect(isOpenInterestChange(-6.5)).toBe(true)
    expect(isOpenInterestChange(0)).toBe(true)
    expect(isOpenInterestChange(Number.NaN)).toBe(false)
    expect(isOpenInterestChange(10_000)).toBe(false)
  })

  it('admits exactly the two display windows', () => {
    expect(isOpenInterestWindow('7d')).toBe(true)
    expect(isOpenInterestWindow('24h')).toBe(true)
    expect(isOpenInterestWindow('30d')).toBe(false)
    expect(isOpenInterestWindow(undefined)).toBe(false)
  })

  it('returns the one failure code clients are allowed to recognise', () => {
    expect(openInterestUnavailable()).toEqual({ state: 'unavailable', failureCode: 'open-interest-history-query-unavailable' })
  })
})

describe('open interest series guard', () => {
  const asOf = '2026-10-29T00:00:00.000Z'

  it('accepts a strictly ascending series that ends at or before asOf', () => {
    expect(isOpenInterestSeries([point(-90 * 60_000), point(-30 * 60_000), point(0)], asOf)).toBe(true)
  })

  it('rejects out-of-order, duplicated or future points instead of sorting them', () => {
    expect(isOpenInterestSeries([point(-30 * 60_000), point(-90 * 60_000)], asOf)).toBe(false)
    expect(isOpenInterestSeries([point(-60 * 60_000), point(-60 * 60_000)], asOf)).toBe(false)
    expect(isOpenInterestSeries([point(15 * 60_000)], asOf)).toBe(false)
  })

  it('rejects a malformed point rather than dropping it', () => {
    expect(isOpenInterestSeries([{ observedAt: '2026-10-29T00:00:00.000Z' }], asOf)).toBe(false)
    expect(isOpenInterestSeries([{ observedAt: asOf, notionalUsd: -1 }], asOf)).toBe(false)
    expect(isOpenInterestSeries([null], asOf)).toBe(false)
    expect(isOpenInterestSeries('nope', asOf)).toBe(false)
  })

  it('refuses more points than the widest window allows', () => {
    const tooMany = Array.from({ length: 173 }, (_, index) => point(-index * 60_000))
    expect(isOpenInterestSeries([point(0)], asOf)).toBe(true)
    expect(isOpenInterestSeries(tooMany.reverse(), asOf)).toBe(false)
  })
})
