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
import { expectWaitingFirst } from '@platform/ui/async/expectWaitingFirst'
import { WINDOW_ANTD_BUTTON_CONFIG } from '@platform/ui/theme/windowAntdTheme'

import { platformText } from '../../../i18n/platformText'
import { WebSearchSettingsPage } from './WebSearchSettingsPage'

const labels = platformText['zh-CN'].webSearch
let root: Root | undefined

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

/**
 * 按**页签名**点击：平台 `Tabs` 是按钮 + `role="tab"`，不再有手写的 `data-web-search-tab`。
 * 两个面板都会挂载（非活动加 `hidden`），所以「现在看到的是哪一页」要查可见的那块。
 */
async function clickTab(container: ParentNode, label: string): Promise<void> {
  const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find((candidate) => candidate.textContent?.trim() === label)
  expect(tab, `no tab named ${label}`).toBeDefined()
  await act(async () => tab?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await settle()
}

function visiblePanel(container: ParentNode): HTMLElement | null {
  return container.querySelector<HTMLElement>('.tabs__panel:not([hidden])')
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
    // 两个面板都挂载（平台 `Tabs` 的既定行为），摘要只在可见的那一块里数。
    expect(visiblePanel(container)?.querySelectorAll('[data-web-search-summary-chip]')).toHaveLength(6)
  })

  it('switches tabs without writing the tab state into settings', async () => {
    const { container, updateSettings } = await mountPage()

    await clickTab(container, labels.providersTab)
    // 切页签后**可见的**是供应商页；旧策略页仍挂载但 `hidden`（`Tabs` 全挂载）。
    expect(visiblePanel(container)?.querySelector('[data-web-search-providers]')).not.toBeNull()
    expect(visiblePanel(container)?.querySelector('[data-web-search-policy]')).toBeNull()
    expect(updateSettings).not.toHaveBeenCalled()

    await clickTab(container, labels.policyTab)
    expect(visiblePanel(container)?.querySelector('[data-web-search-policy]')).not.toBeNull()
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('filters providers by capability and disabled state', async () => {
    const { container } = await mountPage()
    await clickTab(container, labels.providersTab)

    // 平台 `FilterChip`：标签与计数分两格渲染，选中态只有 `aria-pressed` 一个来源。
    // 换掉的是页内自绘的 `.web-search-filter-chip`——它不该再出现，否则就是第二套胶囊。
    const chips = providerFilterChips(container)
    expect(container.querySelector('.web-search-filter-chip')).toBeNull()
    expect(chips).toHaveLength(4)
    for (const chip of chips) expect(chip.classList.contains('filter-chip')).toBe(true)
    expect(chipText(chips[0]!)).toEqual([labels.providerFilterAll, '4'])
    expect(chipText(chips[1]!)).toEqual([labels.providerFilterSearch, null])
    expect(chipText(chips[2]!)).toEqual([labels.providerFilterFetch, null])
    expect(chipText(chips[3]!)).toEqual([labels.providerFilterDisabled, '2'])
    // 单选组：只有当前筛选项是按下态。
    expect(chips[0]!.getAttribute('aria-pressed')).toBe('true')
    expect(chips.slice(1).every((chip) => chip.getAttribute('aria-pressed') === 'false')).toBe(true)

    await press(chips[3]!)
    expect(rows(container)).toEqual(['Searxng', 'Fetch'])
    expect(pressedFilterChip(container)).toBe('disabled')

    await press(chips[1]!)
    expect(rows(container)).toEqual(['Tavily', 'Jina', 'Searxng'])
    expect(pressedFilterChip(container)).toBe('searchKeywords')

    await press(chips[2]!)
    expect(rows(container)).toEqual(['Jina', 'Fetch'])
    expect(pressedFilterChip(container)).toBe('fetchUrls')
  })

  it('folds unavailable providers behind one row and expands on demand', async () => {
    const { container } = await mountPage()
    await clickTab(container, labels.providersTab)

    const more = container.querySelector('[data-web-search-more-providers]') as HTMLButtonElement
    expect(more.textContent).toContain(labels.moreProviders(1))
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('Exa')

    await click(container, '[data-web-search-more-providers]')
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[data-web-search-deferred-row="exa"]')?.textContent).toContain('Exa')
    expect(container.querySelector('[data-web-search-deferred-row="exa"]')?.textContent).toContain(labels.deferredBadge)
  })

  it('draws only the loading state before the first read resolves', async () => {
    // 台账 §25 的第 ① 种处境：读还没 settle 时，屏幕上不许出现错误，也不许出现空态。
    let resolveSettings: (value: WebSearchSettings) => void = () => undefined
    let resolveProviders: (value: SafeWebSearchProviderView[]) => void = () => undefined
    const pendingSettings = new Promise<WebSearchSettings>((resolve) => { resolveSettings = resolve })
    const pendingProviders = new Promise<SafeWebSearchProviderView[]>((resolve) => { resolveProviders = resolve })
    Object.assign(window, {
      platform: {
        webSearch: {
          getSettings: vi.fn(() => pendingSettings),
          listProviders: vi.fn(() => pendingProviders),
          updateSettings: async () => settings(),
          updateProvider: async () => provider('tavily'),
          checkProvider: async () => ({ valid: true }),
          revealApiKey: async () => null
        },
        app: { openExternal: vi.fn() }
      }
    })

    // 同一个页面元素，渲染两次：先证明悬着时只有加载态，再证明读回来能翻成页面。
    await expectWaitingFirst(pageElement())

    const container = document.createElement('div')
    document.body.append(container)
    const pageRoot = createRoot(container)
    root = pageRoot
    await act(async () => pageRoot.render(pageElement()))
    const loadingBefore = container.querySelector('[data-state="error"]')
    expect(loadingBefore).toBeNull()

    await act(async () => {
      resolveSettings(settings())
      resolveProviders(providers())
      await Promise.all([pendingSettings, pendingProviders])
    })
    await vi.waitFor(() => expect(container.querySelector('[data-web-search-settings-page]')).not.toBeNull())
    expect(container.querySelector('[data-state="error"]')).toBeNull()
    expect(container.querySelector('[data-loading-state]')).toBeNull()
  })

  it('shows one row per provider and read-only default badges', async () => {
    const { container } = await mountPage()
    await clickTab(container, labels.providersTab)

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

function pageElement(): React.ReactElement {
  return createElement(ConfigProvider, { button: WINDOW_ANTD_BUTTON_CONFIG },
    createElement(WebSearchSettingsPage, { language: 'zh-CN' }))
}

function rows(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-web-search-provider-row]')].map(
    (row) => (row.querySelector('.web-search-provider-name')?.textContent ?? '').trim()
  )
}

/** 筛选组的胶囊，按渲染顺序：全部 / 搜索 / 读取 / 未启用。 */
function providerFilterChips(container: ParentNode): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('.web-search-provider-filters button')]
}

/** 胶囊的标签与计数是两格：返回 `[标签, 计数或 null]`，不把两格拼成一个字符串再断言。 */
function chipText(chip: HTMLElement): [string, string | null] {
  return [
    (chip.querySelector('.filter-chip__label')?.textContent ?? '').trim(),
    chip.querySelector('.filter-chip__count')?.textContent?.trim() ?? null
  ]
}

async function press(chip: HTMLElement): Promise<void> {
  await act(async () => chip.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await settle()
}

/** 当前按下的是哪一个筛选项——从可见标签反推，标签写错时会落到 `unknown:` 而不是静默通过。 */
function pressedFilterChip(container: ParentNode): string {
  const pressed = providerFilterChips(container).filter((chip) => chip.getAttribute('aria-pressed') === 'true')
  expect(pressed).toHaveLength(1)
  const [label] = chipText(pressed[0]!)
  if (label === labels.providerFilterAll) return 'all'
  if (label === labels.providerFilterSearch) return 'searchKeywords'
  if (label === labels.providerFilterFetch) return 'fetchUrls'
  if (label === labels.providerFilterDisabled) return 'disabled'
  return `unknown:${label}`
}

async function settle(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}
