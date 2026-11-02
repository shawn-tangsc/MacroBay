// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useDashboardEconomicCalendar } from './useDashboardEconomicCalendar'

const asOf = '2026-08-05T00:00:00.000Z'
let root: Root | undefined

globalThis.IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

describe('useDashboardEconomicCalendar', () => {
  it('reads the current month once and reports it as available', async () => {
    const queryMonth = vi.fn(async () => available([event()]))
    const now = vi.fn(() => new Date(asOf))
    const page = await renderHook({ queryMonth }, now)

    await flush()

    expect(now).toHaveBeenCalledTimes(1)
    expect(queryMonth).toHaveBeenCalledOnce()
    expect(queryMonth).toHaveBeenCalledWith({ month: '2026-08', asOf })
    expect(page.state()).toEqual({ state: 'available' })
  })

  it('reports an eventless month as empty without falling back to another month', async () => {
    const queryMonth = vi.fn(async () => available([]))
    const page = await renderHook({ queryMonth }, () => new Date(asOf))

    await flush()

    expect(queryMonth.mock.calls).toEqual([[{ month: '2026-08', asOf }]])
    expect(page.state()).toEqual({ state: 'empty' })
  })

  it('reports the reply as unavailable instead of querying a fallback', async () => {
    const queryMonth = vi.fn(async () => ({ state: 'unavailable', failureCode: 'calendar-query-unavailable' }))
    const page = await renderHook({ queryMonth }, () => new Date(asOf))

    await flush()

    expect(queryMonth).toHaveBeenCalledOnce()
    expect(page.state()).toEqual({ state: 'unavailable' })
  })

  it('fails closed without a fallback when the current reply is unreadable or throws', async () => {
    const unsafeQuery = vi.fn(async () => ({ state: 'available', asOf, events: 'not-an-array' }))
    const unsafe = await renderHook({ queryMonth: unsafeQuery }, () => new Date(asOf))
    await flush()
    expect(unsafeQuery).toHaveBeenCalledOnce()
    expect(unsafe.state()).toEqual({ state: 'unavailable' })
    await act(async () => unsafe.root.unmount())
    unsafe.container.remove()

    const throwingQuery = vi.fn(async () => { throw new Error('untrusted failure') })
    const throwing = await renderHook({ queryMonth: throwingQuery }, () => new Date(asOf))
    await flush()
    expect(throwingQuery).toHaveBeenCalledOnce()
    expect(throwing.state()).toEqual({ state: 'unavailable' })
  })

  it('makes zero requests for an invalid clock and ignores stale completion after unmount', async () => {
    const invalidQuery = vi.fn(async () => available([]))
    const invalid = await renderHook({ queryMonth: invalidQuery }, () => new Date('invalid'))
    await flush()
    expect(invalidQuery).not.toHaveBeenCalled()
    expect(invalid.state()).toEqual({ state: 'unavailable' })
    await act(async () => invalid.root.unmount())
    invalid.container.remove()

    const deferred = createDeferred<unknown>()
    const queryMonth = vi.fn(() => deferred.promise)
    const page = await renderHook({ queryMonth }, () => new Date(asOf))
    await act(async () => page.root.unmount())
    deferred.resolve(available([event()]))
    await flush()

    expect(page.container.textContent).toBe('')
  })
})

async function renderHook(client: { queryMonth: (input: { month: string; asOf: string }) => Promise<unknown> }, now: () => Date) {
  const container = document.createElement('div')
  document.body.append(container)
  const localRoot = createRoot(container)
  root = localRoot
  await act(async () => localRoot.render(createElement(Harness, { client, now })))
  return {
    container,
    root: localRoot,
    state: () => ({ state: container.querySelector('output')!.dataset.state! })
  }
}

function Harness({ client, now }: { client: { queryMonth: (input: { month: string; asOf: string }) => Promise<unknown> }; now: () => Date }) {
  const state = useDashboardEconomicCalendar({ client: client as never, now })
  return createElement('output', { 'data-state': state.state })
}

function available(events: unknown[]) {
  return { state: 'available', asOf, events }
}

function event() {
  return {
    eventKey: 'US.CPI.RELEASE.uid-1', releaseGroupKey: 'US.BLS.RELEASE.uid-1', eventFamily: 'cpi', titleKey: 'cpi',
    countryCode: 'US', importance: 'high', periodKey: 'release-2026-08-12', lifecycleState: 'scheduled', coverage: 'available',
    scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T12:30:00.000Z', detectedAt: asOf,
    consensus: null, consensusState: 'unavailable', surprise: 'consensus-unavailable', providerIds: ['macro-calendar-bls'], caveats: []
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
