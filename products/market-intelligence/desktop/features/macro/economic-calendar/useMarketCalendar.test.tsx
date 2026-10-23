// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { MarketCalendarPage } from '../../../../contracts/macro/marketCalendarQueryContracts'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => { await act(async () => root?.unmount()); root = undefined })
const now = () => new Date('2026-09-10T00:00:00.000Z')
it('reads locally, refreshes only on demand and ignores completed requests from a superseded scope', async () => {
  const { useMarketCalendar } = await import('./useMarketCalendar')
  const empty = (month: string): MarketCalendarPage => ({ state: 'available', month, locale: 'zh', asOf: now().toISOString(), events: [], sources: [] })
  let resolve!: (page: MarketCalendarPage) => void
  const client = { queryMonth: vi.fn().mockImplementationOnce(() => new Promise(done => { resolve = done })).mockResolvedValue(empty('2026-10')),
    refresh: vi.fn().mockResolvedValue({ state: 'completed', sources: [] }) }
  let state!: ReturnType<typeof useMarketCalendar>
  function Harness({ month }: { month: string }) { state = useMarketCalendar({ month, locale: 'zh', now, client }); return null }
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
  const client = { queryMonth: vi.fn().mockResolvedValue({ state: 'unavailable', failureCode: 'query-unavailable' }),
    refresh: vi.fn().mockImplementation(() => new Promise(resolve => { complete = resolve })) }
  let state!: ReturnType<typeof useMarketCalendar>
  function Harness() { state = useMarketCalendar({ month: '2026-09', locale: 'zh', now, client }); return null }
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
  const client = { queryMonth: vi.fn(async () => ({ state: 'available' as const, month: '2026-09', locale: 'zh' as const,
    asOf: now().toISOString(), events: [], sources: [], ...(++calls <= 3010 ? { nextCursor: String(calls) } : {}) })),
    refresh: vi.fn() }
  let state!: ReturnType<typeof useMarketCalendar>
  function Harness() { state = useMarketCalendar({ month: '2026-09', locale: 'zh', now, client }); return null }
  root = createRoot(host)
  await act(async () => root!.render(<Harness />))
  expect(client.queryMonth.mock.calls.length).toBeLessThanOrEqual(3000)
  expect(state.failure).toBe(true)
})

it.each(['resolve', 'reject'] as const)('ignores a stale refresh %s after leaving and returning to the same scope', async (settlement) => {
  const { useMarketCalendar } = await import('./useMarketCalendar')
  let complete!: () => void
  const client = { queryMonth: vi.fn(async (input) => ({ state: 'available' as const, ...input, events: [], sources: [] })),
    refresh: vi.fn(() => new Promise<never>((resolve, reject) => {
      complete = () => settlement === 'reject' ? reject(new Error('derived failure')) : resolve({ state: 'completed', sources: [] } as never)
    })) }
  let state!: ReturnType<typeof useMarketCalendar>
  function Harness({ month }: { month: string }) { state = useMarketCalendar({ month, locale: 'zh', now, client }); return null }
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
