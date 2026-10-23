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
import { WebSearchPolicyPage } from './WebSearchPolicyPage'
import { WebSearchSettingsPage } from './WebSearchSettingsPage'
import { resolveWebSearchProviderOption } from './webSearchAvailability'

const labels = platformText['zh-CN'].webSearch
let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function provider(id: 'tavily' | 'jina' | 'searxng' | 'fetch', overrides: Partial<SafeWebSearchProviderView> = {}): SafeWebSearchProviderView {
  const base: SafeWebSearchProviderView = {
    id,
    name: id === 'tavily' ? 'Tavily' : id === 'jina' ? 'Jina' : id === 'searxng' ? 'Searxng' : 'Fetch',
    type: 'api',
    capabilities: id === 'jina' ? [{ feature: 'searchKeywords' }, { feature: 'fetchUrls' }] : [{ feature: id === 'fetch' ? 'fetchUrls' : 'searchKeywords' }],
    enabled: true,
    apiHostByCapability: {},
    hasApiKey: id === 'tavily' || id === 'jina',
    apiKeyPreview: '',
    hasBasicAuth: false,
    defaultForCapabilities: [],
    phase: 0,
    implemented: true
  }
  return { ...base, ...overrides }
}

function settings(overrides: Partial<WebSearchSettings> = {}): WebSearchSettings {
  return {
    ...createDefaultWebSearchSettings(),
    defaultSearchProviderId: 'tavily',
    defaultFetchProviderId: 'jina',
    ...overrides
  }
}

async function mountPolicy(
  target: WebSearchSettings,
  onChange = vi.fn()
): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      createElement(WebSearchPolicyPage, {
        labels,
        settings: target,
        providers: [provider('tavily'), provider('jina'), provider('searxng', { enabled: false }), provider('fetch', { enabled: false })],
        onChange
      })
    )
  })
  return container
}

async function click(container: ParentNode, selector: string): Promise<void> {
  const element = container.querySelector(selector)
  expect(element).not.toBeNull()
  await act(async () => element?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

describe('PLAT-60 policy page', () => {
  it('renders the four prototype cards in order with no provider credentials', async () => {
    const container = await mountPolicy(settings())
    const policy = container.querySelector('[data-web-search-policy]') as HTMLElement
    const headings = [...policy.querySelectorAll('.section-heading > span')].map((item) => item.textContent)

    expect(headings).toEqual([
      labels.defaultProvidersSection,
      labels.resultsSection,
      labels.compression,
      labels.blacklist
    ])
    expect(policy.textContent).not.toContain(labels.apiKey)
    expect(policy.textContent).not.toContain(labels.enableProvider)
    expect(policy.querySelector('[data-web-search-endpoint]')).toBeNull()
  })

  it('patches max results and search-with-date through the shared settings draft', async () => {
    const onChange = vi.fn()
    const container = await mountPolicy(settings(), onChange)
    const input = container.querySelector('.ant-input-number-input') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '8')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith({ maxResults: 8 })

    await click(container, '[data-web-search-policy] [role="switch"]')
    expect(onChange).toHaveBeenCalledWith({ searchWithDate: false })
  })

  it('keeps blacklist as removable tags and submits string[]', async () => {
    const onChange = vi.fn()
    const container = await mountPolicy(settings({ excludeDomains: ['example.com'] }), onChange)
    expect(container.querySelector('[aria-label="删除 example.com"]')).not.toBeNull()

    await click(container, '[aria-label="删除 example.com"]')
    expect(onChange).toHaveBeenLastCalledWith({ excludeDomains: [] })
  })

  it('marks disabled / missing-key / deferred providers unselectable with a reason', () => {
    const current = settings({
      providerOverrides: {
        tavily: { enabled: true },
        jina: { enabled: true },
        searxng: { enabled: false },
        fetch: { enabled: true }
      }
    })

    expect(resolveWebSearchProviderOption(current, provider('tavily'), 'searchKeywords')).toEqual({
      selectable: true,
      reason: null
    })
    expect(resolveWebSearchProviderOption(current, provider('searxng', { enabled: false }), 'searchKeywords')).toEqual({
      selectable: false,
      reason: 'disabled'
    })
    expect(
      resolveWebSearchProviderOption(current, provider('tavily', { hasApiKey: false }), 'searchKeywords')
    ).toEqual({ selectable: false, reason: 'missingKey' })
    expect(
      resolveWebSearchProviderOption(current, provider('tavily', { implemented: false }), 'searchKeywords')
    ).toEqual({ selectable: false, reason: 'deferred' })
  })

  it('keeps a single save entry: header save submits the policy patch', async () => {
    let current = settings()
    const updateSettings = vi.fn(async (patch: Partial<WebSearchSettings>) => {
      current = { ...current, ...patch }
      return current
    })
    Object.assign(window, {
      platform: {
        webSearch: {
          getSettings: async () => current,
          listProviders: async () => [provider('tavily'), provider('jina')],
          updateSettings,
          updateProvider: async () => provider('tavily'),
          checkProvider: async () => ({ valid: true }),
          revealApiKey: async () => null
        },
        app: { openExternal: vi.fn() }
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(WebSearchSettingsPage, { language: 'zh-CN' })))
    await settle()

    const switchEl = container.querySelector('[data-web-search-policy] [role="switch"]') as HTMLElement
    await act(async () => switchEl.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    const saveButton = [...container.querySelectorAll('button')].find((item) =>
      (item.textContent ?? '').trim() === labels.savePolicy
    ) as HTMLButtonElement
    expect(saveButton.disabled).toBe(false)
    await act(async () => saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await settle()

    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings.mock.calls[0][0]).toMatchObject({ searchWithDate: false })
    expect(saveButton.disabled).toBe(true)
    expect(container.textContent).toContain(labels.saved)
  })
})

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

