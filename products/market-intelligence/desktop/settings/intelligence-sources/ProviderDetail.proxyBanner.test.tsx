// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { ProviderDetail } from './ProviderDetail'
import type { ProviderDetailLabels } from './ProviderDetail'
import type { ProviderView } from '../../../service/intelligence/application/sourceProjection'

const settingsText = productText['zh-CN'].settings.intelligenceSources

let root: Root | null = null
globalThis.IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

function labels(): ProviderDetailLabels {
  return {
    sourceNames: {},
    providerNames: {},
    panelNames: settingsText.panelNames,
    badges: settingsText.sourceBadges,
    status: settingsText.status,
    capabilities: settingsText.providerSummary,
    credentials: settingsText.credentialsRequired,
    website: settingsText.website,
    signup: settingsText.signup,
    inviteNote: settingsText.inviteNote,
    testConnection: settingsText.testConnection,
    jobRegistered: settingsText.jobRegistered,
    jobNotRegistered: settingsText.jobNotRegistered,
    connectionSucceeded: settingsText.connectionSucceeded,
    connectionFailed: settingsText.connectionFailed,
    connectionUnsupported: settingsText.connectionUnsupported,
    apiKey: settingsText.apiKey
  }
}

function routerProvider(requiresProxy = true): ProviderView {
  return {
    providerId: '0xrouter',
    displayName: '0xRouter',
    category: 'aggregate',
    credential: 'api-key',
    sources: [{
      sourceId: '0xrouter-aggregate-provider',
      providerId: '0xrouter',
      displayName: '0xRouter aggregate market',
      agents: ['crypto'],
      panels: ['dashboard'],
      visibility: 'visible',
      collection: 'adapter',
      kind: 'feed',
      capabilities: { runNow: 'adapter', testConnection: true },
      readiness: 'live',
      requiresProxy,
      enabled: true
    }]
  }
}

function stubPlatform(connectionResult: unknown) {
  const invoke = vi.fn(async (_productId: string, method: string) => {
    if (method === 'intelligenceSources.getPageState') {
      return { detail: { credentialStatus: { hasCredential: true, maskedPreview: 'us*****Of' } } }
    }
    if (method === 'intelligenceSources.testConnection') return connectionResult
    return undefined
  })
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
  return invoke
}

async function flush(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

async function render(provider: ProviderView): Promise<void> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ProviderDetail, { labels: labels(), provider, onSelectSource: () => undefined }))
    await Promise.resolve()
  })
}

function button(text: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!match) throw new Error(`Expected a "${text}" button.`)
  return match
}

describe('ProviderDetail proxy notice', () => {
  it('explains a network-layer refusal and routes the reader to the proxy settings', async () => {
    stubPlatform({ sourceId: '0xrouter-aggregate-provider', state: 'failed', failureCode: 'response-unavailable' })
    await render(routerProvider())

    expect(document.body.querySelector('[data-network-proxy-banner]')).toBeNull()

    await act(async () => button(settingsText.testConnection).click())
    await flush()

    const banner = document.body.querySelector('[data-network-proxy-banner]')
    expect(banner).not.toBeNull()
    expect(banner?.textContent).toContain(settingsText.proxyNotice.title)

    const navigation = vi.fn()
    window.addEventListener('app-shell:navigate', navigation)
    const openSettings = document.body.querySelector<HTMLButtonElement>('[data-network-proxy-settings]')
    expect(openSettings).not.toBeNull()
    await act(async () => openSettings?.click())
    expect(navigation.mock.calls[0]?.[0].detail).toEqual({ navKey: 'settings', settingsPanelKey: 'preferences' })
    window.removeEventListener('app-shell:navigate', navigation)
  })

  it('does not send a rejected API key to the proxy settings', async () => {
    stubPlatform({ sourceId: '0xrouter-aggregate-provider', state: 'failed', failureCode: 'credential-invalid' })
    await render(routerProvider())

    await act(async () => button(settingsText.testConnection).click())
    await flush()

    expect(document.body.querySelector('[data-network-proxy-banner]')).toBeNull()
  })

  it('still tags a proxy-required source even before any test runs', async () => {
    stubPlatform({ state: 'succeeded' })
    await render(routerProvider())

    const tag = document.body.querySelector('.source-provider-detail__proxy')
    expect(tag?.textContent).toBe(settingsText.sourceBadges.proxy)
  })

  it('leaves reachable sources untagged', async () => {
    stubPlatform({ state: 'succeeded' })
    await render(routerProvider(false))

    expect(document.body.querySelector('.source-provider-detail__proxy')).toBeNull()
  })

  it('tests the provider credential from a pane that only lists calendar capabilities', async () => {
    const invoke = stubPlatform({ sourceId: '0xrouter-aggregate-provider', state: 'failed', failureCode: 'response-unavailable' })
    await render(calendarPanelProvider())

    // The three visible rows are calendar jobs, none of which owns the credential.
    expect(document.body.textContent).toContain('0xRouter 经济数据')
    await act(async () => button(settingsText.testConnection).click())
    await flush()

    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'intelligenceSources.testConnection', { sourceId: '0xrouter-aggregate-provider' })
    expect(document.body.textContent).not.toContain(settingsText.connectionUnsupported)
  })
})

function calendarPanelProvider(): ProviderView {
  const calendar = (sourceId: string, displayName: string) => ({
    sourceId,
    providerId: '0xrouter',
    displayName,
    agents: ['crypto' as const],
    panels: ['economic-calendar' as const],
    visibility: 'visible' as const,
    collection: 'job' as const,
    kind: 'market-calendar' as const,
    capabilities: { runNow: 'job' as const, testConnection: true },
    readiness: 'live' as const,
    requiresProxy: true,
    enabled: true
  })
  return {
    providerId: '0xrouter',
    displayName: '0xRouter',
    category: 'aggregate',
    credential: 'api-key',
    credentialSourceId: '0xrouter-aggregate-provider',
    sources: [
      calendar('macro-calendar-0xrouter-economic-data', '0xRouter 经济数据'),
      calendar('macro-calendar-0xrouter-financial-events', '0xRouter 财经事件'),
      calendar('macro-calendar-0xrouter-central-bank-activities', '0xRouter 央行活动')
    ]
  }
}
