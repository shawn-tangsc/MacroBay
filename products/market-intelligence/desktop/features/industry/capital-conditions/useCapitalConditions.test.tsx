// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModuleSignalRead } from '../../../../contracts/moduleSignalRead'
import { capitalConditionsReadRetryDelaysMs, useCapitalConditions } from './useCapitalConditions'

const asOf = '2026-08-18T08:00:00.000Z'
let root: Root | undefined

afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren() })

describe('useCapitalConditions', () => {
  it('freezes one mount as-of, queries exactly once, and retains only the projected state', async () => {
    const querySnapshot = vi.fn(async () => available())
    const page = await renderHook({ querySnapshot }, () => new Date(asOf))
    await flush()

    expect(querySnapshot).toHaveBeenCalledTimes(1)
    expect(querySnapshot).toHaveBeenCalledWith({ asOf })
    expect(page.container.textContent).toContain('$254.9B')
    expect(page.container.textContent).not.toMatch(/observedAt|verifiedAt|raw|https?:/i)
  })

  it('does not requery or recapture the clock after parent rerender', async () => {
    const querySnapshot = vi.fn(async () => ({ state: 'empty', asOf }))
    const now = vi.fn(() => new Date(asOf))
    const page = await renderHook({ querySnapshot }, now)
    await flush()
    const replacementNow = vi.fn(() => new Date('2026-09-01T00:00:00.000Z'))
    await act(async () => page.root.render(createElement(Harness, { client: { querySnapshot }, now: replacementNow })))
    await flush()

    expect(now).toHaveBeenCalledTimes(1)
    expect(replacementNow).not.toHaveBeenCalled()
    expect(querySnapshot).toHaveBeenCalledTimes(1)
  })

  it('re-reads the snapshot, and re-captures the clock, when the panel asks for a reload', async () => {
    const querySnapshot = vi.fn(async () => ({ state: 'empty', asOf }))
    const now = vi.fn(() => new Date(asOf))
    const page = await renderHook({ querySnapshot }, now)
    await flush()
    expect(querySnapshot).toHaveBeenCalledTimes(1)

    await act(async () => page.root.render(createElement(Harness, { client: { querySnapshot }, now, reloadKey: 1 })))
    await flush()

    // A reload is a new read of the current state, so it must not reuse the frozen mount clock.
    expect(querySnapshot).toHaveBeenCalledTimes(2)
    expect(querySnapshot).toHaveBeenLastCalledWith({ asOf })
  })

  // Rule: "not read yet" is neither "nothing" nor "failed". A slow first read must render loading
  // the whole time — an error or an empty view appearing before the read settles is the flash the
  // reader sees as "spinner → failed → data".
  it('stays on loading — never an error or an empty view — until the first read settles', async () => {
    let settle!: (value: unknown) => void
    const page = await renderHook({ querySnapshot: vi.fn(() => new Promise((done) => { settle = done })) }, () => new Date(asOf))
    await flush()
    expect(page.state()).toBe('loading')

    await act(async () => settle(available()))
    await flush()
    expect(page.container.textContent).toContain('$254.9B')
  })

  // Rule: a refresh that fails keeps the readings the reader already has; dropping to an error
  // view makes a transient failure look like the data disappeared.
  it('keeps the last readings when a reload fails, instead of replacing them with an error', async () => {
    let calls = 0
    const querySnapshot = vi.fn(async () => {
      calls += 1
      if (calls === 1) return available()
      throw new Error('read failed')
    })
    const now = vi.fn(() => new Date(asOf))
    const page = await renderHook({ querySnapshot }, now)
    await flush()
    expect(page.state()).toBe('available')

    await act(async () => page.root.render(createElement(Harness, { client: { querySnapshot }, now, reloadKey: 1 })))
    await flush()

    expect(querySnapshot).toHaveBeenCalledTimes(2)
    expect(page.state()).toBe('available')
    expect(page.container.textContent).toContain('$254.9B')
    // Kept, and marked as the previous readings rather than presented as fresh.
    expect(page.stale()).toBe('true')
  })

  // The reported flash: an instant failure followed by data. A read that fails and then succeeds
  // must never paint the error state in between.
  it('never shows a failure for a read that fails once and then succeeds', async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      const querySnapshot = vi.fn(async () => {
        calls += 1
        if (calls === 1) throw new Error('source still starting')
        return available()
      })
      const page = await renderHook({ querySnapshot }, () => new Date(asOf))
      await flush()
      // First attempt failed; the panel must still say "loading", not "failed".
      expect(page.state()).toBe('loading')

      await act(async () => { vi.advanceTimersByTime(capitalConditionsReadRetryDelaysMs[0]) })
      await flush()

      expect(querySnapshot).toHaveBeenCalledTimes(2)
      expect(page.state()).toBe('available')
      expect(page.container.textContent).toContain('$254.9B')
    } finally { vi.useRealTimers() }
  })

  it('treats a failure after the retries are spent as a real failure, not a permanent spinner', async () => {
    vi.useFakeTimers()
    try {
      const querySnapshot = vi.fn(async () => { throw new Error('down') })
      const page = await renderHook({ querySnapshot }, () => new Date(asOf))
      await flush()
      expect(page.state()).toBe('loading')

      for (const delay of capitalConditionsReadRetryDelaysMs) {
        await act(async () => { vi.advanceTimersByTime(delay) })
        await flush()
      }

      expect(querySnapshot).toHaveBeenCalledTimes(1 + capitalConditionsReadRetryDelaysMs.length)
      expect(page.state()).toBe('unavailable')
    } finally { vi.useRealTimers() }
  })

  // A retry re-reads without asking the sources for a new copy, so the reader's second attempt is
  // not spent re-collecting.
  it('re-reads on a retry without waiting for a collection', async () => {
    let calls = 0
    const querySnapshot = vi.fn(async () => {
      calls += 1
      if (calls === 1) return { state: 'empty', asOf }
      return available()
    })
    const now = vi.fn(() => new Date(asOf))
    const page = await renderHook({ querySnapshot }, now)
    await flush()

    await act(async () => page.root.render(createElement(Harness, { client: { querySnapshot }, now, retryKey: 1 })))
    await flush()

    expect(querySnapshot).toHaveBeenCalledTimes(2)
    expect(page.state()).toBe('available')
  })

  it('ignores stale resolution after unmount', async () => {
    let resolve!: (value: unknown) => void
    const page = await renderHook({ querySnapshot: vi.fn(() => new Promise((done) => { resolve = done })) }, () => new Date(asOf))
    await act(async () => page.root.unmount())
    resolve(available())
    await flush()
    expect(page.container.textContent).toBe('')
  })

  it('fails closed for a throwing clock or client', async () => {
    const clock = await renderHook({ querySnapshot: vi.fn() }, (() => { throw new Error('unsafe') }) as never)
    await flush()
    expect(clock.container.textContent).toBe('unavailable')
    await act(async () => clock.root.unmount())
    clock.container.remove()

    // A first read that keeps failing is retried with backoff, then reported once the attempts are
    // spent: the reader sees "failed" only when it is actually failed, not on the first hiccup.
    vi.useFakeTimers()
    try {
      const client = await renderHook({ querySnapshot: async () => { throw new Error('secret') } }, () => new Date(asOf))
      await flush()
      expect(client.state()).toBe('loading')
      for (const delay of capitalConditionsReadRetryDelaysMs) {
        await act(async () => { vi.advanceTimersByTime(delay) })
        await flush()
      }
      expect(client.state()).toBe('unavailable')
    } finally { vi.useRealTimers() }
  })
})

