import { describe, expect, it } from 'vitest'

import { computeNextCronRunAt } from './jobCronSchedule'

/**
 * `computeNextCronRunAt` is a 200-line pure parser/scheduler shared by the platform scheduler and the
 * agent task planner, and it is the piece whose failures are silent: a wrong answer arms a timer at
 * the wrong minute instead of throwing. These cases pin the timezone, calendar and rejection
 * behaviour directly, instead of only reaching them through `jobScheduler`.
 */

const iso = (startMs: number, expression: string, timezone?: string): string | null => {
  const next = computeNextCronRunAt(expression, timezone, startMs)
  return next === null ? null : new Date(next).toISOString()
}

describe('computeNextCronRunAt', () => {
  describe('minute resolution', () => {
    it('returns the next matching minute when the cursor is already on the minute', () => {
      expect(iso(Date.UTC(2026, 0, 1, 9, 0), '0 9 * * *', 'UTC')).toBe('2026-01-01T09:00:00.000Z')
    })

    it('skips a partially elapsed minute instead of firing within it', () => {
      // 09:00:45 is already past the 09:00 slot, so the next match is tomorrow.
      expect(iso(Date.UTC(2026, 0, 1, 9, 0, 45), '0 9 * * *', 'UTC')).toBe('2026-01-02T09:00:00.000Z')
    })

    it('matches every minute for "* * * * *"', () => {
      expect(iso(Date.UTC(2026, 0, 1, 9, 30), '* * * * *', 'UTC')).toBe('2026-01-01T09:30:00.000Z')
    })
  })

  describe('field syntax', () => {
    it('expands ranges, steps and lists', () => {
      const start = Date.UTC(2026, 0, 1, 9, 30)
      expect(iso(start, '0 9-17/4 * * *', 'UTC')).toBe('2026-01-01T13:00:00.000Z')
      expect(iso(start, '0 9,13,21 * * *', 'UTC')).toBe('2026-01-01T13:00:00.000Z')
      expect(iso(start, '15,45 10 * * *', 'UTC')).toBe('2026-01-01T10:15:00.000Z')
      expect(iso(Date.UTC(2026, 0, 1, 10, 20), '*/15 * * * *', 'UTC')).toBe('2026-01-01T10:30:00.000Z')
    })

    it('rejects malformed, out-of-range and empty-field expressions', () => {
      const start = Date.UTC(2026, 0, 1)
      for (const expression of [
        '',
        '0 9 * *',
        '0 9 * * * *',
        '60 * * * *',
        '* 24 * * *',
        '* * 0 * *',
        '* * 32 * *',
        '* * * 13 *',
        '* * * * 7',
        '*/0 * * * *',
        '5-1 * * * *',
        'a * * * *',
        '0 9 * * mon'
      ]) {
        expect(iso(start, expression, 'UTC')).toBeNull()
      }
    })

    it('rejects an unknown timezone instead of silently using UTC', () => {
      expect(iso(Date.UTC(2026, 0, 1), '0 9 * * *', 'Bad/Zone')).toBeNull()
    })
  })

  describe('calendar boundaries', () => {
    it('skips months that have no 31st', () => {
      expect(iso(Date.UTC(2026, 1, 1), '0 0 31 * *', 'UTC')).toBe('2026-03-31T00:00:00.000Z')
    })

    it('rolls a yearly expression to the next year', () => {
      expect(iso(Date.UTC(2026, 0, 2), '0 0 1 1 *', 'UTC')).toBe('2027-01-01T00:00:00.000Z')
    })

    it('returns null for a date that never exists', () => {
      // February never has 31 days, so the search window ends with no match.
      expect(iso(Date.UTC(2026, 0, 1), '0 0 31 2 *', 'UTC')).toBeNull()
    })

    it('returns null for a leap day beyond the one-year search window (known gap)', () => {
      // 2026-01-01 → 2028-02-29 is ~790 days, past `maxCronSearchAttempts` (365 days of minutes).
      // A leap-day cron therefore looks unschedulable: the scheduler arms no timer and the projection
      // shows no next run. Pinned here so changing the window, or rejecting the expression outright,
      // is a deliberate edit with a test to update.
      expect(iso(Date.UTC(2026, 0, 1), '0 0 29 2 *', 'UTC')).toBeNull()
    })
  })

  describe('timezone handling', () => {
    it('reads the calendar fields in the configured timezone', () => {
      // Monday 09:00 Asia/Shanghai is Sunday 01:00 UTC.
      expect(iso(Date.UTC(2026, 0, 1), '0 9 * * 1', 'Asia/Shanghai')).toBe('2026-01-05T01:00:00.000Z')
    })

    it('treats day-of-week 0 as Sunday in the configured timezone', () => {
      expect(iso(Date.UTC(2026, 0, 1), '0 9 * * 0', 'Asia/Shanghai')).toBe('2026-01-04T01:00:00.000Z')
    })

    it('falls back to UTC when no timezone is given', () => {
      expect(iso(Date.UTC(2026, 0, 1), '0 9 * * *', undefined)).toBe('2026-01-01T09:00:00.000Z')
    })

    it('skips a local time that does not exist when the clocks spring forward', () => {
      // 2027-03-14 02:30 America/New_York never happens (02:00 → 03:00), so the next 02:30 is the 15th.
      expect(iso(Date.UTC(2027, 2, 13, 12), '30 2 * * *', 'America/New_York')).toBe('2027-03-15T06:30:00.000Z')
    })

    it('fires a repeated local time once, at the earlier instant, when the clocks fall back', () => {
      // 2027-11-07 01:30 happens twice (EDT then EST); the earlier (EDT) instant is chosen.
      expect(iso(Date.UTC(2027, 10, 7, 0), '30 1 * * *', 'America/New_York')).toBe('2027-11-07T05:30:00.000Z')
    })
  })

  describe('unsafe input', () => {
    it('returns null for non-finite, non-integer and out-of-range start values', () => {
      for (const startMs of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER, 8_640_000_000_000_001]) {
        expect(computeNextCronRunAt('0 9 * * *', 'UTC', startMs)).toBeNull()
      }
    })
  })
})
