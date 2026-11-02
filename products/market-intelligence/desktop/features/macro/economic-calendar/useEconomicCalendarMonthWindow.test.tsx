// @vitest-environment happy-dom
import { act, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import type { MacroEconomicCalendarClient } from '../../../shared/ipc/macroEconomicCalendarClient'
import type { EconomicCalendarMonthState } from './useEconomicCalendarMonthWindow'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; vi.useRealTimers() })

const asOf = '2026-08-05T00:00:00.000Z'
const page = (month: string, events: readonly unknown[] = []) => ({ state: 'available' as const, asOf, events })

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventKey: 'US.CPI.RELEASE.AUGUST', releaseGroupKey: 'US.BLS.RELEASE.AUGUST', eventFamily: 'cpi', titleKey: 'cpi',
    countryCode: 'US', importance: 'high', periodKey: 'release-2026-08-12', lifecycleState: 'scheduled',
    coverage: 'available', scheduledDate: '2026-08-12', releaseTimeSource: 'official',
    detectedAt: asOf, consensus: null, consensusState: 'unavailable', surprise: 'consensus-unavailable',
    providerIds: ['macro-calendar-bls'], caveats: [], ...overrides
  }
}

async function renderWindow(client: Partial<MacroEconomicCalendarClient>) {
  const { useEconomicCalendarMonthWindow } = await import('./useEconomicCalendarMonthWindow')
  let state!: { monthState: EconomicCalendarMonthState; loadMonth: (month: string, refresh?: boolean, nextAsOf?: string) => void }
  function Harness({ month }: { month: string }) {
    const ref = useRef(month); ref.current = month
    state = useEconomicCalendarMonthWindow({ client: client as never, asOf, selectedMonthRef: ref })
    const { loadMonth } = state
    useEffect(() => { loadMonth(month) }, [month]) // eslint-disable-line react-hooks/exhaustive-deps
    return null
  }
  const tree = (month: string) => <Harness month={month} />
  root = createRoot(host)
  await act(async () => root!.render(tree('2026-08')))
  return { get state() { return state }, rerender: async (month: string) => { await act(async () => root!.render(tree(month))) } }
}

it('reads the month and the neighbours its grid draws, and merges them', async () => {
  const client = { queryMonth: vi.fn(async ({ month }: { month: string }) => page(month, month === '2026-09' ? [event({ eventKey: 'US.CPI.SEPTEMBER', scheduledDate: '2026-09-12' })] : [])) }
  const window = await renderWindow(client)
  expect(client.queryMonth.mock.calls.map(([query]) => query.month).sort()).toEqual(['2026-07', '2026-08', '2026-09'])
  expect(window.state.monthState).toMatchObject({ state: 'available', incomplete: false })
  if (window.state.monthState.state !== 'available') throw new Error('expected an available month')
  expect(window.state.monthState.events.map(item => item.eventKey)).toEqual(['US.CPI.SEPTEMBER'])
})

it('keeps the month when only a neighbour fails, and reports the month alone when it fails', async () => {
  const neighbourFails = { queryMonth: vi.fn(async ({ month }: { month: string }) => month === '2026-09'
    ? { state: 'unavailable' as const, failureCode: 'calendar-query-unavailable' as const } : page(month)) }
  const window = await renderWindow(neighbourFails)
  expect(window.state.monthState).toMatchObject({ state: 'available', incomplete: true })

  const monthFails = { queryMonth: vi.fn(async ({ month }: { month: string }) => month === '2026-08'
    ? { state: 'unavailable' as const, failureCode: 'calendar-query-unavailable' as const } : page(month)) }
  const failing = await renderWindow(monthFails)
  expect(failing.state.monthState).toEqual({ state: 'unavailable', failureCode: 'calendar-query-unavailable' })
})

it('ignores a month that finished after the reader moved on', async () => {
  let settleAugust!: (value: unknown) => void
  const client = { queryMonth: vi.fn(({ month }: { month: string }) => month === '2026-08'
    ? new Promise(resolve => { settleAugust = resolve })
    : Promise.resolve(page(month))) }
  const window = await renderWindow(client)
  await window.rerender('2026-10')
  await act(async () => settleAugust(page('2026-08', [event()])))

  expect(window.state.monthState).toMatchObject({ state: 'available', incomplete: false })
  if (window.state.monthState.state !== 'available') throw new Error('expected an available month')
  expect(window.state.monthState.projection.month).toBe('2026-10')
  expect(window.state.monthState.events).toEqual([])
})

it('uses what arrived when a neighbour never answers, instead of blanking the month', async () => {
  vi.useFakeTimers()
  const client = { queryMonth: vi.fn(({ month }: { month: string }) => month === '2026-09'
    ? new Promise(() => undefined)
    : Promise.resolve(page(month, month === '2026-08' ? [event()] : []))) }
  const window = await renderWindow(client)
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })

  if (window.state.monthState.state !== 'available') throw new Error('expected an available month')
  expect(window.state.monthState.incomplete).toBe(true)
  expect(window.state.monthState.events.map(item => item.eventKey)).toEqual(['US.CPI.RELEASE.AUGUST'])
})

it('reads again only when asked to refresh, and refuses a month it does not recognise', async () => {
  const client = { queryMonth: vi.fn(async ({ month }: { month: string }) => page(month)) }
  const window = await renderWindow(client)
  expect(client.queryMonth).toHaveBeenCalledTimes(3)
  await act(async () => window.state.loadMonth('2026-08', true))
  expect(client.queryMonth).toHaveBeenCalledTimes(6)
  await act(async () => window.state.loadMonth('nope'))
  expect(client.queryMonth).toHaveBeenCalledTimes(6)
})