async function renderHook(
  client: { querySnapshot: (input: { asOf: string }) => Promise<unknown> },
  now: () => Date,
  signalClient?: { query: (input: { asOf: string }) => Promise<ModuleSignalRead> }
) {
  const container = document.createElement('div'); document.body.append(container)
  const localRoot = createRoot(container); root = localRoot
  await act(async () => localRoot.render(createElement(Harness, { client, now, ...(signalClient ? { signalClient } : {}) })))
  return {
    root: localRoot, container,
    state: () => container.querySelector('output')?.getAttribute('data-state') ?? '',
    stale: () => container.querySelector('output')?.getAttribute('data-stale') ?? '',
    chip: () => container.querySelector('output')?.getAttribute('data-chip') ?? ''
  }
}

function Harness({ client, now, reloadKey, retryKey, signalClient }: { client: { querySnapshot: (input: { asOf: string }) => Promise<unknown> }; now: () => Date; reloadKey?: number; retryKey?: number; signalClient?: { query: (input: { asOf: string }) => Promise<ModuleSignalRead> } }) {
  const state = useCapitalConditions({ client: client as never, ...(signalClient ? { signalClient } : {}), now, ...(reloadKey === undefined ? {} : { reloadKey }), ...(retryKey === undefined ? {} : { retryKey }) })
  const stale = state.state === 'available' && state.stale ? 'true' : 'false'
  const chip = state.state === 'available' && state.etfSignal ? state.etfSignal.state : ''
  return createElement('output', { 'data-state': state.state, 'data-stale': stale, 'data-chip': chip }, state.state === 'available' ? state.currentUsd : state.state)
}

