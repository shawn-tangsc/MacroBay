// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { ProviderDetail, type ProviderDetailLabels } from './ProviderDetail'
import type { ProviderView, SourceView } from '../../../service/intelligence/application/sourceProjection'

/**
 * 源名旁那一排行内动作（界面设计 2026-11-13）：
 *
 * - **顺序固定**：官网 → 测试连接 → 注册 / 获取 Key；组开关永远在行尾；
 * - **官网只按数据藏**：`website` 为空才不画。不再因为「需要密钥」或「带邀请参数」隐藏——
 *   那条旧规则让 api-key 源（CryptoETF、FRED 等）根本没有官网，读者找不到它是什么站；
 * - **按地址去重**：`website === signupUrl` 时只画「注册 / 获取 Key」，同一页不摆两颗按钮。
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

function provider(overrides: Partial<ProviderView> = {}): ProviderView {
  return {
    providerId: 'cryptoetf',
    displayName: 'CryptoETF',
    category: 'crypto',
    credential: 'api-key',
    credentialSourceId: 'cryptoetf-etf-flows',
    healthMarker: 'none',
    sources: [source()],
    ...overrides
  }
}

async function render(target: ProviderView): Promise<HTMLElement> {
  ;(window as unknown as { platform: unknown }).platform = {
    products: { invoke: vi.fn(async () => ({ detail: { credentialStatus: { hasCredential: true } } })) }
  }
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(ProviderDetail, { labels: labels(), provider: target, showSourceDetails: true }))
    await Promise.resolve()
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return container
}

/**
 * 源名旁那一组动作的**文字序列**（不含开关：开关是行尾那颗 Switch，不是按钮）。
 *
 * antd 会在两个汉字之间插一个空格（「官 网」），这里把它抹掉——量的是按钮的字与顺序，
 * 不是 antd 的排版细节；「注册 / 获取 Key」里的空格保留。
 */
function actionLabels(dom: HTMLElement): string[] {
  return [...dom.querySelectorAll<HTMLElement>('.source-provider-detail__name-actions button')]
    .map((button) => (button.textContent ?? '').trim().replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1'))
}

describe('源名旁的动作：官网 / 测试连接 / 注册', () => {
  it('shows all three for CryptoETF, in the fixed order, with the switch last', async () => {
    const dom = await render(provider({ website: 'https://cryptoetf.today/', signupUrl: 'https://cryptoetf.today/en/dashboard' }))
    expect(actionLabels(dom)).toEqual([
      settingsText.website,
      settingsText.testConnection,
      settingsText.signup
    ])
    // 开关仍在行尾：动作组之后。
    const row = dom.querySelector<HTMLElement>('.source-provider-detail__title-row')!
    const actions = row.querySelector('.source-provider-detail__name-actions')!
    const toggle = row.querySelector('.source-provider-detail__group-toggle')!
    expect(actions.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('no longer hides the website just because the source needs a key', async () => {
    // FRED 这类 api-key 源：有官网、没有注册入口——旧规则会把官网藏掉，现在照画。
    const dom = await render(provider({
      providerId: 'fred', displayName: 'FRED', category: 'macro',
      website: 'https://fred.stlouisfed.org/', signupUrl: undefined, credentialSourceId: 'fred-rates-liquidity'
    }))
    expect(actionLabels(dom)).toEqual([settingsText.website, settingsText.testConnection])
  })

  it('hides the website when there is no address at all', async () => {
    const dom = await render(provider({ website: undefined, signupUrl: 'https://cryptoetf.today/en/dashboard' }))
    expect(actionLabels(dom)).toEqual([settingsText.testConnection, settingsText.signup])
  })

  it('draws one button when the website and the signup page are the same address', async () => {
    const dom = await render(provider({ website: 'https://cryptoetf.today/en/dashboard', signupUrl: 'https://cryptoetf.today/en/dashboard' }))
    // 同一页不摆两颗：留下的是「注册 / 获取 Key」，不是官网。
    expect(actionLabels(dom)).toEqual([settingsText.testConnection, settingsText.signup])
  })
})
