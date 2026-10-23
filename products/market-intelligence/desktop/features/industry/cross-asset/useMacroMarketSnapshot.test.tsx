// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MacroMarketSnapshotView } from '../../../../contracts/macro/macroMarketSnapshotContracts'
import { hasLiveReading, macroMarketViewPolicy, useMacroMarketSnapshot } from './useMacroMarketSnapshot'

/** A gold reading, with or without the live tick: the only difference the cadence reacts to. */
const fixture = ({ live = false } = {}): MacroMarketSnapshotView => Object.freeze({
  state: 'available' as const, asOf: '2026-09-14T12:00:00.000Z',
  source: { enabled: true, hasCredential: true }, caveats: [],
  readings: [Object.freeze({
    seriesId: 'xau-usd', level: 3412.55, atMs: Date.parse('2026-09-14T12:00:00.000Z'), returns: {},
    ...(live ? { live: { state: 'live' as const, price: '3413.90', atMs: Date.parse('2026-09-14T12:00:00.000Z') } } : {})
  })]
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.useRealTimers() })

const client = () => ({ query: vi.fn(async () => ({ state: 'unavailable' as const })) })
async function render(api: ReturnType<typeof client>) {
  const container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  let latest!: ReturnType<typeof useMacroMarketSnapshot>
  function Harness() { latest = useMacroMarketSnapshot({ client: api as never }); return createElement('output', null, latest.state) }
  await act(async () => root!.render(createElement(Harness)))
  return { state: () => latest }
}

describe('the macro-market snapshot hook', () => {
  it('separates the two cadences and reads only an admitted live tick as live', () => {
    // The live cadence exists so the gold row moves like the cross-asset rows; the settled cadence
    // is the fastest the collector could have written anything new.
    expect(macroMarketViewPolicy.liveQueryMs).toBe(5_000)
    expect(macroMarketViewPolicy.settledQueryMs).toBeGreaterThan(macroMarketViewPolicy.liveQueryMs)
    expect(hasLiveReading(undefined)).toBe(false)
    expect(hasLiveReading({ state: 'unavailable' })).toBe(false)
    expect(hasLiveReading(fixture())).toBe(false)
    expect(hasLiveReading(fixture({ live: true }))).toBe(true)
  })

  it('polls at the live cadence while a tick is present and at the settled cadence when it is not', async () => {
    vi.useFakeTimers()
    const api = client()
    // First answer is live, second is not: the cadence has to follow the answer, not the first read.
    api.query.mockResolvedValueOnce(fixture({ live: true }) as never)
      .mockResolvedValue(fixture() as never)
    const page = await render(api)
    expect(api.query).toHaveBeenCalledTimes(1)
    expect(page.state().snapshot).toMatchObject({ state: 'available' })

    // One live interval later: the fast cadence really is armed.
    await act(async () => vi.advanceTimersByTimeAsync(macroMarketViewPolicy.liveQueryMs))
    expect(api.query).toHaveBeenCalledTimes(2)
    // Half a settled interval later nothing has happened: the answer was not live, so the fast
    // cadence was not armed again.
    await act(async () => vi.advanceTimersByTimeAsync(Math.floor(macroMarketViewPolicy.settledQueryMs / 2)))
    expect(api.query).toHaveBeenCalledTimes(2)
    await act(async () => vi.advanceTimersByTimeAsync(macroMarketViewPolicy.settledQueryMs))
    expect(api.query).toHaveBeenCalledTimes(3)
  })

  it('falls back to the settled cadence after a failed read and never re-polls a poll that threw', async () => {
    vi.useFakeTimers()
    const api = client()
    api.query.mockRejectedValueOnce(new Error('ipc down')).mockResolvedValue(fixture({ live: true }) as never)
    const page = await render(api)
    expect(page.state()).toMatchObject({ state: 'unavailable', snapshot: undefined })
    await act(async () => vi.advanceTimersByTimeAsync(macroMarketViewPolicy.settledQueryMs))
    expect(api.query).toHaveBeenCalledTimes(2)
    expect(page.state().state).toBe('ready')
  })

  it('stops polling once the client goes away', async () => {
    vi.useFakeTimers()
    const api = client()
    api.query.mockResolvedValue(fixture({ live: true }) as never)
    await render(api)
    expect(api.query).toHaveBeenCalledTimes(1)
    await act(async () => root!.unmount())
    root = undefined
    await act(async () => vi.advanceTimersByTimeAsync(macroMarketViewPolicy.liveQueryMs * 5))
    expect(api.query).toHaveBeenCalledTimes(1)
  })

  it('reports the empty view without a client and never calls one', async () => {
    const api = client()
    const container = document.createElement('div'); document.body.append(container)
    root = createRoot(container)
    let latest!: ReturnType<typeof useMacroMarketSnapshot>
    function Harness() { latest = useMacroMarketSnapshot({}); return createElement('output', null, latest.state) }
    await act(async () => root!.render(createElement(Harness)))
    expect(latest).toMatchObject({ state: 'unavailable', snapshot: undefined })
    expect(api.query).not.toHaveBeenCalled()
  })
})
