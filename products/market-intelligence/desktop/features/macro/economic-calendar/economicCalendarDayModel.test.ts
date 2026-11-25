import { expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import type { EconomicCalendarEventView } from './economicCalendarModel'
import type { MarketCalendarEvent } from '../../../../contracts/macro/marketCalendarQueryContracts'

/** 一级指标码：格子只给一级、二级露名字，所以夹具默认带一个，判可见性才有意义。 */
const tier1Key = 'US.NONFARM.SA.CHANGE'
const official = (id: number, scheduledAt: string | undefined = '2026-09-10T01:00:00.000Z') => ({ eventKey: `official-${id}`,
  scheduledDate: '2026-09-10', scheduledAt, labelKey: 'cpi', importance: 'high' }) as unknown as EconomicCalendarEventView
const market = (id: number, scheduledAt = '2026-09-10T02:00:00.000Z') => ({ eventKey: `market-${id}`, title: 'CPI', eventNameKey: tier1Key,
  scheduledAt, importance: 'high', eventType: 'economic-indicator', countryCode: null, consensus: null, providerPrevious: null, providerActual: null,
  source: 'Narwhal', sourceObservedAt: '2026-09-10T00:00:00.000Z', coverage: 'observed-unverified' }) as MarketCalendarEvent
const typedMarket = (id: number, eventType: MarketCalendarEvent['eventType'], importance: MarketCalendarEvent['importance'], scheduledAt = `2026-09-10T${String(id).padStart(2, '0')}:00:00.000Z`) => ({
  ...market(id, scheduledAt), eventKey: `typed-${eventType}-${id}`, eventType, importance
}) as MarketCalendarEvent
async function model() {
  expect(existsSync(new URL('./economicCalendarDayModel.ts', import.meta.url))).toBe(true)
  const actual = await import('./economicCalendarDayModel')
  // These cases assert Beijing display times; pin the zone instead of inheriting the CI host.
  return {
    ...actual,
    unifiedCalendarDay: (
      date: Parameters<typeof actual.unifiedCalendarDay>[0],
      official: Parameters<typeof actual.unifiedCalendarDay>[1],
      market: Parameters<typeof actual.unifiedCalendarDay>[2],
      coverage: Parameters<typeof actual.unifiedCalendarDay>[3],
      timeZone = 'Asia/Shanghai',
      linked?: Parameters<typeof actual.unifiedCalendarDay>[5]
    ) => actual.unifiedCalendarDay(date, official, market, coverage, timeZone, linked)
  }
}
it('shares two visible positions and one remaining count across official and market observations', async () => {
  const { unifiedCalendarDay } = await model()
  const result = unifiedCalendarDay('2026-09-10', [official(1), official(2), official(3)], Array.from({ length: 5 }, (_, i) => market(i)), 'complete')
  expect(result.items).toHaveLength(8)
  // The cell names the two highest-ranked graded rows and folds everything else into the count.
  expect(result.visible.map(item => item.key)).toEqual(['market:market-0', 'market:market-1'])
  expect(result.hiddenUntiered).toBe(3)     // 旧路径的官方条目没有指标码
  expect(result.hiddenTiered).toBe(3)       // 一二级里超出上限的三条
  expect(result.remaining).toBe(6)
  expect(new Set(result.items.map(item => item.key)).size).toBe(8)
})
it.each([0, 1, 6, 7, 20])('bounds %i real rows without inventing placeholders', async count => {
  const { unifiedCalendarDay } = await model()
  const result = unifiedCalendarDay('2026-09-10', [], Array.from({ length: count }, (_, i) => market(i)), 'complete')
  expect(result.visible).toHaveLength(Math.min(count, 2))
  expect(result.remaining).toBe(Math.max(count - 2, 0))
})
it('带指标码的日子按分级收窄：只露两条名字，其余进数字（恒等式钉住）', async () => {
  const { unifiedCalendarDay } = await model()
  // 未分级或三级以外的码（PPI）与没有码的行都不露名字，但都计入数字。
  const events = [
    { ...market(1), eventNameKey: 'US.NONFARM.SA.CHANGE' },
    { ...market(2), eventNameKey: 'US.UNEMPLOYMENT.SA.RATE' },
    { ...market(3), eventNameKey: 'US.AHE.SA.MOM' },
    { ...market(4), eventNameKey: 'US.PPI.NSA.YOY' },
    { ...market(5), eventNameKey: undefined }
  ] as never
  const result = unifiedCalendarDay('2026-09-10', [], events, 'complete')
  expect(result.visible).toHaveLength(2)                       // 上限 2
  expect(result.visible.map(item => item.key)).toEqual(['market:market-1', 'market:market-2'])
  expect(result.hiddenTiered).toBe(1)                          // 时薪月率（一级）超出上限
  expect(result.hiddenUntiered).toBe(2)                        // PPI 与无码行
  expect(result.visible.length + result.hiddenTotal).toBe(5)   // 恒等式
})
it('决议类事件按显式清单露名字，讲话与库存这类事件只进数字', async () => {
  const { unifiedCalendarDay } = await model()
  const result = unifiedCalendarDay('2026-09-10', [], [
    { ...market(1, '2026-09-10T01:00:00.000Z'), eventNameKey: 'evt.fomc' },
    { ...market(2, '2026-09-10T02:00:00.000Z'), eventNameKey: 'evt.central-bank-speech' },
    { ...market(3, '2026-09-10T03:00:00.000Z'), eventNameKey: 'evt.petroleum-inventories' },
    { ...market(4, '2026-09-10T04:00:00.000Z'), eventNameKey: 'US.CPI.NSA.YOY' },
    { ...market(5, '2026-09-10T05:00:00.000Z'), eventNameKey: 'US.UNEMPLOYMENT.SA.RATE' }
  ], 'complete')
  // 决议类占一个名额（按时刻先），第二个名额给一级指标 CPI；讲话与库存进数字。
  expect(result.visible.map(item => item.key)).toEqual(['market:market-1', 'market:market-4'])
  expect(result.hiddenUntiered).toBe(2)
  expect(result.hiddenTiered).toBe(1)                          // 失业率（一级）超出上限
  expect(result.visible.length + result.hiddenTotal).toBe(result.items.length)
})
it('只有清单里的决议码能露名字：清单外的 evt.* 一律进数字', async () => {
  const { unifiedCalendarDay } = await model()
  const result = unifiedCalendarDay('2026-09-10', [], [
    { ...market(1), eventNameKey: 'evt.monetary-policy-press-conference' },
    { ...market(2), eventNameKey: 'evt.monetary-policy-statement' }
  ], 'complete')
  expect(result.visible.map(item => item.key)).toEqual(['market:market-2'])
  expect(result.hiddenUntiered).toBe(1)
})
it('a linked official row borrows the market row\'s metric code, so a graded release keeps its name', async () => {
  const { unifiedCalendarDay } = await model()
  const linked = { ...market(1), officialLink: { officialEventKey: 'official-1' } } as MarketCalendarEvent
  const other = { ...market(2), officialLink: { officialEventKey: 'official-2' } } as MarketCalendarEvent
  const linkedKeys = new Set([linked.eventKey, other.eventKey])
  const result = unifiedCalendarDay('2026-09-10', [official(1), official(2)], [linked, other], 'complete', undefined, linkedKeys)
  // Both market rows are consumed by their official rows; the official row carries the code.
  expect(result.items.map(item => item.key)).toEqual(['official:official-1', 'official:official-2'])
  expect(result.visible).toHaveLength(2)
  expect(result.hiddenTotal).toBe(0)
})
it('an unlinked official release is graded by the release mapping, and a decision event by its code', async () => {
  const { unifiedCalendarDay } = await model()
  const fomc = { ...official(2, '2026-09-10T10:00:00.000Z'), titleKey: 'fomc' }
  const cpi = { ...official(1, '2026-09-10T12:30:00.000Z'), titleKey: 'cpi' }
  const speech = { ...official(3, '2026-09-10T14:00:00.000Z'), titleKey: 'unknown' }
  const result = unifiedCalendarDay('2026-09-10', [fomc, cpi, speech], [], 'complete')
  // 议息决议按时刻先露名字；CPI 的码由官方发布映射给出（US.CPI.NSA.YOY，一级），但它排在决议之后，
  // 上限两条——所以名字是「议息 + CPI」。没有事件码的条目（讲话）只进数字。
  expect(result.visible.map(item => item.key)).toEqual(['official:official-2', 'official:official-1'])
  expect(result.hiddenUntiered).toBe(1)
  expect(result.visible.length + result.hiddenTotal).toBe(result.items.length)
})
it('只给一级、二级露名字：未分级行再多也不进格子，数字等于当天总数减显示条数', async () => {
  const { unifiedCalendarDay } = await model()
  const result = unifiedCalendarDay('2026-09-10', [official(1)], [
    { ...market(1), eventNameKey: 'US.NONFARM.SA.CHANGE' },
    { ...market(2), eventNameKey: 'US.PPI.NSA.YOY' },
    { ...market(3), eventNameKey: 'evt.WHITE_HOUSE.BRIEFING' },
    { ...market(4), eventNameKey: 'UNMAPPED.SOURCE.IDENTITY' }
  ], 'complete')
  expect(result.visible.map(item => item.key)).toEqual(['market:market-1'])
  expect(result.visible.length + result.hiddenTotal).toBe(result.items.length)
  expect(result.hiddenTotal).toBe(result.hiddenTiered + result.hiddenUntiered)
})
it('sorts date-only last and uses stable source/key tie-breaks without title merging', async () => {
  const { unifiedCalendarDay } = await model()
  const input = [official(2), official(1), { ...official(3), scheduledAt: undefined }]
  const markets = [market(2, input[0].scheduledAt), market(1, input[0].scheduledAt)]
  const first = unifiedCalendarDay('2026-09-10', input, markets, 'complete')
  expect(first.items.at(-1)?.key).toBe('official:official-3')
  expect(first.items).toHaveLength(5)
  expect(unifiedCalendarDay('2026-09-10', [...input].reverse(), [...markets].reverse(), 'complete').items).toEqual(first.items)
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
  expect(result.visible).toHaveLength(2)
  expect(result.remaining).toBeUndefined()
  expect(result.coverage).toBe(coverage)
})
it('names the two highest-ranked graded rows first, whatever their importance level', async () => {
  const { unifiedCalendarDay } = await model()
  const highs = [official(1, '2026-09-10T12:00:00.000Z'), official(2, '2026-09-10T13:00:00.000Z')]
  const other = Array.from({ length: 3 }, (_, i) => ({ ...market(i), importance: 'medium' as const, scheduledAt: `2026-09-10T0${i + 1}:00:00.000Z` }))
  const result = unifiedCalendarDay('2026-09-10', highs, other, 'complete')
  // The cell keeps the day list's rank — high first, then time — and cuts after two graded names.
  expect(result.items.map(item => item.key)).toEqual([
    'official:official-1', 'official:official-2', 'market:market-0', 'market:market-1', 'market:market-2'
  ])
  expect(result.visible.map(item => item.key)).toEqual(['market:market-0', 'market:market-1'])
  expect(result.remaining).toBe(3)
})
it.each([[0, 5, 2, 3], [2, 3, 2, 3], [8, 3, 2, 9]])('counts %i high and %i other observations', async (high, other, visible, remaining) => {
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
  expect(result.visible.map(item => item.key)).toEqual(['market:market-1', 'market:market-2'])
  expect(result.remaining).toBe(2)
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
  // Importance decides the day's rank — a high-importance financial event is never dropped for a
  // low indicator — and the cell takes that rank's first two graded names.
  expect(result.items.map(item => item.key)).toEqual([
    'market:market-1', 'market:typed-financial-event-2', 'market:typed-central-bank-activity-3',
    'market:market-4', 'market:market-5', 'market:market-6', 'market:market-7'
  ])
  expect(result.remaining).toBe(5)
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
  expect(result.items.map(item => item.key)).toEqual([
    'market:typed-financial-event-1', 'market:typed-central-bank-activity-3',
    'market:typed-financial-event-2', 'market:typed-central-bank-activity-4', 'market:typed-financial-event-5'
  ])
  expect(result.visible.map(item => item.key)).toEqual([
    'market:typed-financial-event-1', 'market:typed-central-bank-activity-3'
  ])
  expect(result.remaining).toBe(3)
  expect(result.groups.map(group => group.eventType)).toEqual(['financial-event', 'central-bank-activity'])
})
it('groups economic, financial and central events in fixed order with high items first', async () => {
  const { unifiedCalendarDay } = await model()
  const result = unifiedCalendarDay('2026-09-10', [], [
    typedMarket(1, 'central-bank-activity', 'low'), typedMarket(2, 'economic-indicator', 'medium'), typedMarket(3, 'financial-event', 'low'),
    typedMarket(4, 'economic-indicator', 'high'), typedMarket(5, 'central-bank-activity', 'high'), typedMarket(6, 'financial-event', 'high')
  ], 'complete')
  expect(result.visible.map(item => item.key)).toEqual([
    'market:typed-economic-indicator-4', 'market:typed-central-bank-activity-5'
  ])
  expect(result.remaining).toBe(4)
  expect(result.groups.map(group => group.eventType)).toEqual(['economic-indicator', 'financial-event', 'central-bank-activity'])
  expect(result.groups.map(group => group.items.map(item => item.key))).toEqual([
    ['market:typed-economic-indicator-4', 'market:typed-economic-indicator-2'],
    ['market:typed-financial-event-6', 'market:typed-financial-event-3'],
    ['market:typed-central-bank-activity-5', 'market:typed-central-bank-activity-1']
  ])
})
it('caps the date cell at two names while retaining the other-type count', async () => {
  const { unifiedCalendarDay } = await model()
  const result = unifiedCalendarDay('2026-09-10', [], [
    ...Array.from({ length: 8 }, (_, index) => typedMarket(index + 1, 'economic-indicator', 'high', `2026-09-10T0${index + 1}:00:00.000Z`)),
    typedMarket(9, 'financial-event', 'high', '2026-09-10T09:00:00.000Z'), typedMarket(10, 'central-bank-activity', 'high', '2026-09-10T10:00:00.000Z')
  ], 'complete')
  expect(result.visible).toHaveLength(2)
  expect(result.hiddenTiered).toBe(8)
  expect(result.remaining).toBe(8)
})
it('puts pending times last in the economic group and retains stable source/key ties', async () => {
  const { unifiedCalendarDay } = await model()
  const events = [market(2), market(1), { ...market(3), importance: 'low' as const }]
  const officials = [{ ...official(3), scheduledAt: undefined }, official(1, events[0].scheduledAt)]
  const result = unifiedCalendarDay('2026-09-10', officials, events, 'complete')
  expect(result.groups?.[0]?.items.map(item => item.key)).toEqual([
    'official:official-1', 'market:market-1', 'market:market-2', 'market:market-3', 'official:official-3'
  ])
  expect(unifiedCalendarDay('2026-09-10', [...officials].reverse(), [...events].reverse(), 'complete').groups).toEqual(result.groups)
})
it.each(['economic-indicator', 'financial-event', 'central-bank-activity'] as const)('sorts %s by high importance, Beijing time and stable keys', async eventType => {
  const { unifiedCalendarDay } = await model()
  const events = [typedMarket(1, eventType, 'low'), typedMarket(2, eventType, 'high', '2026-09-10T04:00:00.000Z'),
    typedMarket(3, eventType, 'high', '2026-09-10T03:00:00.000Z'), typedMarket(4, eventType, 'high', '2026-09-10T03:00:00.000Z')]
  const first = unifiedCalendarDay('2026-09-10', [], events, 'complete')
  expect(first.groups[0].items.map(item => item.event.eventKey)).toEqual([events[2].eventKey, events[3].eventKey, events[1].eventKey, events[0].eventKey])
  expect(first.groups[0].items.map(item => item.time)).toEqual(['11:00', '11:00', '12:00', '09:00'])
  expect(unifiedCalendarDay('2026-09-10', [], [...events].reverse(), 'complete').groups).toEqual(first.groups)
})
it('stands a month on the reader\'s own day when it belongs to that month, and on its first day otherwise', async () => {
  const { calendarDayForMonth } = await model()
  expect(calendarDayForMonth('2026-09', '2026-09-10')).toBe('2026-09-10')
  expect(calendarDayForMonth('2026-09', '2026-09-01')).toBe('2026-09-01')
  // A day that only reads like the target month is not borrowed: the month leads.
  expect(calendarDayForMonth('2026-10', '2026-09-10')).toBe('2026-10-01')
  expect(calendarDayForMonth('2026-09', '2026-08-31')).toBe('2026-09-01')
})

/**
 * linked 对取档（R44 技术方案 §4.1 末条）：官方条目配上一条市场行时，两处读的是同一个优先级——
 * 标准行有码、判据更硬，它的档先；标准行未分级才回退官方；都没有 → 未分级。
 * 各读各的就会出现「同一次发布在日历上是高、在简报上是未分级」。
 */
it('官方条目配上市场行时，档取 standard 优先的那一个；都未分级就是未分级', async () => {
  const { unifiedCalendarDay, calendarItemImportance } = await model()
  const officialUngraded = { ...official(1), importance: undefined } as EconomicCalendarEventView
  const link = { officialEventKey: 'official-1', officialPeriodKey: '2026-09', officialScheduledDate: '2026-09-10',
    officialScheduledAt: '2026-09-10T01:00:00.000Z', officialDetectedAt: '2026-09-01T00:00:00.000Z',
    timeDisplaySource: 'official-scheduled' as const, displayScheduledAt: '2026-09-10T01:00:00.000Z' }
  const linkedHigh = { ...market(9), eventKey: 'market-9', importance: 'high' as const, officialLink: link } as MarketCalendarEvent
  const paired = unifiedCalendarDay('2026-09-10', [officialUngraded], [linkedHigh], 'complete',
    'Asia/Shanghai', new Set(['market-9']))
  expect(paired.items).toHaveLength(1)
  expect(calendarItemImportance(paired.items[0]!)).toBe('high')

  // 两边都没判 → 未分级：不兜低、不兜高。
  const linkedUngraded = { ...linkedHigh, importance: undefined } as MarketCalendarEvent
  const neither = unifiedCalendarDay('2026-09-10', [officialUngraded], [linkedUngraded], 'complete',
    'Asia/Shanghai', new Set(['market-9']))
  expect(calendarItemImportance(neither.items[0]!)).toBeUndefined()
})
