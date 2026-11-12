// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { ProviderDetail, type ProviderDetailLabels } from './ProviderDetail'
import type { ProviderView, SourceView } from '../../../service/intelligence/application/sourceProjection'

/**
 * 连接四态那一行（产品 §3.7）：**常显**在密钥块里，由注册表的 provider `notice` 一个标记决定
 * 出现与否——组件里不按 providerId 特判，其他 provider 的界面零变化。
 *
 * 这一份只钉「出现条件」与四种字里的前两种（后两种与失败原因由 `connectionFailureSentence.test.ts`
 * 按码逐句钉住）：未配置 / 已保存待验证。刷新或重启后一律回到「已保存待验证」——不写「上次验证于」。
 */
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
    sourceNames: {}, providerNames: {}, panelNames: settingsText.panelNames, badges: settingsText.sourceBadges,
    status: settingsText.status, toggleSource: settingsText.toggleSource,
    credentials: settingsText.credentialsRequired, website: settingsText.website, signup: settingsText.signup,
    testConnection: settingsText.testConnection, jobRegistered: settingsText.jobRegistered,
    jobNotRegistered: settingsText.jobNotRegistered, connectionSucceeded: settingsText.connectionSucceeded,
    connectionFailed: settingsText.connectionFailed, connectionUnsupported: settingsText.connectionUnsupported,
    apiKey: settingsText.apiKey, unavailableReasonCode: settingsText.unavailableReasonCode,
    unavailableReasonCodeAria: settingsText.unavailableReasonCodeAria,
    automaticSyncStopped: settingsText.automaticSyncStopped, lastSuccessfulSync: settingsText.lastSuccessfulSync,
    health: settingsText.health
  }
}

function source(): SourceView {
  return {
    sourceId: 'cryptoetf-etf-flows', providerId: 'cryptoetf', displayName: 'CryptoETF ETF flows',
    agents: [], panels: [], visibility: 'visible', collection: 'none', kind: 'feed',
    capabilities: { runNow: 'none', testConnection: true }, readiness: 'live',
    enabled: false, healthState: 'off', healthMarker: 'none'
  }
}

function provider(notice?: ProviderView['notice']): ProviderView {
  return {
    providerId: 'cryptoetf',
    displayName: 'CryptoETF',
    category: 'crypto',
    credential: 'api-key',
    credentialSourceId: 'cryptoetf-etf-flows',
    ...(notice === undefined ? {} : { notice }),
    healthMarker: 'none',
    sources: [source()]
  }
}

async function render(input: Readonly<{ notice?: ProviderView['notice']; hasCredential: boolean }>): Promise<HTMLElement> {
  const invoke = vi.fn(async (_productId: string, method: string) => {
    if (method === 'intelligenceSources.getPageState') {
      return { definitions: [], sourceHealthById: {}, detail: { credentialStatus: { hasCredential: input.hasCredential } } }
    }
    return undefined
  })
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }

  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(ProviderDetail, {
      labels: labels(),
      provider: provider(input.notice),
      showSourceDetails: true
    }))
    await Promise.resolve()
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return container
}

describe('连接四态那一行：只有声明了 verification-only 的 provider 才有', () => {
  it('says 还没有配置 API Key while no key is stored', async () => {
    const dom = await render({ notice: 'verification-only', hasCredential: false })
    expect(dom.textContent).toContain('还没有配置 API Key')
    expect(dom.textContent).not.toContain('已保存，还没验证过')
  })

  it('goes back to 已保存待验证 once a key is stored — and never claims a verification time', async () => {
    const dom = await render({ notice: 'verification-only', hasCredential: true })
    expect(dom.textContent).toContain('已保存，还没验证过；点「测试连接」')
    expect(dom.textContent).not.toMatch(/上次验证|验证于/)
  })

  it('draws nothing for a provider that does not declare the marker', async () => {
    const dom = await render({ hasCredential: true })
    expect(dom.textContent).not.toContain('已保存，还没验证过')
    expect(dom.textContent).not.toContain('还没有配置 API Key')
  })
})
