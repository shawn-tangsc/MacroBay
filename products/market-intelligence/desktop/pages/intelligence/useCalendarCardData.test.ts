import { expect, it } from 'vitest'
import { calendarCardMonths } from './useCalendarCardData'

// The card's window reaches back three days, so on the first days of a month it reaches into the
// previous one. Reading only the current month made a release from 10-31 unreachable on 11-02.
it('reaches back into the previous month while the released window still covers it', () => {
  expect(calendarCardMonths('2026-11-02T09:00:00.000Z')).toEqual(['2026-10', '2026-11'])
})

it('stays inside one month when the window does not cross a boundary', () => {
  expect(calendarCardMonths('2026-10-15T09:00:00.000Z')).toEqual(['2026-10'])
})

it('crosses a February boundary without widening beyond the window', () => {
  expect(calendarCardMonths('2026-03-01T09:00:00.000Z')).toEqual(['2026-02', '2026-03'])
})

it('rolls the year over in december', () => {
  expect(calendarCardMonths('2026-12-30T00:00:00.000Z')).toEqual(['2026-12', '2027-01'])
})
