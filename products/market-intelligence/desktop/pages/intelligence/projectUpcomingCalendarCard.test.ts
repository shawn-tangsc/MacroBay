import { expect, it } from 'vitest'
import { calendarUpcomingPolicy } from './calendarUpcomingPolicy'
import { projectUpcomingCalendarCard, type CalendarCardEvent } from './projectUpcomingCalendarCard'

const asOf = '2026-10-11T09:00:00.000Z'

function event(overrides: Partial<CalendarCardEvent> = {}): CalendarCardEvent {
  return {
    eventKey: 'US.CPI.RELEASE.2026-M10', titleKey: 'cpi', importance: 'high', lifecycleState: 'scheduled', category: 'economic-indicator',
    scheduledDate: '2026-10-13', scheduledAt: '2026-10-13T12:30:00.000Z', detectedAt: '2026-10-11T06:00:00.000Z', ...overrides
  }
}

it('keeps the seventh day inside the window and drops the eighth', () => {
  const inside = event({ eventKey: 'inside', scheduledDate: '2026-10-18', scheduledAt: '2026-10-18T12:00:00.000Z' })
  const outside = event({ eventKey: 'outside', scheduledDate: '2026-10-19', scheduledAt: '2026-10-19T12:00:00.000Z' })
  const result = projectUpcomingCalendarCard([outside, inside], asOf)
  expect(result.upcoming.map(row => row.eventKey)).toEqual(['inside'])
})

it('keeps an event whose time has passed while its value is still missing, for two hours', () => {
  // The reader is waiting for this print; it must not vanish at its scheduled instant.
  const justOverdue = event({ eventKey: 'overdue', scheduledDate: '2026-10-11', scheduledAt: '2026-10-11T07:30:00.000Z' })
  const tooOld = event({ eventKey: 'stale', scheduledDate: '2026-10-11', scheduledAt: '2026-10-11T05:00:00.000Z' })
  const result = projectUpcomingCalendarCard([justOverdue, tooOld], asOf)
  expect(result.upcoming.map(row => row.eventKey)).toEqual(['overdue'])
})

it('moves a late event out of upcoming as soon as it publishes', () => {
  // Overdue but published: it is released news now, not something to wait for, and it must not
  // appear in both sections.
  const published = event({ eventKey: 'late-print', scheduledDate: '2026-10-11', scheduledAt: '2026-10-11T07:30:00.000Z',
    lifecycleState: 'released', actual: { displayValue: '1.2%' }, previous: { displayValue: '1.0%' } })
  const result = projectUpcomingCalendarCard([published], asOf)
  expect(result.upcoming).toEqual([])
  expect(result.today.map(row => row.eventKey)).toEqual(['late-print'])
})

it('uses the date when an event has no time, and never lets a past date in', () => {
  const dateOnly = event({ eventKey: 'date-only', scheduledAt: undefined, scheduledDate: '2026-10-18' })
  const past = event({ eventKey: 'past', scheduledAt: undefined, scheduledDate: '2026-10-10' })
  const result = projectUpcomingCalendarCard([dateOnly, past], asOf)
  expect(result.upcoming.map(row => row.eventKey)).toEqual(['date-only'])
})

it('sorts by instant and then by key, so the order is stable', () => {
  const later = event({ eventKey: 'z-later', scheduledAt: '2026-10-15T00:00:00.000Z', scheduledDate: '2026-10-15' })
  const sameDayB = event({ eventKey: 'b', scheduledAt: '2026-10-13T12:30:00.000Z', scheduledDate: '2026-10-13' })
  const sameDayA = event({ eventKey: 'a', scheduledAt: '2026-10-13T12:30:00.000Z', scheduledDate: '2026-10-13' })
  const result = projectUpcomingCalendarCard([later, sameDayB, sameDayA], asOf)
  expect(result.upcoming.map(row => row.eventKey)).toEqual(['a', 'b', 'z-later'])
})

it('lists high importance only, never a lower tier, released or cancelled event', () => {
  // The card is the short list of what is worth watching: medium and low events are noise in it.
  // Distinct instants, because the section is ordered by time: 12th, 13th, 14th.
  const high = event({ eventKey: 'high', importance: 'high', scheduledDate: '2026-10-12', scheduledAt: '2026-10-12T00:00:00.000Z' })
  const medium = event({ eventKey: 'medium', importance: 'medium', scheduledDate: '2026-10-13', scheduledAt: '2026-10-13T00:00:00.000Z' })
  const low = event({ eventKey: 'low', importance: 'low', scheduledDate: '2026-10-14', scheduledAt: '2026-10-14T00:00:00.000Z' })
  const released = event({ eventKey: 'released', lifecycleState: 'released' })
  const cancelled = event({ eventKey: 'cancelled', lifecycleState: 'cancelled' })
  expect(projectUpcomingCalendarCard([high, medium, low, released, cancelled], asOf).upcoming.map(row => row.eventKey))
    .toEqual(['high'])
})