function available() {
  return {
    state: 'available' as const, asOf, etf: { state: 'unavailable' as const }, conclusion: 'partial' as const,
    coreStablecoins: { observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 254_900_000_000, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 1, change30dPercent: 0.01 }
  }
}

async function flush(): Promise<void> { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }) }

describe('useCapitalConditions · ETF signal chip', () => {
  const signal = {
    version: '1', moduleId: 'etf-flows' as const, ruleId: 'etf-outflow-3d', asset: 'btc' as const,
    severity: 'medium' as const, observedAt: '2026-08-28T00:00:00.000Z', cadence: { kind: 'trading-day' as const },
    values: { cumulativeNetFlowUsd: -150_000_000, coveredDays: 3, requiredDays: 3 },
    dedupeKey: 'etf-flows:etf-outflow-3d:btc:2026-08-28', readiness: 'available' as const, triggerOwner: 'module-signal'
  }

  it('asks the module signal read for the same instant as the snapshot, and draws its chip', async () => {
    const window = { unit: 'trading-days' as const, amount: 3, upperBoundMs: null }
    const query = vi.fn(async (): Promise<ModuleSignalRead> => ({ state: 'available', signals: [{ signal, window }], droppedInvalid: 0 }))
    const page = await renderHook({ querySnapshot: async () => available() }, () => new Date(asOf), { query })
    await flush()

    expect(query).toHaveBeenCalledWith({ asOf })
    expect(page.chip()).toBe('alert')
  })

  // 读不到 ≠ 没事：读取失败有自己的那一态（能重试），不能悄悄消失成「今天没有」。
  it('marks a failed signal read as unreadable instead of a quiet card', async () => {
    const query = vi.fn(async (): Promise<ModuleSignalRead> => ({ state: 'unavailable', failureCode: 'query-failed' }))
    const page = await renderHook({ querySnapshot: async () => available() }, () => new Date(asOf), { query })
    await flush()

    expect(page.state()).toBe('available')
    expect(page.chip()).toBe('unreadable')
  })

  it('draws no chip when the rule has nothing to say', async () => {
    const query = vi.fn(async (): Promise<ModuleSignalRead> => ({ state: 'available', signals: [], droppedInvalid: 0 }))
    const page = await renderHook({ querySnapshot: async () => available() }, () => new Date(asOf), { query })
    await flush()

    expect(page.chip()).toBe('hidden')
  })
})
