import { describe, expect, it } from 'vitest'

import { isNewsSentimentOutOfDate, newsSentimentOutOfDateAfterMs } from './newsSentimentFreshness'

const readiness = (maxCollectionIntervalMs?: number) => ({
  total: 4, enabledCount: 4, failedCount: 0, neverRanCount: 0,
  failedSourceIds: [], neverRanSourceIds: [],
  ...(maxCollectionIntervalMs ? { maxCollectionIntervalMs } : {})
})

describe('news sentiment freshness', () => {
  it('derives the age threshold from the collection cadence, not a constant', () => {
    expect(newsSentimentOutOfDateAfterMs(readiness(30 * 60_000))).toBe(90 * 60_000)
    expect(newsSentimentOutOfDateAfterMs(readiness(15 * 60_000))).toBe(45 * 60_000)
    // A manual source has no cadence, so no threshold and no badge — the card cannot claim age.
    expect(newsSentimentOutOfDateAfterMs(readiness())).toBeUndefined()
  })

  it('calls rows old only past three cycles', () => {
    const at = (ms: number) => new Date(Date.UTC(2026, 9, 24, 13, 0, 0) - ms).toISOString()
    const base = { asOf: '2026-10-24T13:00:00.000Z', readiness: readiness(30 * 60_000) }
    expect(isNewsSentimentOutOfDate({ ...base, latestKnownItemAt: at(89 * 60_000) })).toBe(false)
    expect(isNewsSentimentOutOfDate({ ...base, latestKnownItemAt: at(91 * 60_000) })).toBe(true)
    // No newest judgment, or no readable instant: nothing to call old.
    expect(isNewsSentimentOutOfDate({ ...base })).toBe(false)
    expect(isNewsSentimentOutOfDate({ ...base, latestKnownItemAt: 'not-a-time' })).toBe(false)
  })
})
