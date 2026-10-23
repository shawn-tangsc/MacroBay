// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useMarketCalendarFeed, type MarketCalendarFeedState } from './useMarketCalendarFeed'

let root: Root | undefined
globalThis.IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function Harness({ client, locale, onState }: {
  client: { refresh: (input: { month: string; locale: 'zh' | 'en' }) => Promise<unknown> }
  locale?: 'zh' | 'en'
  onState: (state: MarketCalendarFeedState) => void
}): null {
  const state = useMarketCalendarFeed(client, locale)
  onState(state)
  return null
}

async function render(
  client: { refresh: (input: { month: string; locale: 'zh' | 'en' }) => Promise<unknown> },
  locale?: 'zh' | 'en'
): Promise<{ current: () => MarketCalendarFeedState }> {
  let latest: MarketCalendarFeedState | undefined
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root?.render(<Harness client={client} locale={locale} onState={(state) => { latest = state }} />))
  return { current: () => latest! }
}

describe('useMarketCalendarFeed', () => {
  it('refreshes the current month and reports success', async () => {
    const client = { refresh: vi.fn(async () => ({ state: 'completed' })) }
    const state = await render(client, 'zh')
    await act(async () => { await state.current().refresh() })
    expect(client.refresh).toHaveBeenCalledWith({ month: expect.stringMatching(/^\d{4}-\d{2}$/), locale: 'zh' })
    expect(state.current().feedback).toBe('succeeded')
    expect(state.current().refreshing).toBe(false)
  })

  it('reports a failed refresh without throwing', async () => {
    const client = { refresh: vi.fn(async () => ({ state: 'unavailable' })) }
    const state = await render(client)
    await act(async () => { await state.current().refresh() })
    expect(state.current().feedback).toBe('failed')
  })

  it('ignores a second refresh while the first one is still running', async () => {
    let resolve: (value: unknown) => void = () => undefined
    const client = { refresh: vi.fn(() => new Promise((done) => { resolve = done })) }
    const state = await render(client)
    let first: Promise<void> | undefined
    await act(async () => {
      first = state.current().refresh()
      await state.current().refresh()
    })
    expect(client.refresh).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolve({ state: 'completed' })
      await first
    })
    expect(state.current().feedback).toBe('succeeded')
  })
})
