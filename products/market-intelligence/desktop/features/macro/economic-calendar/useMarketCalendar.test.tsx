// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { MarketCalendarFreshness, MarketCalendarPage, MarketCalendarRefreshNowResult } from '../../../../contracts/macro/marketCalendarQueryContracts'
import type { MarketCalendarClient } from '../../../shared/ipc/marketCalendarClient'

const host = document.createElement('div')
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => { await act(async () => root?.unmount()); root = undefined })
const now = () => new Date('2026-09-10T00:00:00.000Z')
/**
 * The hook's port is `MarketCalendarClient` — four methods. These cases drive reading and the manual
 * refresh, so the freshness and catch-up ports are declared here once instead of being left out of the
 * fake: `unavailable` and `unchanged` are the port's own answers for "cannot tell" and "nothing to do",
 * so a case that starts depending on them would have to say so instead of reading `undefined`.
 */
function calendarClient<Parts extends Pick<MarketCalendarClient, 'queryMonth' | 'refresh'>>(
  parts: Parts
): Parts & MarketCalendarClient {
  return {
    ...parts,
    getCollectionFreshness: vi.fn(async (): Promise<MarketCalendarFreshness> => ({ state: 'unavailable', failureCode: 'query-unavailable' })),
    refreshNow: vi.fn(async (): Promise<MarketCalendarRefreshNowResult> => ({ state: 'unchanged' }))
  }
}
it('reads locally, refreshes only on demand and ignores completed requests from a superseded scope', async () => {
  const { useMarketCalendar } = await import('./useMarketCalendar')
  const empty = (month: string): MarketCalendarPage => ({ state: 'available', month, locale: 'zh', asOf: now().toISOString(), events: [], sources: [] })
  let resolve!: (page: MarketCalendarPage) => void
  const client = calendarClient({ queryMonth: vi.fn().mockImplementationOnce(() => new Promise(done => { resolve = done })).mockResolvedValue(empty('2026-10')),
    refresh: vi.fn().mockResolvedValue({ state: 'completed', sources: [] }) })
  let state!: ReturnType<typeof useMarketCalendar>
  function Harness({ month }: { month: string }) { state = useMarketCalendar({ months: [month], locale: 'zh', now, client }); return null }
  root = createRoot(host)
  await act(async () => root!.render(<Harness month="2026-09" />))
  expect(client.queryMonth).toHaveBeenCalledOnce()
  expect(client.refresh).not.toHaveBeenCalled()
  await act(async () => root!.render(<Harness month="2026-10" />))
  await act(async () => resolve(empty('2026-09')))
  expect(state.month).toBe('2026-10')
  await act(async () => state.refresh())
  expect(client.refresh).toHaveBeenCalledWith({ month: '2026-10', locale: 'zh' })
  expect(client.queryMonth).toHaveBeenCalledTimes(3)
})

it('does not read again when an in-flight refresh completes after unmount', async () => {
  const { useMarketCalendar } = await import('./useMarketCalendar')
  let complete!: (value: { state: 'unavailable'; sources: [] }) => void
  const client = calendarClient({ queryMonth: vi.fn().mockResolvedValue({ state: 'unavailable', failureCode: 'query-unavailable' }),
    refresh: vi.fn().mockImplementation(() => new Promise(resolve => { complete = resolve })) })
  let state!: ReturnType<typeof useMarketCalendar>
  function Harness() { state = useMarketCalendar({ months: ['2026-09'], locale: 'zh', now, client }); return null }
  root = createRoot(host)
  await act(async () => root!.render(<Harness />))
  let refreshing!: Promise<void>
  await act(async () => { refreshing = state.refresh() })
  await act(async () => root!.unmount()); root = undefined
  complete({ state: 'unavailable', sources: [] })
  await refreshing
  expect(client.queryMonth).toHaveBeenCalledOnce()
})

it('bounds empty continuation pages even when every cursor is different', async () => {
  const { useMarketCalendar } = await import('./useMarketCalendar')
  let calls = 0
  const client = calendarClient({ queryMonth: vi.fn(async () => ({ state: 'available' as const, month: '2026-09', locale: 'zh' as const,
    asOf: now().toISOString(), events: [], sources: [], ...(++calls <= 3010 ? { nextCursor: String(calls) } : {}) })),
    refresh: vi.fn() })
  let state!: ReturnType<typeof useMarketCalendar>
  function Harness() { state = useMarketCalendar({ months: ['2026-09'], locale: 'zh', now, client }); return null }
  root = createRoot(host)
  await act(async () => root!.render(<Harness />))
  expect(client.queryMonth.mock.calls.length).toBeLessThanOrEqual(3000)
  expect(state.failure).toBe(true)
})

