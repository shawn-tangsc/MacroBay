// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { ProviderDetail, type ProviderDetailLabels } from './ProviderDetail'
import type { ProviderView, SourceView } from '../../../service/intelligence/application/sourceProjection'

/**
 * 每个已接入的源都要能测连通性（读者 2026-11-12：「我都能调用接口了，还不能测试联通性？」）。
 *
 * 判据两条：① 能力位为真的源，行上有一颗自己的「测试」按钮，点它打到**这个源**的 id；
 * ② 结果按源回写（通 / 不通），不顶掉行尾的「已应用 / 未应用」。
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
    testConnection: settingsText.testConnection,
    rowTest: settingsText.rowTest, rowTesting: settingsText.rowTesting,
    rowTestOk: settingsText.rowTestOk, rowTestFailed: settingsText.rowTestFailed,
    jobRegistered: settingsText.jobRegistered,
    jobNotRegistered: settingsText.jobNotRegistered, connectionSucceeded: settingsText.connectionSucceeded,
    connectionFailed: settingsText.connectionFailed, connectionUnsupported: settingsText.connectionUnsupported,
    apiKey: settingsText.apiKey, unavailableReasonCode: settingsText.unavailableReasonCode,
    unavailableReasonCodeAria: settingsText.unavailableReasonCodeAria,
    automaticSyncStopped: settingsText.automaticSyncStopped, lastSuccessfulSync: settingsText.lastSuccessfulSync,
    health: settingsText.health
  }
}

function provider(testConnection: boolean): ProviderView {
  const source: SourceView = {
    sourceId: 'sec-rss', providerId: 'sec', displayName: 'SEC feed', agents: ['crypto'], panels: ['dashboard'],
    visibility: 'visible', collection: 'adapter', kind: 'feed',
    capabilities: { runNow: 'adapter', testConnection },
    readiness: 'live', enabled: true, healthState: 'healthy', healthMarker: 'none'
  }
  return { providerId: 'sec', displayName: 'SEC', category: 'macro', credential: 'none', healthMarker: 'none', sources: [source] }
}

async function render(view: ProviderView, connectionResult: unknown): Promise<HTMLElement> {
  const invoke = vi.fn(async () => connectionResult)
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ProviderDetail, { labels: labels(), provider: view, showSourceDetails: true }))
    await Promise.resolve()
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return container
}

const rowTestButton = (host: HTMLElement): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>('.source-provider-detail__row-test')

const invokeOf = (): ReturnType<typeof vi.fn> =>
  (window as unknown as { platform: { products: { invoke: ReturnType<typeof vi.fn> } } }).platform.products.invoke

describe('每一行源自己的连通性测试', () => {
  it('offers a per-source test button only when the source can be called', async () => {
    const withProbe = await render(provider(true), { ok: true })
    expect(rowTestButton(withProbe)?.textContent).toBe(settingsText.rowTest)
    await act(async () => root?.unmount()); document.body.replaceChildren()

    const withoutProbe = await render(provider(false), { ok: true })
    expect(rowTestButton(withoutProbe)).toBeNull()
  })

  it('tests the row it belongs to and reports reachable', async () => {
    const host = await render(provider(true), { ok: true })
    await act(async () => { rowTestButton(host)?.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    expect(invokeOf()).toHaveBeenCalledWith('market-intelligence', 'intelligenceSources.testConnection', { sourceId: 'sec-rss' })
    expect(host.textContent).toContain(settingsText.rowTestOk)
    // 行尾的启用状态还在，测试结果不顶掉它。
    expect(host.querySelector('.source-provider-detail__row-state')?.textContent).toBe(settingsText.status.applied)
  })

  it('reports unreachable without blaming the credential', async () => {
    const host = await render(provider(true), { state: 'failed', failureCode: 'response-unavailable' })
    await act(async () => { rowTestButton(host)?.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    expect(host.textContent).toContain(settingsText.rowTestFailed)
  })
})
