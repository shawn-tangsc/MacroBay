// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  SafeWebSearchProviderView,
  WebSearchSettings
} from '@platform/ai/web-search/contracts/webSearchContracts'
import { createDefaultWebSearchSettings } from '@platform/ai/web-search/contracts/webSearchSettings'

import { platformText } from '../../../i18n/platformText'
import { WebSearchSettingsPage } from './WebSearchSettingsPage'

/**
 * PLAT-60 · IA 重构验收（RED 先行）。
 * 两个维度拆开：策略（全局行为）/ 供应商（连接与凭据），供应商配置走抽屉。
 */

const labels = platformText['zh-CN'].webSearch
let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function providers(): SafeWebSearchProviderView[] {
  return [
    {
      id: 'tavily',
      name: 'Tavily',
      type: 'api',
      capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.tavily.com' }],
      enabled: true,
      apiHostByCapability: { searchKeywords: 'https://api.tavily.com' },
      hasApiKey: true,
      apiKeyPreview: 'tvly**********7890',
      hasBasicAuth: false,
      defaultForCapabilities: ['searchKeywords'],
      phase: 0,
      implemented: true
    },
    {
      id: 'jina',
      name: 'Jina',
      type: 'api',
      capabilities: [
        { feature: 'searchKeywords', apiHost: 'https://s.jina.ai' },
        { feature: 'fetchUrls', apiHost: 'https://r.jina.ai' }
      ],
      enabled: true,
      apiHostByCapability: { searchKeywords: 'https://s.jina.ai', fetchUrls: 'https://r.jina.ai' },
      hasApiKey: true,
      apiKeyPreview: 'jina**********3fJG',
      apiKeyLength: 65,
      hasBasicAuth: false,
      defaultForCapabilities: ['fetchUrls'],
      phase: 0,
      implemented: true
    },
    {
      id: 'searxng',
      name: 'Searxng',
      type: 'api',
      capabilities: [{ feature: 'searchKeywords', apiHost: 'http://localhost:8080' }],
      enabled: false,
      apiHostByCapability: { searchKeywords: 'http://localhost:8080' },
      hasApiKey: false,
      apiKeyPreview: '',
      hasBasicAuth: false,
      defaultForCapabilities: [],
      phase: 0,
      implemented: true
    },
    {
      id: 'fetch',
      name: 'Fetch',
      type: 'api',
      capabilities: [{ feature: 'fetchUrls' }],
      enabled: false,
      apiHostByCapability: {},
      hasApiKey: false,
      apiKeyPreview: '',
      hasBasicAuth: false,
      defaultForCapabilities: [],
      phase: 0,
      implemented: true
    },
    {
      id: 'exa',
      name: 'Exa',
      type: 'api',
      capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.exa.ai' }],
      enabled: false,
      apiHostByCapability: { searchKeywords: 'https://api.exa.ai' },
      hasApiKey: false,
      apiKeyPreview: '',
      hasBasicAuth: false,
      defaultForCapabilities: [],
      phase: 1,
      implemented: false
    }
  ]
}

function settings(): WebSearchSettings {
  return {
    ...createDefaultWebSearchSettings(),
    defaultSearchProviderId: 'tavily',
    defaultFetchProviderId: 'jina',
    providerOverrides: {
      tavily: { enabled: true },
      jina: { enabled: true },
      searxng: { enabled: false },
      fetch: { enabled: false }
    }
  }
}

function stubPlatform(): void {
  const currentSettings = settings()
  const currentProviders = providers()
  Object.assign(window, {
    platform: {
      webSearch: {
        getSettings: async () => currentSettings,
        listProviders: async () => currentProviders,
        updateSettings: async (patch: unknown) => ({ ...currentSettings, ...(patch as object) }),
        updateProvider: async (input: { providerId: string }) =>
          currentProviders.find((provider) => provider.id === input.providerId) ?? currentProviders[0],
        checkProvider: async () => ({ valid: true }),
        revealApiKey: async () => 'jina-secret-key'
      },
      app: { openExternal: vi.fn() }
    }
  })
}

async function settle(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function mountPage(language: 'zh-CN' | 'en-US' = 'zh-CN'): Promise<HTMLElement> {
  stubPlatform()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(createElement(WebSearchSettingsPage, { language })))
  await settle()
  return container
}

