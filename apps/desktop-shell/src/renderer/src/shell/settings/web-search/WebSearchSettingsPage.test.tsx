// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfigProvider } from 'antd'

import type {
  SafeWebSearchProviderView,
  WebSearchSettings
} from '@platform/ai/web-search/contracts/webSearchContracts'
import { createDefaultWebSearchSettings } from '@platform/ai/web-search/contracts/webSearchSettings'
import { WINDOW_ANTD_BUTTON_CONFIG } from '@platform/ui/theme/windowAntdTheme'

import { platformText } from '../../../i18n/platformText'
import { WebSearchSettingsPage } from './WebSearchSettingsPage'

const labels = platformText['zh-CN'].webSearch
let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function provider(id: 'tavily' | 'jina' | 'searxng' | 'fetch' | 'exa', enabled = true): SafeWebSearchProviderView {
  const implemented = id !== 'exa'
  const capabilities: SafeWebSearchProviderView['capabilities'] =
    id === 'jina'
      ? [{ feature: 'searchKeywords' }, { feature: 'fetchUrls' }]
      : [{ feature: id === 'fetch' ? 'fetchUrls' : 'searchKeywords' }]
  return {
    id,
    name: id === 'tavily' ? 'Tavily' : id === 'jina' ? 'Jina' : id === 'searxng' ? 'Searxng' : id === 'fetch' ? 'Fetch' : 'Exa',
    type: 'api',
    capabilities,
    enabled,
    apiHostByCapability: {},
    hasApiKey: id === 'tavily' || id === 'jina',
    apiKeyPreview: '',
    apiKeyLength: id === 'jina' ? 65 : undefined,
    hasBasicAuth: false,
    defaultForCapabilities: [],
    phase: implemented ? 0 : 1,
    implemented
  }
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

function providers(): SafeWebSearchProviderView[] {
  return [provider('tavily'), provider('jina'), provider('searxng', false), provider('fetch', false), provider('exa', false)]
}

async function mountPage(): Promise<{ container: HTMLElement; updateSettings: ReturnType<typeof vi.fn> }> {
  const updateSettings = vi.fn(async (patch: Partial<WebSearchSettings>) => ({ ...settings(), ...patch }))
  Object.assign(window, {
    platform: {
      webSearch: {
        getSettings: async () => settings(),
        listProviders: async () => providers(),
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
  // 页面在真机上永远在 AppShell 的 ConfigProvider 之下；这里补上同一份按钮配置，
  // 否则测试按 antd 默认在汉字之间插空格，看到的文案与真机不是一回事。
  await act(async () => root?.render(createElement(ConfigProvider, { button: WINDOW_ANTD_BUTTON_CONFIG },
    createElement(WebSearchSettingsPage, { language: 'zh-CN' }))))
  await settle()
  return { container, updateSettings }
}

async function click(container: ParentNode, selector: string): Promise<void> {
  const element = container.querySelector(selector)
  expect(element).not.toBeNull()
  await act(async () => element?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await settle()
}

describe('PLAT-60 settings page shell', () => {
  it('shows a load failure as an error with a retry, and keeps the raw message off screen', async () => {
    const raw = 'ENOENT: no such file or directory, open settings.json'
    const getSettings = vi.fn()
      .mockRejectedValueOnce(new Error(raw))
      .mockResolvedValue(settings())
    Object.assign(window, {
      platform: {
        webSearch: {
          getSettings,
          listProviders: async () => providers(),
          updateSettings: async () => settings(),
          updateProvider: async () => provider('tavily'),
          checkProvider: async () => ({ valid: true }),
          revealApiKey: async () => null
        },
        app: { openExternal: vi.fn() }
      }
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(ConfigProvider, { button: WINDOW_ANTD_BUTTON_CONFIG },
      createElement(WebSearchSettingsPage, { language: 'zh-CN' }))))
    await settle()

    // 「没读出来」不是「这里没有内容」：必须是 error 态，不是空态。
    const errorView = container.querySelector('[data-state="error"]')
    expect(errorView).not.toBeNull()
    // 原始异常只进日志，一个字都不上屏。
    expect(container.textContent).not.toContain('ENOENT')
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()

    // 重试是真的重新拉一次，并且恢复后页面正常渲染。
    await click(container, '[data-state="error"] .state-view__action')
    expect(getSettings).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-state="error"]')).toBeNull()
  })

  it('owns its own single-column workspace and hides the old rail', async () => {
    const css = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')
    const rule = css.match(/\.settings-workspace\.web-search-settings\s*\{[^}]*\}/)?.[0] ?? ''
    const { container } = await mountPage()

    expect(rule).toContain('grid-template-columns: minmax(0, 1fr);')
    expect(container.querySelector('.web-search-provider-rail')).toBeNull()
    expect(container.querySelector('.web-search-shell')).toBeNull()
  })

  it('renders title, subtitle, saved state, one save button and two tabs', async () => {
    const { container } = await mountPage()

    expect(container.querySelector('.web-search-page-header h1')?.textContent).toBe(labels.title)
    expect(container.querySelector('.web-search-page-header p')?.textContent).toBe(labels.subtitle)
    expect(container.textContent).toContain(labels.saved)
    const saveButtons = [...container.querySelectorAll('button')].filter(
      (item) => (item.textContent ?? '').trim() === labels.savePolicy
    )
    expect(saveButtons).toHaveLength(1)
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-web-search-summary-chip]')).toHaveLength(6)
  })

  it('switches tabs without writing the tab state into settings', async () => {
    const { container, updateSettings } = await mountPage()

    await click(container, '[data-web-search-tab="providers"]')
    expect(container.querySelector('[data-web-search-providers]')).not.toBeNull()
    expect(container.querySelector('[data-web-search-policy]')).toBeNull()
    expect(updateSettings).not.toHaveBeenCalled()

    await click(container, '[data-web-search-tab="policy"]')
    expect(container.querySelector('[data-web-search-policy]')).not.toBeNull()
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('filters providers by capability and disabled state', async () => {
    const { container } = await mountPage()
    await click(container, '[data-web-search-tab="providers"]')

    expect(container.querySelector('[data-web-search-filter="all"]')?.textContent).toBe(labels.providerFiltersAll(4))
    expect(container.querySelector('[data-web-search-filter="disabled"]')?.textContent).toBe(labels.providerFilterDisabled(2))

    await click(container, '[data-web-search-filter="disabled"]')
    expect(rows(container)).toEqual(['Searxng', 'Fetch'])

    await click(container, '[data-web-search-filter="searchKeywords"]')
    expect(rows(container)).toEqual(['Tavily', 'Jina', 'Searxng'])

    await click(container, '[data-web-search-filter="fetchUrls"]')
    expect(rows(container)).toEqual(['Jina', 'Fetch'])
  })

  it('folds unavailable providers behind one row and expands on demand', async () => {
    const { container } = await mountPage()
    await click(container, '[data-web-search-tab="providers"]')

    const more = container.querySelector('[data-web-search-more-providers]') as HTMLButtonElement
    expect(more.textContent).toContain(labels.moreProviders(1))
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('Exa')

    await click(container, '[data-web-search-more-providers]')
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[data-web-search-deferred-row="exa"]')?.textContent).toContain('Exa')
    expect(container.querySelector('[data-web-search-deferred-row="exa"]')?.textContent).toContain(labels.deferredBadge)
  })

  it('shows one row per provider and read-only default badges', async () => {
    const { container } = await mountPage()
    await click(container, '[data-web-search-tab="providers"]')

    expect(rows(container)).toEqual(['Tavily', 'Jina', 'Searxng', 'Fetch'])
    const jina = container.querySelector('[data-web-search-provider-row="jina"]') as HTMLElement
    expect(jina.textContent).toContain(
      `${labels.capabilitySearchShort}${labels.capabilityJoin}${labels.capabilityFetchShort}`
    )
    expect(jina.querySelector('[data-web-search-default-cell]')?.textContent).toContain(labels.defaultFetchBadge)
    expect(jina.querySelector('select')).toBeNull()
    expect(jina.querySelector('.ant-select')).toBeNull()
  })
})

function rows(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-web-search-provider-row]')].map(
    (row) => (row.querySelector('.web-search-provider-name')?.textContent ?? '').trim()
  )
}

async function settle(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}
