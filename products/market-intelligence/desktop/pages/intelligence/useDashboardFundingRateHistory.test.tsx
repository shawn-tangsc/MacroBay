// @vitest-environment happy-dom
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import type { DashboardFundingRateHistoryState } from './dashboardFundingRateHistoryModel'
import { useDashboardFundingRateHistory } from './useDashboardFundingRateHistory'

const asOf = '2026-10-31T14:45:00.000Z'

let latest: DashboardFundingRateHistoryState | undefined

function Probe(props: Readonly<{ client: { query: (input: { asOf: string }) => Promise<unknown> } }>) {
  latest = useDashboardFundingRateHistory({ client: props.client, now: () => new Date(asOf) })
  return null
}

const roots: Array<ReturnType<typeof createRoot>> = []
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  latest = undefined
})

async function renderProbe(client: { query: (input: { asOf: string }) => Promise<unknown> }) {
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.push(root)
  await act(async () => { root.render(createElement(Probe, { client })) })
  return latest
}

describe('funding rate hook first read', () => {
  it('stays loading while the read is in flight, before the card says the rate is unavailable', async () => {
    let settle: ((value: unknown) => void) | undefined
    const client = { query: () => new Promise<unknown>((resolve) => { settle = resolve }) }
    const state = await renderProbe(client)
    // The card draws the funding half of the same panel as the positioning half, so a first
    // paint that already claims "no rate" would flash a failure next to a card still waiting.
    expect(state).toMatchObject({ state: 'loading' })
    await act(async () => { settle!({ state: 'empty', asOf }) })
    expect(latest).toMatchObject({ state: 'empty' })
  })

  it('becomes unavailable only when the read actually rejects', async () => {
    const state = await renderProbe({ query: async () => { throw new Error('ipc down') } })
    expect(state).toMatchObject({ state: 'unavailable' })
  })
})
