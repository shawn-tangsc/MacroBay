import { expect, it, vi } from 'vitest'
import { readMarketCalendarMonth } from './readMarketCalendarMonth'

const event = (key: string) => ({ eventKey: key }) as never
const source = { eventType: 'economic-indicator', status: 'success', sourceObservedAt: '2026-10-11T09:00:00.000Z' } as never
const query = { month: '2026-10', locale: 'zh' as const, asOf: '2026-10-11T09:00:00.000Z' }

it('follows the cursor, because the later days of the month are on the next page', () => {
  // The bug this guards: reading only page one left the card with the official rows alone.
  const queryMonth = vi.fn(async input => input.cursor === undefined
    ? { state: 'available' as const, month: '2026-10', locale: 'zh' as const, asOf: query.asOf, events: [event('p1')], sources: [], nextCursor: 'c1' }
    : { state: 'available' as const, month: '2026-10', locale: 'zh' as const, asOf: query.asOf, events: [event('p2')], sources: [source] })
  return expect(readMarketCalendarMonth({ queryMonth }, query)).resolves.toEqual({ events: [event('p1'), event('p2')], sources: [source] })
})

it('passes the cursor on, and stops at the first query without one', async () => {
  const queryMonth = vi.fn(async () => ({ state: 'available' as const, month: '2026-10', locale: 'zh' as const, asOf: query.asOf, events: [], sources: [source] }))
  await readMarketCalendarMonth({ queryMonth }, query)
  expect(queryMonth).toHaveBeenCalledTimes(1)
  expect(queryMonth).toHaveBeenCalledWith(query)
})

it('reports the route as unreadable rather than as an empty month', async () => {
  const queryMonth = vi.fn(async () => ({ state: 'unavailable' as const, failureCode: 'query-unavailable' as const }))
  await expect(readMarketCalendarMonth({ queryMonth }, query)).resolves.toBeNull()
})
