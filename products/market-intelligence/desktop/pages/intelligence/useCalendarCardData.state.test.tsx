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
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const asOf = '2026-10-14T12:00:00.000Z'
const eventAt = '2026-10-14T01:30:00.000Z'
let root: ReturnType<typeof createRoot> | undefined
let latest: CalendarCardDataState | undefined
let mode: 'pending' | 'ok' | 'fail' = 'pending'

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
  const invoke = vi.fn(async (_product: string, method: string, payload: unknown) => {
    if (method === 'intelligence.macro.economicCalendar.queryMonth') {
      if (mode === 'pending') return new Promise(() => undefined)
      if (mode === 'fail') throw new Error('read failed')
      const month = (payload as { month?: string } | null)?.month
      return month === '2026-10' ? { state: 'available', asOf, events: [officialEvent] } : { state: 'available', asOf, events: [] }
    }
    return { state: 'unavailable', failureCode: 'calendar-query-unavailable' }
  })
  vi.stubGlobal('platform', { products: { invoke } })
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
