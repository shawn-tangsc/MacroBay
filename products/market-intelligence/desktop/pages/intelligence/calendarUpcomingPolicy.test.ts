import { expect, it } from 'vitest'
import { calendarUpcomingPolicy } from './calendarUpcomingPolicy'

it('states every card number once, frozen', () => {
  expect(calendarUpcomingPolicy.version).toBe('marketIntelligenceCalendarCardPolicy.v1')
  expect(calendarUpcomingPolicy.upcomingWindowDays).toBe(7)
  expect(calendarUpcomingPolicy.maximumUpcomingRows).toBe(5)
  expect(calendarUpcomingPolicy.maximumTodayRows).toBe(3)
  expect(calendarUpcomingPolicy.markerImportance).toBe('high')
  expect(calendarUpcomingPolicy.releasedWindowDays).toBe(3)
  // The card lists the top tier only: medium and low events were noise in a short watch list.
  expect([...calendarUpcomingPolicy.visibleImportance]).toEqual(['high'])
  expect(Object.isFrozen(calendarUpcomingPolicy)).toBe(true)
})
