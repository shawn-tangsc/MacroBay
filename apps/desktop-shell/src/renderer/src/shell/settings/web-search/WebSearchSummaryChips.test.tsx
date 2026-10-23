// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDefaultWebSearchSettings } from '@platform/ai/web-search/contracts/webSearchSettings'

import { platformText } from '../../../i18n/platformText'
import { WebSearchSettingsPage } from './WebSearchSettingsPage'
import { WebSearchSummaryChips } from './WebSearchSummaryChips'
import { createTestProviders, createTestSettings } from './webSearchTestFixtures'

const labels = platformText['zh-CN'].webSearch
const enLabels = platformText['en-US'].webSearch
let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

describe('PLAT-60 summary chips', () => {
  it('renders six chips in prototype order from saved settings', () => {
    const markup = renderToStaticMarkup(
      createElement(WebSearchSummaryChips, {
        labels,
        settings: {
          ...createTestSettings(),
          maxResults: 8,
          excludeDomains: ['example.com', 'bar.com'],
          searchWithDate: false,
          compression: { method: 'none' as const, cutoffLimit: 3000, cutoffUnit: 'char' as const }
        },
        providers: createTestProviders(),
        onSelectProvider: vi.fn()
      })
    )
    const chipCount = (markup.match(/data-web-search-summary-chip/g) ?? []).length

    expect(chipCount).toBe(6)
    expect(markup).toContain(labels.summaryDefaultSearch)
    expect(markup).toContain('>Tavily<')
    expect(markup).toContain(labels.summaryFetch)
    expect(markup).toContain('8 条')
    expect(markup).toContain('3000 字符')
    expect(markup).toContain('2 条')
    expect(markup).toContain('关')
  })

  it('keeps the chips consistent on both tabs', async () => {
    stubPlatform(createTestSettings(), createTestProviders())
    const container = await mountPage()
    const policyChips = [...container.querySelectorAll('[data-web-search-summary-chip]')].map((chip) => chip.textContent)

    await click(container, '[data-web-search-tab="providers"]')
    const providerChips = [...container.querySelectorAll('[data-web-search-summary-chip]')].map((chip) => chip.textContent)

    expect(providerChips).toEqual(policyChips)
  })

  it('warns in both locales when the default provider is disabled', () => {
    const zh = renderToStaticMarkup(
      createElement(WebSearchSummaryChips, {
        labels,
        settings: createTestSettings({ tavilyEnabled: false }),
        providers: createTestProviders({ tavilyEnabled: false }),
        onSelectProvider: vi.fn()
      })
    )
    const en = renderToStaticMarkup(
      createElement(WebSearchSummaryChips, {
        labels: enLabels,
        settings: createTestSettings({ tavilyEnabled: false }),
        providers: createTestProviders({ tavilyEnabled: false }),
        onSelectProvider: vi.fn()
      })
    )

    expect(zh).toContain(labels.searchUnavailableDisabled)
    expect(zh).toContain('data-web-search-summary-warning="searchKeywords"')
    expect(en).toContain(enLabels.searchUnavailableDisabled)
  })

  it('clicking a summary warning switches to Providers and opens that provider drawer', async () => {
    stubPlatform(createTestSettings({ tavilyEnabled: false }), createTestProviders({ tavilyEnabled: false }))
    const container = await mountPage()

    const warning = container.querySelector('[data-web-search-summary-warning="searchKeywords"]')
    expect(warning).not.toBeNull()
    await act(async () => warning?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await settle()

    expect(container.querySelector('[data-web-search-tab="providers"]')?.getAttribute('aria-selected')).toBe('true')
    const drawer = document.querySelector('.web-search-provider-drawer')
    expect(drawer).not.toBeNull()
    expect(drawer?.textContent).toContain(labels.drawerTitle('Tavily'))
  })

  it('renders the six chips off default settings without inventing values', () => {
    const defaults = createDefaultWebSearchSettings()
    const markup = renderToStaticMarkup(
      createElement(WebSearchSummaryChips, {
        labels,
        settings: defaults,
        providers: createTestProviders(),
        onSelectProvider: vi.fn()
      })
    )

    expect(markup).toContain(`${defaults.maxResults} 条`)
    expect(markup).toContain('2000 Token')
    expect(markup).toContain('0 条')
    expect(markup).toContain(labels.summaryOn)
  })
})

function stubPlatform(
  settings: ReturnType<typeof createTestSettings>,
  providers: ReturnType<typeof createTestProviders>
): void {
  Object.assign(window, {
    platform: {
      webSearch: {
        getSettings: async () => settings,
        listProviders: async () => providers,
        updateSettings: async (patch: unknown) => ({ ...settings, ...(patch as object) }),
        updateProvider: async () => providers[0],
        checkProvider: async () => ({ valid: true }),
        revealApiKey: async () => null
      },
      app: { openExternal: vi.fn() }
    }
  })
}

async function mountPage(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(createElement(WebSearchSettingsPage, { language: 'zh-CN' })))
  await settle()
  return container
}

async function click(container: ParentNode, selector: string): Promise<void> {
  const element = container.querySelector(selector)
  expect(element).not.toBeNull()
  await act(async () => element?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await settle()
}

async function settle(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}
