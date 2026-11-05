import { describe, expect, it, vi } from 'vitest'

import {
  BRIEFING_CALENDAR_CATCH_UP_TIMEOUT_MS,
  ensureCalendarFreshForRun,
  isFreshAt
} from './dailyBriefingCalendarCatchUp'

const dataAsOf = '2026-11-05T07:00:00.000Z'
const twoHoursAgo = '2026-11-05T05:00:00.000Z'
/** The real shape of the 2026-11-05 edition: last success 42 hours before the cutoff. */
const staleAt = '2026-11-03T13:27:00.000Z'

function freshness(lastCollectedAt: string | null, attempt?: { attemptedAt: string; state: 'succeeded' | 'failed' }) {
  return {
    state: 'available' as const,
    asOf: dataAsOf,
    lastCollectedAt,
    sources: (['macro-calendar-0xrouter-economic-data', 'macro-calendar-0xrouter-financial-events', 'macro-calendar-0xrouter-central-bank-activities'] as const)
      .map((descriptorId) => ({ descriptorId, lastCollectedAt, ...(attempt ? { latestAttempt: attempt } : {}) }))
  }
}

describe('ensureCalendarFreshForRun', () => {
  it('skips the catch-up when the last success is inside the two-hour window', async () => {
    const refreshNow = vi.fn()
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true, refreshNow,
      readFreshness: async () => freshness(twoHoursAgo)
    })

    expect(reading).toMatchObject({ state: 'available', lastCollectedAt: twoHoursAgo, catchUp: { state: 'skipped' } })
    expect(refreshNow).not.toHaveBeenCalled()
  })

  it('catches up once for a stale calendar and decides from the reading taken afterwards', async () => {
    const refreshNow = vi.fn(async () => ({ state: 'collected' as const, sources: ['macro-calendar-0xrouter-economic-data'] }))
    const reads = [freshness(staleAt), freshness(dataAsOf)]
    let call = 0
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true, refreshNow,
      readFreshness: async () => reads[call++]!
    })

    // Only the post-catch-up reading decides: the edition must not report 42 hours of staleness it
    // has just replaced, and must not report freshness it had not seen.
    expect(reading).toMatchObject({ state: 'available', lastCollectedAt: dataAsOf, catchUp: { state: 'collected' } })
    expect(refreshNow).toHaveBeenCalledTimes(1)
    expect(refreshNow).toHaveBeenCalledWith({ sourceIds: expect.any(Array), timeoutMs: BRIEFING_CALENDAR_CATCH_UP_TIMEOUT_MS })
    expect(call).toBe(2)
  })

  it('keeps the stale reading when the catch-up runs out of time, and reports a timeout', async () => {
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true,
      refreshNow: async () => ({ state: 'timeout' as const, timeoutMs: 90_000 }),
      readFreshness: async () => freshness(staleAt)
    })

    // A timeout is its own verdict, not a failure, and the reading stays stale rather than fresh.
    expect(reading).toEqual({ state: 'available', lastCollectedAt: staleAt, catchUp: { state: 'timeout', timeoutMs: 90_000 } })
  })

  it('records a failed catch-up as failed, never as timeout', async () => {
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true,
      refreshNow: async () => ({ state: 'failed' as const, failureCode: 'credential-not-configured' }),
      readFreshness: async () => freshness(staleAt)
    })

    expect(reading.catchUp).toEqual({ state: 'failed', failureCode: 'credential-not-configured' })
  })

  it('treats a throwing command as a failure, and keeps going', async () => {
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true,
      refreshNow: async () => { throw new Error('queue closed') },
      readFreshness: async () => freshness(staleAt)
    })

    expect(reading.catchUp).toEqual({ state: 'failed', failureCode: 'queue closed' })
  })

  it('answers "not wired" — not "nothing" — when no freshness reader was injected', async () => {
    const reading = await ensureCalendarFreshForRun({ dataAsOf, enabled: true })

    expect(reading.state).toBe('not-wired')
    expect(reading.catchUp).toBeUndefined()
  })

  it('answers "unavailable" when the bound reader fails, keeping it distinct from not wired', async () => {
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true,
      readFreshness: async () => ({ state: 'unavailable', failureCode: 'query-unavailable' })
    })

    expect(reading.state).toBe('unavailable')
  })

  it('does nothing at all while the reader has the calendar switched off', async () => {
    const refreshNow = vi.fn()
    const readFreshness = vi.fn()
    const reading = await ensureCalendarFreshForRun({ dataAsOf, enabled: false, refreshNow, readFreshness })

    expect(reading.state).toBe('source-disabled')
    expect(readFreshness).not.toHaveBeenCalled()
    expect(refreshNow).not.toHaveBeenCalled()
  })

  it('reports the latest attempt across the feeds, so "the last try failed" is about the try', async () => {
    const reading = await ensureCalendarFreshForRun({
      dataAsOf, enabled: true,
      readFreshness: async () => freshness(staleAt, { attemptedAt: '2026-11-05T06:40:00.000Z', state: 'failed' })
    })

    expect(reading).toMatchObject({ lastAttemptAt: '2026-11-05T06:40:00.000Z', lastAttemptFailed: true })
  })
})

describe('isFreshAt', () => {
  it('accepts exactly two hours and rejects a minute more', () => {
    expect(isFreshAt(twoHoursAgo, dataAsOf)).toBe(true)
    expect(isFreshAt('2026-11-05T04:59:00.000Z', dataAsOf)).toBe(false)
  })

  it('treats "never collected" as not fresh', () => {
    expect(isFreshAt(null, dataAsOf)).toBe(false)
    expect(isFreshAt(undefined, dataAsOf)).toBe(false)
  })
})
