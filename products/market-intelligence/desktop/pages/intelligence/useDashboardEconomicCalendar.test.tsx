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
  it('uses one current-month request when current contains both release dynamics groups', async () => {
    const queryMonth = vi.fn(async () => available([
      releasedEvent({ scheduledDate: '2026-08-04', officialReleaseDate: '2026-08-04' }),
      scheduledEvent({ scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T12:30:00.000Z' })
    ]))
    const now = vi.fn(() => new Date(asOf))
    const page = await renderHook({ queryMonth }, now)

    await flush()

    expect(now).toHaveBeenCalledTimes(1)
    expect(queryMonth).toHaveBeenCalledOnce()
    expect(queryMonth).toHaveBeenCalledWith({ month: '2026-08', asOf })
    expect(page.state()).toEqual({ state: 'available', upcomingDate: '2026-08-12', releasedDate: '2026-08-04' })
  })

  it('queries previous only when current has upcoming but no released group', async () => {
    const queryMonth = vi.fn()
      .mockResolvedValueOnce(available([scheduledEvent({ scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T12:30:00.000Z' })]))
      .mockResolvedValueOnce(available([releasedEvent({ scheduledDate: '2026-07-31', officialReleaseDate: '2026-07-31' })]))
    const page = await renderHook({ queryMonth }, () => new Date(asOf))

    await flush()

    expect(queryMonth).toHaveBeenNthCalledWith(1, { month: '2026-08', asOf })
    expect(queryMonth).toHaveBeenNthCalledWith(2, { month: '2026-07', asOf })
    expect(queryMonth).toHaveBeenCalledTimes(2)
    expect(page.state()).toEqual({ state: 'available', upcomingDate: '2026-08-12', releasedDate: '2026-07-31' })
  })

  it('queries next only when current has released but no upcoming group', async () => {
    const queryMonth = vi.fn()
      .mockResolvedValueOnce(available([releasedEvent({ scheduledDate: '2026-08-04', officialReleaseDate: '2026-08-04' })]))
      .mockResolvedValueOnce(available([scheduledEvent({ scheduledDate: '2026-09-03', scheduledAt: '2026-09-03T12:30:00.000Z' })]))
    const page = await renderHook({ queryMonth }, () => new Date(asOf))

    await flush()

    expect(queryMonth).toHaveBeenNthCalledWith(1, { month: '2026-08', asOf })
    expect(queryMonth).toHaveBeenNthCalledWith(2, { month: '2026-09', asOf })
    expect(queryMonth).toHaveBeenCalledTimes(2)
    expect(page.state()).toEqual({ state: 'available', upcomingDate: '2026-09-03', releasedDate: '2026-08-04' })
  })

  it('uses current then previous then next with the immutable mount as-of when both fallbacks are needed', async () => {
    const queryMonth = vi.fn()
      .mockResolvedValueOnce(available([]))
      .mockResolvedValueOnce(available([releasedEvent({ scheduledDate: '2026-07-31', officialReleaseDate: '2026-07-31' })]))
      .mockResolvedValueOnce(available([scheduledEvent({ scheduledDate: '2026-09-03', scheduledAt: '2026-09-03T12:30:00.000Z' })]))
    const now = vi.fn(() => new Date(asOf))
    const page = await renderHook({ queryMonth }, now)

    await flush()

    expect(queryMonth.mock.calls).toEqual([
      [{ month: '2026-08', asOf }],
      [{ month: '2026-07', asOf }],
      [{ month: '2026-09', asOf }]
    ])
    expect(now).toHaveBeenCalledOnce()
    expect(page.state()).toEqual({ state: 'available', upcomingDate: '2026-09-03', releasedDate: '2026-07-31' })
  })

  it('fails closed after a requested previous fallback fails without querying next', async () => {
    const queryMonth = vi.fn()
      .mockResolvedValueOnce(available([]))
      .mockResolvedValueOnce({ state: 'unavailable', failureCode: 'calendar-query-unavailable' })
    const page = await renderHook({ queryMonth }, () => new Date(asOf))

    await flush()

    expect(queryMonth.mock.calls).toEqual([
      [{ month: '2026-08', asOf }],
      [{ month: '2026-07', asOf }]
    ])
    expect(page.state()).toEqual({ state: 'unavailable' })
  })

  it('fails closed after a requested next fallback fails', async () => {
    const queryMonth = vi.fn()
      .mockResolvedValueOnce(available([releasedEvent({ scheduledDate: '2026-08-04', officialReleaseDate: '2026-08-04' })]))
      .mockResolvedValueOnce({ state: 'unavailable', failureCode: 'calendar-query-unavailable' })
    const page = await renderHook({ queryMonth }, () => new Date(asOf))

    await flush()

    expect(queryMonth.mock.calls).toEqual([
      [{ month: '2026-08', asOf }],
      [{ month: '2026-09', asOf }]
    ])
    expect(page.state()).toEqual({ state: 'unavailable' })
  })

  it('fails closed without a fallback when the current reply is unsafe or throws', async () => {
    const unsafeQuery = vi.fn(async () => ({ state: 'available', asOf, events: [{ ...scheduledEvent(), sourceUrl: 'https://secret.example.test' }] }))
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
    deferred.resolve(available([scheduledEvent()]))
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
    state: () => {
      const output = container.querySelector('output')!
      return {
        state: output.dataset.state!,
        ...(output.dataset.upcomingDate ? { upcomingDate: output.dataset.upcomingDate } : {}),
        ...(output.dataset.releasedDate ? { releasedDate: output.dataset.releasedDate } : {})
      }
    }
  }
}

function Harness({ client, now }: { client: { queryMonth: (input: { month: string; asOf: string }) => Promise<unknown> }; now: () => Date }) {
  const state = useDashboardEconomicCalendar({ client: client as never, now })
  return createElement('output', {
    'data-state': state.state,
    'data-upcoming-date': state.state === 'available' ? state.upcoming?.scheduledDate : undefined,
    'data-released-date': state.state === 'available' ? state.released?.officialReleaseDate : undefined
  })
}

function available(events: unknown[]) {
  return { state: 'available', asOf, events }
}

function scheduledEvent(overrides: Record<string, unknown> = {}) {
  return event({ lifecycleState: 'scheduled', scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T12:30:00.000Z', ...overrides })
}

function releasedEvent(overrides: Record<string, unknown> = {}) {
  return event({ lifecycleState: 'released', scheduledAt: undefined, officialReleaseDate: '2026-08-04', actual: { displayValue: '3.2%' }, ...overrides })
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventKey: 'US.CPI.RELEASE.uid-1', releaseGroupKey: 'US.BLS.RELEASE.uid-1', eventFamily: 'cpi', titleKey: 'cpi',
    countryCode: 'US', importance: 'high', periodKey: 'release-2026-08-12', lifecycleState: 'scheduled', coverage: 'available',
    scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T12:30:00.000Z', detectedAt: asOf,
    consensus: null, consensusState: 'unavailable', surprise: 'consensus-unavailable', providerIds: ['macro-calendar-bls'], caveats: [],
    ...overrides
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
