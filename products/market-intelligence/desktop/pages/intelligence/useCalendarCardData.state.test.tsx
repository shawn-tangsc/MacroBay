// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import { useCalendarCardData, type CalendarCardDataState } from './useCalendarCardData'

/**
 * The card's three states: a slow read must only ever show loading, a real failure shows the error
 * with a retry, and a refresh that fails keeps the rows it already had and marks them as previous.
 *
 * These are the three acceptance criteria of the field bug: the card opened on «读取失败 + 重试»
 * before its first answer, then flipped to data.
 */
const asOf = '2026-10-14T12:00:00.000Z'
const eventAt = '2026-10-14T01:30:00.000Z'
let root: ReturnType<typeof createRoot> | undefined
let latest: CalendarCardDataState | undefined
let mode: 'pending' | 'ok' | 'fail' = 'pending'
/** 产品事件通道上的订阅者：这一屏的日历月读口自己订一条（`economic-calendar` 面板）。 */
let dataChangedHandlers: Array<(data: unknown) => void> = []
let invoke: ReturnType<typeof vi.fn> | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  latest = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

const officialEvent = {
  eventKey: 'US.CPI.RELEASE.2026-M10', releaseGroupKey: 'US.CPI.RELEASE.2026-M10', eventFamily: 'consumer-price-index',
  titleKey: 'cpi', countryCode: 'US', importance: 'high', periodKey: '2026-M10', lifecycleState: 'released',
  coverage: 'available', scheduledDate: '2026-10-14', scheduledAt: eventAt, releaseTimeSource: 'official', detectedAt: asOf,
  actual: { displayValue: '3.2%' }, previous: { displayValue: '3.1%' }, consensus: { displayValue: '3.0%' },
  consensusState: 'available', surprise: 'beat', providerIds: ['macro-calendar-bls'], caveats: []
}

function stubPlatform(): void {
  dataChangedHandlers = []
  invoke = vi.fn(async (_product: string, method: string, payload: unknown) => {
    if (method === 'intelligence.macro.economicCalendar.queryMonth') {
      if (mode === 'pending') return new Promise(() => undefined)
      if (mode === 'fail') throw new Error('read failed')
      const month = (payload as { month?: string } | null)?.month
      return month === '2026-10' ? { state: 'available', asOf, events: [officialEvent] } : { state: 'available', asOf, events: [] }
    }
    return { state: 'unavailable', failureCode: 'calendar-query-unavailable' }
  })
  vi.stubGlobal('platform', {
    products: {
      invoke,
      onEvent: (_productId: string, _event: string, listener: (data: unknown) => void) => {
        dataChangedHandlers.push(listener)
        return () => { dataChangedHandlers = dataChangedHandlers.filter(entry => entry !== listener) }
      }
    }
  })
}

async function mount(): Promise<void> {
  stubPlatform()
  function Probe(): null {
    latest = useCalendarCardData({ asOf, locale: 'zh' })
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<Probe />))
}

async function settle(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) await act(async () => { await Promise.resolve() })
}

it('stays loading on the first frame and never turns a pending read into an error', async () => {
  mode = 'pending'
  await mount()
  expect(latest?.state).toBe('loading')
  await settle()
  expect(latest?.state).toBe('loading')
  expect(latest?.stale).toBe(false)
})

it('shows the error state only once the read actually failed', async () => {
  mode = 'fail'
  await mount()
  await settle()
  expect(latest?.state).toBe('error')
})

it('keeps the previous rows and marks them stale when a refresh fails', async () => {
  mode = 'ok'
  await mount()
  await settle()
  expect(latest?.state).toBe('ready')
  const rows = latest?.projection.today.length
  expect(rows).toBeGreaterThan(0)

  mode = 'fail'
  await act(async () => latest?.reload())
  await settle()
  expect(latest?.state).toBe('ready')
  expect(latest?.stale).toBe(true)
  expect(latest?.projection.today).toHaveLength(rows!)
})

it('clears the stale mark when the retried read succeeds', async () => {
  mode = 'ok'
  await mount()
  await settle()
  mode = 'fail'
  await act(async () => latest?.reload())
  await settle()
  expect(latest?.stale).toBe(true)

  mode = 'ok'
  await act(async () => latest?.reload())
  await settle()
  expect(latest?.state).toBe('ready')
  expect(latest?.stale).toBe(false)
})

function monthQueries(): number {
  return (invoke?.mock.calls ?? []).filter(([, method]) => method === 'intelligence.macro.economicCalendar.queryMonth').length
}

it('re-reads the months when a collector writes the calendar, and keeps the rows it already has', async () => {
  mode = 'ok'
  await mount()
  await settle()
  expect(latest?.state).toBe('ready')
  const before = monthQueries()
  expect(before).toBeGreaterThan(0)

  // 采集写了日历库 → 这一屏（`economic-calendar` 面板）重读它自己那几窗。
  await act(async () => {
    dataChangedHandlers.forEach(handler => handler({ panels: ['economic-calendar'], sources: ['macro-calendar-bls'] }))
  })
  await settle()

  expect(monthQueries()).toBeGreaterThan(before)
  // 重读不清空读数：有行就留着，不退回 loading。
  expect(latest?.state).toBe('ready')
})

it('leaves the calendar alone when the write belongs to another panel', async () => {
  mode = 'ok'
  await mount()
  await settle()
  const before = monthQueries()

  await act(async () => {
    dataChangedHandlers.forEach(handler => handler({ panels: ['dashboard'], sources: ['binance-futures'] }))
  })
  await settle()

  expect(monthQueries()).toBe(before)
})
