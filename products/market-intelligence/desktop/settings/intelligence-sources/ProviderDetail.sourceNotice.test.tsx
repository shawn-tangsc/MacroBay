// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { ProviderDetail, type ProviderDetailLabels } from './ProviderDetail'
import type { ProviderView } from '../../../service/intelligence/application/sourceProjection'

/**
 * 源详情页头上方的**说明横幅**（界面设计 2026-11-12 签字）：代理提示与「私有数据源」共用同一件
 * `NoticeBanner`（antd warning Alert）；说明横幅在上、代理横幅在下，都在页头卡之前。
 *
 * 数据驱动：这里只给 `notice` 标记，组件不该知道「0xrouter」这个名字。
 */
const settingsText = productText['zh-CN'].settings.intelligenceSources
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
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

function provider(notice?: 'private-data-source'): ProviderView {
  return {
    providerId: 'p', displayName: 'P', category: 'macro', credential: 'none', healthMarker: 'none',
    ...(notice === undefined ? {} : { notice }),
    sources: [{
      sourceId: 'p-source', providerId: 'p', displayName: 'P source', agents: [], panels: ['dashboard'],
      visibility: 'visible', collection: 'adapter', kind: 'feed', capabilities: { runNow: 'adapter', testConnection: true }, readiness: 'live',
      enabled: true, healthState: 'healthy', healthMarker: 'none'
    }]
  }
}

async function render(view: ProviderView): Promise<HTMLElement> {
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke: vi.fn(async () => undefined) } }
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ProviderDetail, {
      labels: labels(),
      provider: view,
      showSourceDetails: false
    }))
    await Promise.resolve()
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return host
}

describe('源详情页头的说明横幅', () => {
  it('renders the private-data-source sentence above the header card', async () => {
    const host = await render(provider('private-data-source'))
    const banner = host.querySelector<HTMLElement>('[data-source-notice="private-data-source"]')
    expect(banner).not.toBeNull()
    expect(banner?.textContent).toContain(settingsText.providerNotices.privateDataSource)
    // 在页头卡之前，且用的是共享横幅（antd Alert），不是自绘块。
    const header = host.querySelector('.source-provider-detail__header')
    expect(banner!.compareDocumentPosition(header!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(banner?.querySelector('.ant-alert')).not.toBeNull()
  })

  it('renders no banner for a source without the marker', async () => {
    const host = await render(provider())
    expect(host.querySelector('.mi-source-notice-banner')).toBeNull()
  })
})
