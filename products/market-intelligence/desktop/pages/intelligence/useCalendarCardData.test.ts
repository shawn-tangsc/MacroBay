import { expect, it } from 'vitest'
import { calendarCardMonths } from './useCalendarCardData'

it('reads the month of the window and the one it can cross into', () => {
  expect(calendarCardMonths('2026-10-11T09:00:00.000Z')).toEqual(['2026-10', '2026-11'])
})

it('rolls the year over in december', () => {
  expect(calendarCardMonths('2026-12-30T00:00:00.000Z')).toEqual(['2026-12', '2027-01'])
})
