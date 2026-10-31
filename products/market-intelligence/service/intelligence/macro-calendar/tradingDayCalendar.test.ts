import { describe, expect, it } from 'vitest'

import {
  isUsEquityTradingDay,
  lastCompletedUsSession,
  nextUsEquityTradingDay,
  previousUsEquityTradingDay,
  tradingDaysBetween,
  tradingSessionsBehind,
  usEquityHoliday
} from './tradingDayCalendar'

describe('US equity trading day calendar', () => {
  it('closes on weekends and names the holidays it observes', () => {
    expect(isUsEquityTradingDay('2026-10-31')).toBe(false) // Saturday
    expect(isUsEquityTradingDay('2026-11-01')).toBe(false) // Sunday
    expect(isUsEquityTradingDay('2026-10-30')).toBe(true) // Friday
    expect(usEquityHoliday('2026-01-19')).toBe('martin-luther-king')
    expect(usEquityHoliday('2026-04-03')).toBe('good-friday')
    expect(usEquityHoliday('2026-11-26')).toBe('thanksgiving')
    expect(usEquityHoliday('2026-12-25')).toBe('christmas')
    expect(usEquityHoliday('2026-07-03')).toBe('independence-day') // July 4 falls on a Saturday
    expect(usEquityHoliday('2026-10-30')).toBeUndefined()
  })

  it('shifts a fixed-date holiday off the weekend to the observed weekday', () => {
    // 2022-01-01 was a Saturday: the exchange closed on Friday 2021-12-31.
    expect(usEquityHoliday('2021-12-31')).toBe('new-year')
    // 2022-12-25 was a Sunday: the exchange closed on Monday 2022-12-26.
    expect(usEquityHoliday('2022-12-26')).toBe('christmas')
  })

  it('walks back over a weekend and a holiday to the last session', () => {
    expect(previousUsEquityTradingDay('2026-11-01')).toBe('2026-10-30') // Sunday -> Friday
    expect(previousUsEquityTradingDay('2026-11-02')).toBe('2026-10-30')
    // Thanksgiving Thursday closes the exchange; the shortened Friday after it still trades.
    expect(previousUsEquityTradingDay('2026-11-27')).toBe('2026-11-25')
    expect(nextUsEquityTradingDay('2026-11-25')).toBe('2026-11-27')
    expect(nextUsEquityTradingDay('2026-11-27')).toBe('2026-11-30')
  })

  it('counts trading days rather than calendar days between two sessions', () => {
    expect(tradingDaysBetween('2026-10-30', '2026-11-02')).toBe(1) // Friday -> Monday
    expect(tradingDaysBetween('2026-10-30', '2026-11-03')).toBe(2)
    expect(tradingDaysBetween('2026-11-25', '2026-11-30')).toBe(2) // over Thanksgiving
    expect(tradingDaysBetween('2026-11-02', '2026-10-30')).toBe(0)
  })

  it('knows which session has closed at a brief generation instant', () => {
    // 2026-11-02T00:30Z is Sunday 19:30 in New York: Friday's close is the newest one.
    expect(lastCompletedUsSession('2026-11-02T00:30:00.000Z')).toBe('2026-10-30')
    // 2026-11-02T22:00Z is Monday 17:00 in New York: Monday's close has just finished.
    expect(lastCompletedUsSession('2026-11-02T22:00:00.000Z')).toBe('2026-11-02')
    // A holiday Monday is still Sunday's answer, one session earlier.
    expect(lastCompletedUsSession('2026-01-19T23:00:00.000Z')).toBe('2026-01-16')
  })

  it('measures how many sessions an observation is behind the expected one', () => {
    expect(tradingSessionsBehind('2026-10-30T00:00:00.000Z', '2026-11-02T00:30:00.000Z')).toBe(0)
    expect(tradingSessionsBehind('2026-10-29T00:00:00.000Z', '2026-11-02T00:30:00.000Z')).toBe(1)
    expect(tradingSessionsBehind('2026-10-30T00:00:00.000Z', '2026-11-06T00:30:00.000Z')).toBe(4)
    // An unreadable instant is unknown, not "one session behind".
    expect(tradingSessionsBehind('not-a-day', '2026-11-02T00:30:00.000Z')).toBeUndefined()
    expect(tradingSessionsBehind('2026-10-30T00:00:00.000Z', 'not-an-instant')).toBeUndefined()
  })
})
