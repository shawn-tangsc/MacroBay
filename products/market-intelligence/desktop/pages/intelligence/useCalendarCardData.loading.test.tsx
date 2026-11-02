// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import { useCalendarCardData } from './useCalendarCardData'

/**
 * 「还没读到」既不是「没有」，也不是「失败」。
 *
 * The card used to paint the error view before the first read settled, because its starting
 * projection was `unavailable`. These cases pin the *order* of states rather than a frame nobody
 * happens to see: while the read is in flight the hook may only report `loading`, an error needs a
 * failed read, and a failed refresh over existing rows keeps them and marks them stale.
 */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const asOf = '2026-10-14T12:00:00.000Z'
let root: ReturnType<typeof createRoot> | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

const event = {
  eventKey: 'US.CPI.RELEASE.2026-M09', releaseGroupKey: 'US.CPI.RELEASE.2026-M09', eventFamily: 'consumer-price-index',
  titleKey: 'cpi', countryCode: 'US', importance: 'high', periodKey: '2026-M09', lifecycleState: 'released',
  coverage: 'available', scheduledDate: '2026-10-14', scheduledAt: '2026-10-14T01:30:00.000Z', releaseTimeSource: 'official',
  detectedAt: asOf, actual: { displayValue: '3.2%' }, previous: { displayValue: '3.1%' }, consensus: { displayValue: '3.0%' },
  consensusState: 'available', surprise: 'beat', providerIds: ['macro-calendar-bls'], caveats: []
}

/** A platform whose calendar read only settles when the test says so. */
function deferredPlatform() {
  let release: ((value: unknown) => void) | undefined
  const pending = new Promise((resolve) => { release = resolve })
  const invoke = vi.fn(async (_product: string, method: string) => {
    if (method === 'intelligence.macro.economicCalendar.queryMonth') return await pending
    return { state: 'unavailable', failureCode: 'calendar-query-unavailable' }
  })
  vi.stubGlobal('platform', { products: { invoke } })
  return { settle: (value: unknown) => release?.(value) }
}


/** Lets the hook's promise chain (two clients per month, then the project step) finish. */
async function flush(): Promise<void> {
  for (let tick = 0; tick < 6; tick += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1)) })
}

async function mount(): Promise<{ states: string[]; reload: () => void }> {
  const states: string[] = []
  let latest: ReturnType<typeof useCalendarCardData> | undefined
  function Probe(): null {
    latest = useCalendarCardData({ asOf, locale: 'zh' })
    states.push(latest.state)
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<Probe />))
  return { states, reload: () => latest!.reload() }
}

it('reports loading, never an error or an empty card, before the first read settles', async () => {
  const platform = deferredPlatform()
  const { states } = await mount()
  await flush()
  // Nothing has settled yet: only `loading` may have been reported.
  expect(new Set(states)).toEqual(new Set(['loading']))
  await act(async () => platform.settle({ state: 'available', asOf, events: [event] }))
  await flush()
  expect(states.at(-1)).toBe('ready')
})

it('reaches the error state only after a read actually fails', async () => {
  // A payload of "no events" is a successful read with nothing in it, not a failure: only a thrown
  // read is an error, and the card must not turn the first into the second.
  vi.stubGlobal('platform', { products: { invoke: vi.fn(async () => { throw new Error('ipc down') }) } })
  const { states } = await mount()
  await flush()
  expect(states[0]).toBe('loading')
  expect(states.at(-1)).toBe('error')
  expect(states.indexOf('error')).toBe(states.length - 1)
})

it('keeps the rows it already has when a later read fails, and marks them as the last reading', async () => {
  let failing = false
  const invoke = vi.fn(async (_product: string, method: string, payload: unknown) => {
    if (method !== 'intelligence.macro.economicCalendar.queryMonth') return { state: 'unavailable', failureCode: 'calendar-query-unavailable' }
    if (failing) throw new Error('ipc down')
    const month = (payload as { month?: string } | null)?.month
    return month === '2026-10'
      ? { state: 'available', asOf, events: [event] }
      : { state: 'available', asOf, events: [] }
  })
  vi.stubGlobal('platform', { products: { invoke } })

  let latest: ReturnType<typeof useCalendarCardData> | undefined
  function Probe(): null {
    latest = useCalendarCardData({ asOf, locale: 'zh' })
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<Probe />))
  await flush()
  expect(latest!.state).toBe('ready')
  expect(latest!.projection.today).toHaveLength(1)

  failing = true
  await act(async () => latest!.reload())
  await flush()
  // The rows stay, the state stays usable, and the card says they are the last reading.
  expect(latest!.state).toBe('ready')
  expect(latest!.projection.today).toHaveLength(1)
  expect(latest!.stale).toBe(true)
})