async function click(container: ParentNode, selector: string): Promise<void> {
  const element = container.querySelector(selector)
  expect(element).not.toBeNull()
  await act(async () => element?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await settle()
}

async function openProvidersTab(): Promise<HTMLElement> {
  const container = await mountPage()
  await click(container, '[data-web-search-tab="providers"]')
  return container
}

describe('PLAT-60 two-dimension web search settings', () => {
  it('① 左栏导航已不存在，存在两个二级 Tab', async () => {
    const container = await mountPage()

    expect(container.querySelector('.web-search-provider-rail')).toBeNull()
    const tabs = [...container.querySelectorAll('.web-search-settings-tabs [role="tab"]')]
    expect(tabs.map((tab) => tab.textContent)).toEqual([labels.policyTab, labels.providersTab])
    expect(container.querySelector('[data-web-search-tab="policy"]')?.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('[data-web-search-tab="providers"]')?.getAttribute('aria-selected')).toBe('false')
  })

  it('② 策略页没有任何 API Key / 端点 / 启用开关控件', async () => {
    const container = await mountPage()
    const policy = container.querySelector('[data-web-search-policy]')

    expect(policy).not.toBeNull()
    expect(policy?.textContent).not.toContain(labels.apiKey)
    expect(policy?.textContent).not.toContain(labels.apiHost)
    expect(policy?.textContent).not.toContain(labels.enableProvider)
    expect(policy?.querySelector('.web-search-api-key-control')).toBeNull()
    expect(policy?.querySelector('[data-web-search-endpoint]')).toBeNull()
    expect(policy?.querySelector('[data-web-search-provider-enable]')).toBeNull()
  })

  it('③ 供应商表每个 provider 只有一行，Jina 能力写在一行里', async () => {
    const container = await openProvidersTab()
    const rows = [...container.querySelectorAll('[data-web-search-provider-row]')]

    expect(rows).toHaveLength(4)
    const jinaRows = rows.filter((row) => (row.textContent ?? '').startsWith('Jina'))
    expect(jinaRows).toHaveLength(1)
    expect(jinaRows[0].textContent).toContain(
      `${labels.capabilitySearchShort}${labels.capabilityJoin}${labels.capabilityFetchShort}`
    )
  })

  it('④ 默认列只读：表格内没有 select，也没有「设为默认能力」', async () => {
    const container = await openProvidersTab()
    const table = container.querySelector('[data-web-search-provider-table]')

    expect(table).not.toBeNull()
    expect(table?.querySelector('select')).toBeNull()
    expect(table?.querySelector('.ant-select')).toBeNull()
    expect(table?.textContent).not.toContain(labels.defaultCapabilities)
    expect(table?.textContent).toContain(labels.defaultSearchBadge)
    expect(table?.textContent).toContain(labels.defaultFetchBadge)
    expect(table?.querySelector('[data-web-search-default-cell]')).not.toBeNull()
  })

  it('⑤ 默认下拉里未启用的供应商置灰、注明原因且不可选', async () => {
    const container = await mountPage()
    const wrapper = container.querySelector('[data-web-search-default-select="searchKeywords"]')
    expect(wrapper).not.toBeNull()

    const selector = wrapper?.querySelector('.ant-select-selector')
    await act(async () => selector?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    await settle()

    const disabledOptions = [...document.querySelectorAll('.ant-select-item-option-disabled')]
    const searxng = disabledOptions.find((option) => (option.textContent ?? '').includes('Searxng'))
    expect(searxng).not.toBeUndefined()
    expect(searxng?.textContent).toContain(labels.disabled)
    const enabledOption = [...document.querySelectorAll('.ant-select-item-option')].find((option) =>
      (option.textContent ?? '').includes('Tavily')
    )
    expect(enabledOption?.className).not.toContain('ant-select-item-option-disabled')
  })

  it('⑥ 抽屉内没有压缩 / 黑名单 / 最大结果数 / 默认能力控件', async () => {
    const container = await openProvidersTab()
    await click(container, '[data-web-search-configure="jina"]')

    const drawer = document.querySelector('.web-search-provider-drawer')
    expect(drawer).not.toBeNull()
    const text = drawer?.textContent ?? ''
    expect(text).toContain(`${labels.drawerTitle('Jina')}`)
    expect(text).toContain(labels.enableProvider)
    expect(text).toContain(labels.apiKey)
    expect(text).toContain(labels.drawerDefaultHint)
    expect(text).not.toContain(labels.compression)
    expect(text).not.toContain(labels.blacklist)
    expect(text).not.toContain(labels.maxResults)
    expect(text).not.toContain(labels.defaultCapabilities)
    expect(drawer?.querySelector('[data-web-search-default-select]')).toBeNull()
  })
})