it.each(['resolve', 'reject'] as const)('ignores a stale refresh %s after leaving and returning to the same scope', async (settlement) => {
  const { useMarketCalendar } = await import('./useMarketCalendar')
  let complete!: () => void
  const client = calendarClient({ queryMonth: vi.fn(async (input) => ({ state: 'available' as const, ...input, events: [], sources: [] })),
    refresh: vi.fn(() => new Promise<never>((resolve, reject) => {
      complete = () => settlement === 'reject' ? reject(new Error('derived failure')) : resolve({ state: 'completed', sources: [] } as never)
    })) })
  let state!: ReturnType<typeof useMarketCalendar>
  function Harness({ month }: { month: string }) { state = useMarketCalendar({ months: [month], locale: 'zh', now, client }); return null }
  root = createRoot(host)
  await act(async () => root!.render(<Harness month="2026-09" />))
  let refreshing!: Promise<void>
  await act(async () => { refreshing = state.refresh() })
  await act(async () => root!.render(<Harness month="2026-10" />))
  await act(async () => root!.render(<Harness month="2026-09" />))
  await act(async () => { complete(); await refreshing })
  expect(client.queryMonth).toHaveBeenCalledTimes(3)
  expect(state.feedback).toBeUndefined()
  expect(state.failure).toBe(false)
  expect(state.pending).toBe(false)
})

it('keeps the named month’s own verdict when only a neighbouring month fails', async () => {
  // 三个月一个 `failure` 布尔是坏的：「命名月成功、相邻月失败」时它也是 true，上层拿它挡空态就会把
  // 「相邻月读不到」写成「本月读不到」——同一个错误换个方向。每个月各自的读取结论必须是自己的。
  const { useMarketCalendar } = await import('./useMarketCalendar')
  const page = (month: string): MarketCalendarPage => ({ state: 'available', month, locale: 'zh', asOf: now().toISOString(), events: [], sources: [] })
  const client = calendarClient({
    queryMonth: vi.fn(async ({ month }: { month: string }) => month === '2026-08'
      ? { state: 'unavailable' as const, failureCode: 'query-unavailable' as const }
      : page(month)),
    refresh: vi.fn()
  })
  let state!: ReturnType<typeof useMarketCalendar>
  function Harness() { state = useMarketCalendar({ months: ['2026-09', '2026-08', '2026-10'], locale: 'zh', now, client }); return null }
  root = createRoot(host)
  await act(async () => root!.render(<Harness />))

  // 命名月读到了：它的结论不许被相邻月的失败改写。
  expect(state.namedMonthState).toEqual({ status: 'read' })
  expect(state.monthStates['2026-09']).toEqual({ status: 'read' })
  // 相邻月各自记账：失败的那个带它自己的原因，还没轮到的仍是「未请求」（我们读失败就停了）。
  expect(state.monthStates['2026-08']).toEqual({ status: 'failed', reason: 'query-unavailable' })
  expect(state.monthStates['2026-10']).toEqual({ status: 'not-requested' })
  // 窗口整体仍然不完整——既有那个布尔不撒谎，但它不再代言命名月。
  expect(state.failure).toBe(true)
})

it('reports 未请求 for every month before the first read settles', async () => {
  const { useMarketCalendar } = await import('./useMarketCalendar')
  // 首帧：还没有任何一月落定，三个都是「未请求」，不能被当成「读失败」或「读到空」。
  const resolver: { settle?: () => void } = {}
  const client = calendarClient({
    queryMonth: vi.fn(async ({ month }: { month: string }) => new Promise<MarketCalendarPage>(resolve => {
      resolver.settle = () => resolve({ state: 'available', month, locale: 'zh', asOf: now().toISOString(), events: [], sources: [] })
    })),
    refresh: vi.fn()
  })
  let state!: ReturnType<typeof useMarketCalendar>
  function Harness() { state = useMarketCalendar({ months: ['2026-09', '2026-08', '2026-10'], locale: 'zh', now, client }); return null }
  root = createRoot(host)
  await act(async () => root!.render(<Harness />))
  expect(state.namedMonthState).toEqual({ status: 'not-requested' })
  expect(Object.values(state.monthStates).every(entry => entry.status === 'not-requested')).toBe(true)
})

it('reads every month the grid draws and keeps a repeated observation once', async () => {
  const { useMarketCalendar } = await import('./useMarketCalendar')
  const event = { eventKey: 'shared-observation', title: 'Shared', countryCode: null, eventType: 'economic-indicator' as const,
    importance: 'high' as const, scheduledAt: '2026-09-01T10:00:00.000Z', consensus: null, providerActual: null, providerPrevious: null,
    source: '0xRouter' as const, sourceObservedAt: '2026-08-01T00:00:00.000Z', coverage: 'observed-unverified' as const }
  const client = calendarClient({ queryMonth: vi.fn(async ({ month }: { month: string }) => ({ state: 'available' as const, month, locale: 'zh' as const,
    asOf: now().toISOString(), events: month === '2026-09' || month === '2026-08' ? [event] : [], sources: [] })), refresh: vi.fn() })
  let state!: ReturnType<typeof useMarketCalendar>
  function Harness() { state = useMarketCalendar({ months: ['2026-09', '2026-08', '2026-10'], locale: 'zh', now, client }); return null }
  root = createRoot(host)
  await act(async () => root!.render(<Harness />))
  expect(client.queryMonth.mock.calls.map(([query]) => query.month).sort()).toEqual(['2026-08', '2026-09', '2026-10'])
  // The named month is read first, then the edges.
  expect(client.queryMonth.mock.calls[0]![0]).toMatchObject({ month: '2026-09' })
  expect(state.events).toHaveLength(1)
})
