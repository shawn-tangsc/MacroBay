// @vitest-environment happy-dom
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import type { MarketDivergenceResult } from '../../../contracts/marketDivergence'
import type { DashboardDivergenceViewState } from './dashboardDivergenceModel'
import { useDashboardDivergence } from './useDashboardDivergence'

const asOf = '2026-10-31T14:45:00.000Z'

let latest: DashboardDivergenceViewState | undefined

function Probe(props: Readonly<{ client: { query: (input: { asOf: string }) => Promise<MarketDivergenceResult> } }>) {
  latest = useDashboardDivergence({ client: props.client, now: () => new Date(asOf) }).state
  return null
}

const roots: Array<ReturnType<typeof createRoot>> = []
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  latest = undefined
})

async function renderProbe(client: { query: (input: { asOf: string }) => Promise<MarketDivergenceResult> }) {
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.push(root)
  await act(async () => { root.render(createElement(Probe, { client })) })
  return latest
}

describe('divergence hook first read', () => {
  it('stays loading while the query is in flight, before the card judges anything', async () => {
    let settle: ((value: MarketDivergenceResult) => void) | undefined
    const client = { query: () => new Promise<MarketDivergenceResult>((resolve) => { settle = resolve }) }
    const state = await renderProbe(client)
    // Waiting is its own state; the card may not draw "could not read" or "nothing diverged"
    // before the pairs have actually been compared.
    expect(state).toMatchObject({ state: 'loading' })
    await act(async () => { settle!({ state: 'empty', asOf, withheld: [], escalated: false }) })
    expect(latest).toMatchObject({ state: 'empty' })
  })

  it('becomes a failed read only when the query actually rejects', async () => {
    const state = await renderProbe({ query: async () => { throw new Error('ipc down') } })
    expect(state).toMatchObject({ state: 'unavailable', reason: 'query-failed' })
  })
})
