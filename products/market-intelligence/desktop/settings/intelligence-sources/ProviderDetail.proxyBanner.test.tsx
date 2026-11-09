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
    toggleSource: settingsText.toggleSource,
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
    unavailableReasonCode: settingsText.unavailableReasonCode,
    unavailableReasonCodeAria: settingsText.unavailableReasonCodeAria,
    collectionPolicyStopped: settingsText.collectionPolicyStopped,
    automaticSyncStopped: settingsText.automaticSyncStopped,
    lastSuccessfulSync: settingsText.lastSuccessfulSync,
    apiKey: settingsText.apiKey
  }
}

function routerProvider(requiresProxy = true): ProviderView {
  return {
    providerId: '0xrouter',
    displayName: '0xRouter',
    category: 'aggregate',
    credential: 'api-key',
    healthMarker: 'none',
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
      enabled: true,
      healthState: 'healthy' as const,
      healthMarker: 'none' as const
    }]
  }
}

function stubPlatform(connectionResult: unknown, network?: { proxyMode: string; proxyUrl: string }) {
  const invoke = vi.fn(async (_productId: string, method: string) => {
    if (method === 'intelligenceSources.getPageState') {
      return { detail: { credentialStatus: { hasCredential: true, maskedPreview: 'us*****Of' } } }
    }
    if (method === 'intelligenceSources.testConnection') return connectionResult
    return undefined
  })
  ;(window as unknown as { platform: unknown }).platform = {
    products: { invoke },
    ...(network === undefined ? {} : { settings: { get: async () => ({ network }) } })
  }
  return invoke
}

const configuredProxy = { proxyMode: 'custom', proxyUrl: 'http://127.0.0.1:7888' }

