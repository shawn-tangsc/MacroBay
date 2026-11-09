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
  it('shows no banner before a proxy is configured, and only then sharpens it to a failed probe', async () => {
    // 分工（界面设计 2026-11-10）：横幅只管「配了没通」，药丸只管「还没配」。
    // 未配代理时那件事只需要一个入口，所以横幅不出现，行内药丸承担。
    stubPlatform({ sourceId: '0xrouter-aggregate-provider', state: 'failed', failureCode: 'response-unavailable' })
    await render(routerProvider())
    await flush()

    expect(document.body.querySelector('[data-network-proxy-banner]')).toBeNull()
    expect(document.body.querySelector('.source-provider-detail__proxy')?.textContent).toBe(settingsText.sourceBadges.proxy)

    // 配好代理、探测被拒：这时才轮到横幅说「配了没通」。
    await act(async () => root?.unmount())
    document.body.replaceChildren()
    stubPlatform({ sourceId: '0xrouter-aggregate-provider', state: 'failed', failureCode: 'response-unavailable' }, configuredProxy)
    await render(routerProvider())
    await flush()
    // 探测被拒这一步要真发生：横幅只说「配了没通」，不能凭渲染就断言。
    await act(async () => button(settingsText.testConnection).click())
    await flush()
    const banner = document.body.querySelector('[data-network-proxy-banner]')
    expect(banner?.getAttribute('data-tone')).toBe('failed')
    expect(banner?.textContent).toContain(settingsText.proxyNotice.configuredFailedTitle)
  })

  it('does not send a rejected API key to the proxy settings', async () => {
    stubPlatform({ sourceId: '0xrouter-aggregate-provider', state: 'failed', failureCode: 'credential-invalid' })
    await render(routerProvider())

    await act(async () => button(settingsText.testConnection).click())
    await flush()

    // 未配代理时横幅根本不出现（那是药丸的事）；被拒的密钥也不会变成「配了没通」的判定。
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
  })

  it('does not call a custom mode with an unparsable address "configured"', async () => {
    stubPlatform({ state: 'succeeded' }, { proxyMode: 'custom', proxyUrl: '127.0.0.1:7888 is my proxy' })
    await render(routerProvider())
    await flush()

    // 地址不可解析＝没配：只有药丸，没有「配了没通」的横幅。
    expect(document.body.querySelector('[data-network-proxy-banner]')).toBeNull()
    expect(document.body.querySelector('.source-provider-detail__proxy')?.textContent).toBe(settingsText.sourceBadges.proxy)
  })

  it('treats a custom mode with an empty address as not configured yet', async () => {
    stubPlatform({ state: 'succeeded' }, { proxyMode: 'custom', proxyUrl: '   ' })
    await render(routerProvider())
    await flush()

    expect(document.body.querySelector('[data-network-proxy-banner]')).toBeNull()
    expect(document.body.querySelector('.source-provider-detail__proxy')?.textContent).toBe(settingsText.sourceBadges.proxy)
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
