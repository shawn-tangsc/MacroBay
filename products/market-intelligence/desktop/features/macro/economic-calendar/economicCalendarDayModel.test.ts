import { expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import type { EconomicCalendarEventView } from './economicCalendarModel'
import type { MarketCalendarEvent } from '../../../../contracts/macro/marketCalendarQueryContracts'

const official = (id: number, scheduledAt: string | undefined = '2026-09-10T01:00:00.000Z') => ({ eventKey: `official-${id}`,
  scheduledDate: '2026-09-10', scheduledAt, labelKey: 'cpi', importance: 'high' }) as unknown as EconomicCalendarEventView
const market = (id: number, scheduledAt = '2026-09-10T02:00:00.000Z') => ({ eventKey: `market-${id}`, title: 'CPI',
  scheduledAt, importance: 'high', eventType: 'economic-indicator', countryCode: null, consensus: null, providerPrevious: null, providerActual: null,
  source: '0xRouter', sourceObservedAt: '2026-09-10T00:00:00.000Z', coverage: 'observed-unverified' }) as MarketCalendarEvent
const typedMarket = (id: number, eventType: MarketCalendarEvent['eventType'], importance: MarketCalendarEvent['importance'], scheduledAt = `2026-09-10T${String(id).padStart(2, '0')}:00:00.000Z`) => ({
  ...market(id, scheduledAt), eventKey: `typed-${eventType}-${id}`, eventType, importance
}) as MarketCalendarEvent
async function model() {
  expect(existsSync(new URL('./economicCalendarDayModel.ts', import.meta.url))).toBe(true)
  return import('./economicCalendarDayModel')
}
it('shares six visible positions and one remaining count across official and market observations', async () => {
  const { unifiedCalendarDay } = await model()
  const result = unifiedCalendarDay('2026-09-10', [official(1), official(2), official(3)], Array.from({ length: 5 }, (_, i) => market(i)), 'complete')
  expect(result.items).toHaveLength(8)
  expect(result.visible).toHaveLength(6)
  expect(result.remaining).toBe(2)
  expect(new Set(result.items.map(item => item.key)).size).toBe(8)
})
it.each([0, 1, 6, 7, 20])('bounds %i real rows without inventing placeholders', async count => {
  const { unifiedCalendarDay } = await model()
  const result = unifiedCalendarDay('2026-09-10', [], Array.from({ length: count }, (_, i) => market(i)), 'complete')
  expect(result.visible).toHaveLength(Math.min(count, 6))
  expect(result.remaining).toBe(Math.max(count - 6, 0))
})
it('sorts date-only last and uses stable source/key tie-breaks without title merging', async () => {
  const { unifiedCalendarDay } = await model()
  const input = [official(2), official(1), { ...official(3), scheduledAt: undefined }]
  const markets = [market(2, input[0].scheduledAt), market(1, input[0].scheduledAt)]
  const first = unifiedCalendarDay('2026-09-10', input, markets, 'complete')
  expect(first.items.at(-1)?.key).toBe('official:official-3')
  expect(first.items).toHaveLength(5)
  expect(unifiedCalendarDay('2026-09-10', input.toReversed(), markets.toReversed(), 'complete').items).toEqual(first.items)
})
it('groups UTC cross-day and cross-month timestamps in Beijing while retaining date-only dates', async () => {
  const { unifiedCalendarDay } = await model()
  const timed = official(1, '2026-09-30T16:30:00.000Z')
  expect(unifiedCalendarDay('2026-10-01', [timed], [market(1, timed.scheduledAt)], 'complete').items.map(item => item.time)).toEqual(['00:30', '00:30'])
  expect(unifiedCalendarDay('2026-09-30', [timed], [], 'complete').items).toHaveLength(0)
  expect(unifiedCalendarDay('2026-09-10', [{ ...timed, scheduledAt: undefined }], [], 'complete').items[0]?.time).toBeUndefined()
})
it.each(['loading', 'incomplete'] as const)('does not report an exact remaining count while %s', async coverage => {
  const { unifiedCalendarDay } = await model()
  const result = unifiedCalendarDay('2026-09-10', [], Array.from({ length: 20 }, (_, i) => market(i)), coverage)
  expect(result.visible).toHaveLength(6)
  expect(result.remaining).toBeUndefined()
  expect(result.coverage).toBe(coverage)
})
it('fills the month cell with the other importance levels once the high ones run out', async () => {
  const { unifiedCalendarDay } = await model()
  const highs = [official(1, '2026-09-10T12:00:00.000Z'), official(2, '2026-09-10T13:00:00.000Z')]
  const other = Array.from({ length: 3 }, (_, i) => ({ ...market(i), importance: 'medium' as const, scheduledAt: `2026-09-10T0${i + 1}:00:00.000Z` }))
  const result = unifiedCalendarDay('2026-09-10', highs, other, 'complete')
  // The cell reads as the day's own six rows: the high observations first, then the rest by time.
  expect(result.visible.map(item => item.key)).toEqual([
    'official:official-1', 'official:official-2', 'market:market-0', 'market:market-1', 'market:market-2'
  ])
  expect(result.remaining).toBe(0)
})
it.each([[0, 5, 5, 0], [2, 3, 5, 0], [8, 3, 6, 5]])('counts %i high and %i other observations', async (high, other, visible, remaining) => {
  const { unifiedCalendarDay } = await model()
  const events = [...Array.from({ length: high }, (_, i) => market(i)),
    ...Array.from({ length: other }, (_, i) => ({ ...market(high + i), importance: 'low' as const }))]
  const result = unifiedCalendarDay('2026-09-10', [], events, 'complete')
  expect(result.visible).toHaveLength(visible)
  expect(result.remaining).toBe(remaining)
  expect(result.items).toHaveLength(high + other)
})
it('orders the complete day list by importance group then time, with pending last within each group', async () => {
  const { unifiedCalendarDay } = await model()
  const highPending = { ...official(2), scheduledAt: undefined }
  const highLate = official(1, '2026-09-10T12:00:00.000Z')
  const mediumEarly = { ...market(1, '2026-09-10T01:00:00.000Z'), importance: 'medium' as const }
  const mediumLate = { ...market(2, '2026-09-10T02:00:00.000Z'), importance: 'low' as const }
  const result = unifiedCalendarDay('2026-09-10', [highPending, highLate], [mediumLate, mediumEarly], 'complete')
  expect(result.items.map(item => item.key)).toEqual(['official:official-1', 'official:official-2', 'market:market-1', 'market:market-2'])
  expect(result.visible).toHaveLength(4)
  expect(result.remaining).toBe(0)
})
it('ranks a high-importance central or financial event above a lower-importance indicator', async () => {
  const { unifiedCalendarDay } = await model()
  const events = [
    { ...market(1, '2026-09-10T01:00:00.000Z'), importance: 'high' as const },
    typedMarket(2, 'financial-event', 'high', '2026-09-10T02:00:00.000Z'),
    typedMarket(3, 'central-bank-activity', 'high', '2026-09-10T03:00:00.000Z'),
    ...Array.from({ length: 4 }, (_, i) => ({ ...market(i + 4, `2026-09-10T0${i + 4}:00:00.000Z`), importance: 'low' as const }))
  ]
  const result = unifiedCalendarDay('2026-09-10', [], events, 'complete')
  // Importance decides who is in the cell whatever the kind, and inside one importance level the
  // release time decides — a high-importance financial event is never dropped for a low indicator.
  expect(result.visible.map(item => item.key)).toEqual([
    'market:market-1', 'market:typed-financial-event-2', 'market:typed-central-bank-activity-3',
    'market:market-4', 'market:market-5', 'market:market-6'
  ])
  expect(result.remaining).toBe(1)
})
it('orders the cell by release time inside an importance level, whatever the kind', async () => {
  const { unifiedCalendarDay } = await model()
  const result = unifiedCalendarDay('2026-09-10', [], [
    typedMarket(1, 'financial-event', 'high', '2026-09-10T01:00:00.000Z'),
    typedMarket(2, 'financial-event', 'low', '2026-09-10T02:00:00.000Z'),
    typedMarket(3, 'central-bank-activity', 'high', '2026-09-10T03:00:00.000Z'),
    typedMarket(4, 'central-bank-activity', 'medium', '2026-09-10T04:00:00.000Z'),
    typedMarket(5, 'financial-event', 'medium', '2026-09-10T05:00:00.000Z')
  ], 'complete')
  // The cell has no kind order of its own: the kind is the row's glyph, not its rank.
  expect(result.visible.map(item => item.key)).toEqual([
    'market:typed-financial-event-1', 'market:typed-central-bank-activity-3',
    'market:typed-financial-event-2', 'market:typed-central-bank-activity-4', 'market:typed-financial-event-5'
  ])
  expect(result.remaining).toBe(0)
  expect(result.groups.map(group => group.eventType)).toEqual(['financial-event', 'central-bank-activity'])
})
it('groups economic, financial and central events in fixed order with high items first', async () => {
  const { unifiedCalendarDay } = await model()
  const result = unifiedCalendarDay('2026-09-10', [], [
    typedMarket(1, 'central-bank-activity', 'low'), typedMarket(2, 'economic-indicator', 'medium'), typedMarket(3, 'financial-event', 'low'),
    typedMarket(4, 'economic-indicator', 'high'), typedMarket(5, 'central-bank-activity', 'high'), typedMarket(6, 'financial-event', 'high')
  ], 'complete')
  expect(result.visible.map(item => item.key)).toEqual([
    'market:typed-economic-indicator-4', 'market:typed-central-bank-activity-5', 'market:typed-financial-event-6',
    'market:typed-central-bank-activity-1', 'market:typed-economic-indicator-2', 'market:typed-financial-event-3'
  ])
  expect(result.remaining).toBe(0)
  expect(result.groups.map(group => group.eventType)).toEqual(['economic-indicator', 'financial-event', 'central-bank-activity'])
  expect(result.groups.map(group => group.items.map(item => item.key))).toEqual([
    ['market:typed-economic-indicator-4', 'market:typed-economic-indicator-2'],
    ['market:typed-financial-event-6', 'market:typed-financial-event-3'],
    ['market:typed-central-bank-activity-5', 'market:typed-central-bank-activity-1']
  ])
})
it('caps the date cell at six economic indicators while retaining other-type count', async () => {
  const { unifiedCalendarDay } = await model()
  const result = unifiedCalendarDay('2026-09-10', [], [
    ...Array.from({ length: 8 }, (_, index) => typedMarket(index + 1, 'economic-indicator', 'high', `2026-09-10T0${index + 1}:00:00.000Z`)),
    typedMarket(9, 'financial-event', 'high', '2026-09-10T09:00:00.000Z'), typedMarket(10, 'central-bank-activity', 'high', '2026-09-10T10:00:00.000Z')
  ], 'complete')
  expect(result.visible).toHaveLength(6)
  expect(result.remaining).toBe(4)
})
it('puts pending times last in the economic group and retains stable source/key ties', async () => {
  const { unifiedCalendarDay } = await model()
  const events = [market(2), market(1), { ...market(3), importance: 'low' as const }]
  const officials = [{ ...official(3), scheduledAt: undefined }, official(1, events[0].scheduledAt)]
  const result = unifiedCalendarDay('2026-09-10', officials, events, 'complete')
  expect(result.groups?.[0]?.items.map(item => item.key)).toEqual([
    'official:official-1', 'market:market-1', 'market:market-2', 'market:market-3', 'official:official-3'
  ])
  expect(unifiedCalendarDay('2026-09-10', officials.toReversed(), events.toReversed(), 'complete').groups).toEqual(result.groups)
})
it.each(['economic-indicator', 'financial-event', 'central-bank-activity'] as const)('sorts %s by high importance, Beijing time and stable keys', async eventType => {
  const { unifiedCalendarDay } = await model()
  const events = [typedMarket(1, eventType, 'low'), typedMarket(2, eventType, 'high', '2026-09-10T04:00:00.000Z'),
    typedMarket(3, eventType, 'high', '2026-09-10T03:00:00.000Z'), typedMarket(4, eventType, 'high', '2026-09-10T03:00:00.000Z')]
  const first = unifiedCalendarDay('2026-09-10', [], events, 'complete')
  expect(first.groups[0].items.map(item => item.event.eventKey)).toEqual([events[2].eventKey, events[3].eventKey, events[1].eventKey, events[0].eventKey])
  expect(first.groups[0].items.map(item => item.time)).toEqual(['11:00', '11:00', '12:00', '09:00'])
  expect(unifiedCalendarDay('2026-09-10', [], events.toReversed(), 'complete').groups).toEqual(first.groups)
})
it('stands a month on the reader\'s own day when it belongs to that month, and on its first day otherwise', async () => {
  const { calendarDayForMonth } = await model()
  expect(calendarDayForMonth('2026-09', '2026-09-10')).toBe('2026-09-10')
  expect(calendarDayForMonth('2026-09', '2026-09-01')).toBe('2026-09-01')
  // A day that only reads like the target month is not borrowed: the month leads.
  expect(calendarDayForMonth('2026-10', '2026-09-10')).toBe('2026-10-01')
  expect(calendarDayForMonth('2026-09', '2026-08-31')).toBe('2026-09-01')
})
