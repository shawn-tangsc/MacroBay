import { describe, expect, it } from 'vitest'

import {
  batchesForSpan,
  bucketPeriodLabel,
  bucketsInSpan,
  openInterestBucketPolicy,
  isBucketPolicyValid,
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
    // Per-request caps, not coverage: coverage is the batch count below.
    expect(openInterestHistoryPolicy.requestLimit).toEqual({ openInterest: 500, klines: 1000 })
    expect(openInterestHistoryPolicy.storedPeriod).toBe('15m')
    expect(openInterestHistoryPolicy.maximumDtoBytes).toBe(32 * 1024)
    expect(Object.isFrozen(openInterestHistoryPolicy)).toBe(true)
    expect([...openInterestWindows]).toEqual(['7d', '24h'])
  })

  it('derives the lookback and the request limits from the bucket width, not from a count', () => {
    // The assertion that would have caught the regression: `96 bars` is a day at fifteen minutes
    // and eight hours at five. A count encodes the bucket width it was written for.
    expect(openInterestBucketPolicy.storageBucketMs).toBe(900_000)
    expect(openInterestBucketPolicy.signalBucketMs).toBe(900_000)
    expect(bucketsInSpan(86_400_000, openInterestBucketPolicy.signalBucketMs)).toBe(96)
    expect(bucketsInSpan(86_400_000, 5 * 60_000)).toBe(288)
    expect(bucketsInSpan(7 * 86_400_000, openInterestBucketPolicy.storageBucketMs)).toBe(672)
    expect(bucketsInSpan(7 * 86_400_000, 5 * 60_000)).toBe(2016)
    expect(bucketPeriodLabel(openInterestBucketPolicy.storageBucketMs)).toBe('15m')
    expect(bucketPeriodLabel(5 * 60_000)).toBe('5m')
  })

  it('plans a cold start in pages, and the page count follows the bucket width', () => {
    // Seven days in buckets at the current storage width, split by each endpoint's cap. The two
    // numbers the architect named: five pages of open interest and three of klines at five
    // minutes; two and one when the bucket goes back to fifteen.
    expect(batchesForSpan(7 * 86_400_000, openInterestHistoryPolicy.requestLimit.openInterest, 5 * 60_000)).toBe(5)
    expect(batchesForSpan(7 * 86_400_000, openInterestHistoryPolicy.requestLimit.klines, 5 * 60_000)).toBe(3)
    expect(batchesForSpan(7 * 86_400_000, openInterestHistoryPolicy.requestLimit.openInterest, 900_000)).toBe(2)
    expect(batchesForSpan(7 * 86_400_000, openInterestHistoryPolicy.requestLimit.klines, 900_000)).toBe(1)
  })

  it('keeps the judgement bucket at or above the storage bucket, and a whole multiple of it', () => {
    // Finer than storage could only be interpolation, and an interpolated reading is invented.
    expect(isBucketPolicyValid()).toBe(true)
    expect(isBucketPolicyValid({ storageBucketMs: 900_000, signalBucketMs: 900_000 })).toBe(true)
    expect(isBucketPolicyValid({ storageBucketMs: 300_000, signalBucketMs: 900_000 })).toBe(true)
    // The pair the architect named: a 5-minute judgement over 15-minute storage must be refused.
    expect(isBucketPolicyValid({ storageBucketMs: 900_000, signalBucketMs: 300_000 })).toBe(false)
    expect(isBucketPolicyValid({ storageBucketMs: 900_000, signalBucketMs: 600_000 })).toBe(false)
    expect(isBucketPolicyValid({ storageBucketMs: 0, signalBucketMs: 900_000 })).toBe(false)
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