it('lists recently released values that actually moved', () => {
  const moved = event({ eventKey: 'moved', lifecycleState: 'released', scheduledDate: '2026-10-11',
    scheduledAt: '2026-10-11T06:00:00.000Z', actual: { displayValue: '3.2%' }, previous: { displayValue: '3.1%' } })
  const flat = event({ eventKey: 'flat', lifecycleState: 'released', scheduledDate: '2026-10-11',
    scheduledAt: '2026-10-11T06:00:00.000Z', actual: { displayValue: '3.1%' }, previous: { displayValue: '3.1%' } })
  const yesterday = event({ eventKey: 'yesterday', lifecycleState: 'released', scheduledDate: '2026-10-10',
    scheduledAt: '2026-10-10T06:00:00.000Z', actual: { displayValue: '9.9%' }, previous: { displayValue: '1%' } })
  const result = projectUpcomingCalendarCard([moved, flat, yesterday], asOf)
  // Newest first, and a release from the day before is still within the recent window.
  expect(result.today.map(row => row.eventKey)).toEqual(['moved', 'yesterday'])
  expect(result.today[0]).toMatchObject({ kind: 'released-changed', importance: 'high' })
})

it('reports a consensus surprise as a move too', () => {
  const surprised = event({ eventKey: 'surprised', lifecycleState: 'released', scheduledDate: '2026-10-11',
    scheduledAt: '2026-10-11T06:00:00.000Z', actual: { displayValue: '0.3%' }, consensus: { displayValue: '0.1%' } })
  expect(projectUpcomingCalendarCard([surprised], asOf).today.map(row => row.eventKey)).toEqual(['surprised'])
})

it('keeps a release whose value did not change but whose surprise crossed the trigger', () => {
  const surprised = event({ eventKey: 'surprised', lifecycleState: 'released', scheduledDate: '2026-10-11',
    scheduledAt: '2026-10-11T06:00:00.000Z', actual: { displayValue: '3.4%' },
    previous: { displayValue: '3.4%' }, consensus: { displayValue: '3.1%' } })
  const routine = event({ eventKey: 'routine', lifecycleState: 'released', scheduledDate: '2026-10-11',
    scheduledAt: '2026-10-11T05:00:00.000Z', actual: { displayValue: '3.2%' },
    previous: { displayValue: '3.2%' }, consensus: { displayValue: '3.2%' } })

  const rows = projectUpcomingCalendarCard([surprised, routine], asOf)
  expect(rows.today.map(row => row.eventKey)).toEqual(['surprised'])
  expect(rows.today[0]?.surprise).toMatchObject({ direction: 'beat', unit: 'pp', reason: null })
  expect(rows.today[0]?.surprise.value).toBeCloseTo(0.3, 10)
})

it('carries the contract verdict on every row, including missing and incomparable expectations', () => {
  const missing = event({ eventKey: 'missing', lifecycleState: 'released', scheduledDate: '2026-10-11',
    scheduledAt: '2026-10-11T06:00:00.000Z', actual: { displayValue: '3.4%' }, previous: { displayValue: '3.1%' } })
  const incomparable = event({ eventKey: 'incomparable', lifecycleState: 'released', scheduledDate: '2026-10-11',
    scheduledAt: '2026-10-11T05:00:00.000Z', actual: { displayValue: '250K' },
    previous: { displayValue: '240K' }, consensus: { displayValue: '240K' } })
  const bare = event({ eventKey: 'bare', lifecycleState: 'released', scheduledDate: '2026-10-11',
    scheduledAt: '2026-10-11T04:00:00.000Z', actual: { displayValue: '165' },
    previous: { displayValue: '165' }, consensus: { displayValue: '150' } })

  const rows = projectUpcomingCalendarCard([missing, incomparable, bare], asOf)
  expect(rows.today.find(row => row.eventKey === 'missing')?.surprise)
    .toEqual({ direction: 'consensus-unavailable', value: null, unit: null, reason: 'missing-consensus' })
  expect(rows.today.find(row => row.eventKey === 'incomparable')?.surprise)
    .toEqual({ direction: 'consensus-unavailable', value: null, unit: null, reason: 'non-numeric' })
  const bareSurprise = rows.today.find(row => row.eventKey === 'bare')!.surprise
  expect(bareSurprise).toMatchObject({ direction: 'beat', unit: 'relative-percent', reason: null })
  expect(bareSurprise.value).toBeCloseTo(10, 10)
})

