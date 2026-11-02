// @vitest-environment happy-dom
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { OpenInterestHistoryResult } from '../../../contracts/openInterestHistory'
import type { ModuleSignal } from '../../../contracts/moduleSignal'
import type { DashboardPositioningViewState } from './dashboardOpenInterestModel'
import { useDashboardOpenInterest } from './useDashboardOpenInterest'

const asOf = '2026-10-31T14:45:00.000Z'
const at = '2026-10-31T14:30:00.000Z'

const history: OpenInterestHistoryResult = {
  state: 'available', asOf, window: '24h',
  btc: [{ observedAt: at, notionalUsd: 7.4e9 }],
  eth: [{ observedAt: at, notionalUsd: 2.4e9 }],
  liquidationHintsState: 'available'
}

const signal: ModuleSignal = {
  version: '1', moduleId: 'open-interest', ruleId: 'oi-liquidation-proxy', asset: 'btc',
  severity: 'high', observedAt: at,
  cadence: { kind: 'intraday', bucketMs: 15 * 60_000 },
  values: { dropPct: -2.7, volumeMultiple: 3.4, notionalUsd: 7.4e9 },
  dedupeKey: 'open-interest:oi-liquidation-proxy:btc:2026-10-31T14:30:00.000Z',
  readiness: 'available', triggerOwner: 'module-signal'
}

let latest: DashboardPositioningViewState | undefined

function Probe(props: Readonly<{ signalClient: { query: (input: { asOf: string }) => Promise<readonly ModuleSignal[]> } }>) {
  latest = useDashboardOpenInterest({
    client: { query: async () => history },
    signalClient: props.signalClient,
    now: () => new Date(asOf),
    window: '24h'
  })
  return null
}

const roots: Array<ReturnType<typeof createRoot>> = []
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  latest = undefined
})

async function renderProbe(signalClient: { query: (input: { asOf: string }) => Promise<readonly ModuleSignal[]> }) {
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.push(root)
  await act(async () => { root.render(createElement(Probe, { signalClient })) })
  return latest
}

function ReadProbe(props: Readonly<{ client: { query: (input: { asOf: string; window: '24h' }) => Promise<OpenInterestHistoryResult> } }>) {
  latest = useDashboardOpenInterest({
    client: props.client,
    signalClient: { query: async () => [] },
    now: () => new Date(asOf),
    window: '24h'
  })
  return null
}

async function renderReadProbe(client: { query: (input: { asOf: string; window: '24h' }) => Promise<OpenInterestHistoryResult> }) {
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.push(root)
  await act(async () => { root.render(createElement(ReadProbe, { client })) })
  return latest
}

describe('positioning hook first read', () => {
  it('stays loading while the read is in flight, before the card has anything to say', async () => {
    let settle: ((value: OpenInterestHistoryResult) => void) | undefined
    const client = { query: () => new Promise<OpenInterestHistoryResult>((resolve) => { settle = resolve }) }
    const state = await renderReadProbe(client)
    // Nothing has come back yet, so waiting is its own state. Drawing a failure or an empty card
    // here is what makes a card flash "could not read" before the first reading arrives.
    expect(state).toMatchObject({ state: 'loading' })
    await act(async () => { settle!(history) })
    expect(latest).toMatchObject({ state: 'available' })
  })

  it('becomes a failed read only when the read actually rejects, and the card can retry', async () => {
    const state = await renderReadProbe({ query: async () => { throw new Error('ipc down') } })
    expect(state).toMatchObject({ state: 'unavailable' })
    expect(typeof (state as { onReload?: unknown }).onReload).toBe('function')
  })
})

describe('positioning hook signal wiring', () => {
  it('puts the rule’s chip on the card from the same read the panel already makes', async () => {
    const query = vi.fn(async () => [signal])
    const state = await renderProbe({ query })
    expect(query).toHaveBeenCalledWith({ asOf })
    expect(state).toMatchObject({ state: 'available', signal: { state: 'alert', dropPct: -2.7 } })
  })

  it('draws no chip when the rule says nothing', async () => {
    const state = await renderProbe({ query: async () => [] })
    expect(state).toMatchObject({ state: 'available', signal: { state: 'hidden' } })
  })

  it('keeps the series when the signal read fails: no chip, not a broken card', async () => {
    const state = await renderProbe({ query: async () => { throw new Error('ipc down') } })
    expect(state).toMatchObject({ state: 'available', signal: { state: 'hidden' } })
  })
})
