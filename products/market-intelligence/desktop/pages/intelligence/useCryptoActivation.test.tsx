// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockGetAgentView } = vi.hoisted(() => ({ mockGetAgentView: vi.fn() }))

vi.mock('../../shared/ipc/intelligenceSourcesClient', () => ({
  intelligenceSourcesClient: { getAgentView: mockGetAgentView }
}))

import { useCryptoActivation } from './useCryptoActivation'
import { notifySettingsRevision } from '../../shared/events/settingsRevision'

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  mockGetAgentView.mockReset()
})

/** One provider with one dashboard source, which is all the count needs. */
const answeredView = {
  groups: [{
    groupId: 'spot-momentum',
    tier: 'required',
    sources: [{
      sourceId: 'coingecko-market',
      providerId: 'coingecko',
      displayName: 'CoinGecko',
      enabled: true,
      visibility: 'visible',
      readiness: 'live',
      panels: ['dashboard']
    }]
  }]
}

/** One more provider than `answeredView`, so a re-read shows up as a changed count. */
const widenedView = {
  groups: [
    answeredView.groups[0]!,
    {
      groupId: 'derivatives',
      tier: 'required',
      sources: [{
        sourceId: 'binance-futures',
        providerId: 'binance',
        displayName: 'Binance',
        enabled: true,
        visibility: 'visible',
        readiness: 'live',
        panels: ['dashboard']
      }]
    }
  ]
}

describe('useCryptoActivation', () => {
  it('carries a failed read as unavailable instead of an empty setup', async () => {
    mockGetAgentView.mockRejectedValue(new Error('bridge missing'))
    const page = await renderHook()
    await flush()
    expect(page.status()).toBe('unavailable')
  })

  it('treats an undefined view as a failed read, not as zero sources', async () => {
    mockGetAgentView.mockResolvedValue(undefined)
    const page = await renderHook()
    await flush()
    expect(page.status()).toBe('unavailable')
  })

  it('reports an answered empty view as ready, so the card can say "not configured"', async () => {
    mockGetAgentView.mockResolvedValue({ groups: [] })
    const page = await renderHook()
    await flush()
    expect(page.status()).toBe('ready')
    expect(page.counts()).toEqual({ enabled: '0', total: '0' })
  })

  it('retries by asking again, and a recovered read replaces the failed state', async () => {
    mockGetAgentView
      .mockRejectedValueOnce(new Error('request failed'))
      .mockResolvedValueOnce(answeredView)
    const page = await renderHook()
    await flush()
    expect(page.status()).toBe('unavailable')

    await act(async () => { page.retry() })
    await flush()

    expect(mockGetAgentView).toHaveBeenCalledTimes(2)
    expect(page.status()).toBe('ready')
    expect(page.counts()).toEqual({ enabled: '1', total: '1' })
  })

  it('re-reads the agent view when another surface revises the sources domain', async () => {
    mockGetAgentView.mockResolvedValueOnce(answeredView).mockResolvedValue(widenedView)
    const page = await renderHook()
    await flush()
    expect(page.counts()).toEqual({ enabled: '1', total: '1' })

    await act(async () => { notifySettingsRevision('sources', 'config-drawer') })
    await flush()

    expect(mockGetAgentView).toHaveBeenCalledTimes(2)
    expect(page.counts()).toEqual({ enabled: '2', total: '2' })
  })

  it('keeps the last reading on screen while the re-read is in flight', async () => {
    const pending: Array<(view: unknown) => void> = []
    mockGetAgentView
      .mockResolvedValueOnce(answeredView)
      .mockImplementationOnce(() => new Promise((resolve) => { pending.push(resolve) }))
    const page = await renderHook()
    await flush()
    expect(page.counts()).toEqual({ enabled: '1', total: '1' })

    await act(async () => { notifySettingsRevision('sources', 'config-drawer') })
    // A background toggle must not blank the card: the old reading stays until the new one lands.
    expect(page.status()).toBe('ready')
    expect(page.counts()).toEqual({ enabled: '1', total: '1' })

    await act(async () => { pending[0]!(widenedView) })
    await flush()

    expect(page.counts()).toEqual({ enabled: '2', total: '2' })
  })
})

async function renderHook() {
  const container = document.createElement('div')
  document.body.append(container)
  const localRoot = createRoot(container)
  root = localRoot
  await act(async () => localRoot.render(createElement(Harness)))
  return {
    retry: () => { container.querySelector<HTMLButtonElement>('[data-retry]')!.click() },
    status: () => container.querySelector('output')!.dataset.status,
    counts: () => {
      const output = container.querySelector('output')!
      return { enabled: output.dataset.enabled, total: output.dataset.total }
    }
  }
}

function Harness() {
  const { activation, retry } = useCryptoActivation()
  return createElement('div', null,
    createElement('output', {
      'data-status': activation.status,
      'data-enabled': activation.status === 'ready' ? String(activation.enabledSourceCount) : undefined,
      'data-total': activation.status === 'ready' ? String(activation.totalSourceCount) : undefined
    }),
    createElement('button', { 'data-retry': true, onClick: retry, type: 'button' }, 'retry'))
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