it('never exceeds the policy row limits, and keeps the earliest rows', () => {
  const events = Array.from({ length: 9 }, (_, index) => event({
    eventKey: `e-${index}`, scheduledDate: `2026-10-1${index + 1}`, scheduledAt: `2026-10-1${index + 1}T00:00:00.000Z`
  }))
  const result = projectUpcomingCalendarCard(events, asOf)
  // The seven-day window bounds the candidates before the row cap does; the cap is an upper
  // bound, not a promise to fill.
  expect(result.upcoming.length).toBeLessThanOrEqual(calendarUpcomingPolicy.maximumUpcomingRows)
  expect(result.upcoming[0]!.eventKey).toBe('e-1')
})

it('never cuts a busy hour in half, even past the row target', () => {
  const busy = Array.from({ length: 7 }, (_, index) => event({
    eventKey: `busy-${index}`, scheduledDate: '2026-10-12', scheduledAt: '2026-10-12T12:30:00.000Z'
  }))
  const later = event({ eventKey: 'later', scheduledDate: '2026-10-12', scheduledAt: '2026-10-12T15:00:00.000Z' })
  const result = projectUpcomingCalendarCard([...busy, later], asOf)
  expect(result.upcoming).toHaveLength(7)
  expect(result.upcoming.map(row => row.eventKey)).not.toContain('later')
})

it('tops a quiet nearest hour up with the next-nearest hours, whole groups at a time', () => {
  const at = (hour: string, keys: readonly string[]) => keys.map(key => event({
    eventKey: key, scheduledDate: '2026-10-12', scheduledAt: `2026-10-12T${hour}:00:00.000Z`
  }))
  const result = projectUpcomingCalendarCard([...at('10', ['a1', 'a2']), ...at('11', ['b1', 'b2']), ...at('12', ['c1', 'c2', 'c3']), ...at('13', ['never'])], asOf)
  // Two rows an hour: the third group crosses the target of five, so it comes whole.
  expect(result.upcoming.map(row => row.eventKey)).toEqual(['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'c3'])
})

it('stops at the target when the nearest hour already fills it', () => {
  const at = (hour: string, keys: readonly string[]) => keys.map(key => event({
    eventKey: key, scheduledDate: '2026-10-12', scheduledAt: `2026-10-12T${hour}:00:00.000Z`
  }))
  const result = projectUpcomingCalendarCard([...at('10', ['a1', 'a2', 'a3', 'a4', 'a5']), ...at('11', ['later'])], asOf)
  expect(result.upcoming.map(row => row.eventKey)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5'])
})

it('stays empty and quiet for no events at all', () => {
  expect(projectUpcomingCalendarCard([], asOf)).toEqual({ today: [], upcoming: [], state: 'empty' })
  expect(projectUpcomingCalendarCard([event({ importance: 'low' })], asOf).state).toBe('empty')
})

it('marks the row that is past its time without a value, and only that row', () => {
  // 读者 2026-10-16：发布了却什么都不发生，要能看出是**哪一个**在等。分类在投影里做，标记落在该行上。
  const waiting = event({ eventKey: 'waiting', scheduledDate: '2026-10-11', scheduledAt: '2026-10-11T07:30:00.000Z' })
  const ahead = event({ eventKey: 'ahead', scheduledDate: '2026-10-11', scheduledAt: '2026-10-11T12:00:00.000Z' })
  const published = event({ eventKey: 'published', scheduledDate: '2026-10-11', scheduledAt: '2026-10-11T07:30:00.000Z',
    lifecycleState: 'released', actual: { displayValue: '6.3%' }, previous: { displayValue: '5.4%' } })
  const rows = projectUpcomingCalendarCard([waiting, ahead, published], asOf)
  const all = [...rows.today, ...rows.upcoming]
  expect(all.find(row => row.eventKey === 'waiting')?.awaitingData).toBe(true)
  expect(all.find(row => row.eventKey === 'ahead')?.awaitingData).toBe(false)
  expect(all.find(row => row.eventKey === 'published')?.awaitingData).toBe(false)
})