async function flush(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

async function render(provider: ProviderView): Promise<void> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ProviderDetail, { labels: labels(), provider }))
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
  it('leaves the “not configured yet” case to the row tag, not to the banner', async () => {
    // 分工（2026-11-10 界面设计定）：**未配代理**由行尾那颗「需要代理」药丸承担，横幅不出现——同一件事
    // 不许两处说，未配时代理只需要一个入口。横幅只管「配了没通」（那条在下面那组用例里）。
    stubPlatform({ sourceId: '0xrouter-aggregate-provider', state: 'failed', failureCode: 'response-unavailable' })
    await render(routerProvider())

    expect(document.body.querySelector('.source-provider-detail__proxy')).not.toBeNull()
    expect(document.body.querySelector('[data-network-proxy-banner]')).toBeNull()

    // 探测被拒也还是「没配」：键按不动的原因是缺配置，不是配置没通，所以横幅仍不出现。
    await act(async () => button(settingsText.testConnection).click())
    await flush()

    expect(document.body.querySelector('.source-provider-detail__proxy')).not.toBeNull()
    expect(document.body.querySelector('[data-network-proxy-banner]')).toBeNull()
    expect(document.body.textContent).not.toContain(settingsText.proxyNotice.configuredFailedTitle)
  })

  it('does not send a rejected API key to the proxy settings', async () => {
    stubPlatform({ sourceId: '0xrouter-aggregate-provider', state: 'failed', failureCode: 'credential-invalid' })
    await render(routerProvider())

    await act(async () => button(settingsText.testConnection).click())
    await flush()

    // 代理还没配：横幅不出现（由药丸说），而且一颗被拒的 key 永远不该变成代理结论。
    expect(document.body.querySelector('[data-network-proxy-banner]')).toBeNull()
    expect(document.body.textContent).not.toContain(settingsText.proxyNotice.failedTitle)
    expect(document.body.textContent).not.toContain(settingsText.proxyNotice.configuredFailedTitle)
  })

  it('still tags a proxy-required source even before any test runs', async () => {
    stubPlatform({ state: 'succeeded' })
    await render(routerProvider())

    const tag = document.body.querySelector('.source-provider-detail__proxy')
    expect(tag?.textContent).toBe(settingsText.sourceBadges.proxy)
  })

  it('leaves reachable sources untagged and un-bannered', async () => {
    stubPlatform({ state: 'succeeded' })
    await render(routerProvider(false))

    expect(document.body.querySelector('.source-provider-detail__proxy')).toBeNull()
    expect(document.body.querySelector('[data-network-proxy-banner]')).toBeNull()
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

describe('ProviderDetail proxy notice once a proxy is configured (MI-11-R196)', () => {
  it('drops the standing requirement and the proxy tag when a custom proxy is saved', async () => {
    stubPlatform({ state: 'succeeded' }, configuredProxy)
    await render(routerProvider())
    await flush()

    expect(document.body.querySelector('[data-network-proxy-banner]')).toBeNull()
    expect(document.body.querySelector('.source-provider-detail__proxy')).toBeNull()
  })

  it('comes back as “configured but still not connected” when the probe fails anyway', async () => {
    stubPlatform({ sourceId: '0xrouter-aggregate-provider', state: 'failed', failureCode: 'response-unavailable' }, configuredProxy)
    await render(routerProvider())
    expect(document.body.querySelector('[data-network-proxy-banner]')).toBeNull()

    await act(async () => button(settingsText.testConnection).click())
    await flush()

    const banner = document.body.querySelector('[data-network-proxy-banner]')
    expect(banner?.getAttribute('data-tone')).toBe('failed')
    expect(banner?.getAttribute('data-proxy-configured')).toBe('yes')
    expect(banner?.textContent).toContain(settingsText.proxyNotice.configuredFailedTitle)
    // 不许再让他「先打开 本地代理 或本地代理」——那件事他已经做了。
    expect(banner?.textContent).not.toContain(settingsText.proxyNotice.failedTitle)
    // 横幅在页头之上：进设置去改代理的入口在同一处，不因分工变化而丢。
    const heading = document.body.querySelector('h2')
    expect(banner && heading && banner.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const navigation = vi.fn()
    window.addEventListener('app-shell:navigate', navigation)
    const openSettings = document.body.querySelector<HTMLButtonElement>('[data-network-proxy-settings]')
    expect(openSettings).not.toBeNull()
    await act(async () => openSettings?.click())
    expect(navigation.mock.calls[0]?.[0].detail).toEqual({ navKey: 'settings', settingsPanelKey: 'preferences' })
    window.removeEventListener('app-shell:navigate', navigation)
  })

  it('does not call a custom mode with an unparsable address "configured"', async () => {
    stubPlatform({ state: 'succeeded' }, { proxyMode: 'custom', proxyUrl: '127.0.0.1:7888 is my proxy' })
    await render(routerProvider())
    await flush()

    // 地址不可解析 = 还没配好：药丸说要求，横幅不出现。
    expect(document.body.querySelector('[data-network-proxy-banner]')).toBeNull()
    expect(document.body.querySelector('.source-provider-detail__proxy')).not.toBeNull()
  })

  it('treats a custom mode with an empty address as not configured yet', async () => {
    stubPlatform({ state: 'succeeded' }, { proxyMode: 'custom', proxyUrl: '   ' })
    await render(routerProvider())
    await flush()

    expect(document.body.querySelector('[data-network-proxy-banner]')).toBeNull()
    expect(document.body.querySelector('.source-provider-detail__proxy')).not.toBeNull()
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
    enabled: true,
    healthState: 'healthy' as const,
    healthMarker: 'none' as const
  })
  return {
    providerId: '0xrouter',
    displayName: '0xRouter',
    category: 'aggregate',
    credential: 'api-key',
    credentialSourceId: '0xrouter-aggregate-provider',
    healthMarker: 'none',
    sources: [
      calendar('macro-calendar-0xrouter-economic-data', '0xRouter 经济数据'),
      calendar('macro-calendar-0xrouter-financial-events', '0xRouter 财经事件'),
      calendar('macro-calendar-0xrouter-central-bank-activities', '0xRouter 央行活动')
    ]
  }
}
