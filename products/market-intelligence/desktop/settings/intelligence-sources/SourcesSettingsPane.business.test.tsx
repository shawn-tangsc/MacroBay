// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { SourcesSettingsPane } from './SourcesSettingsPane'

const t = productText['zh-CN'].settings.intelligenceSources
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

const view = {
  groups: [{
    category: 'macro',
    providers: [{
      providerId: 'p1', displayName: 'RealMarketAPI', category: 'macro', credential: 'api-key', healthMarker: 'none',
      sources: [{
        sourceId: 'realmarketapi-market', providerId: 'p1', displayName: 'RealMarketAPI', agents: [], panels: ['dashboard'],
        visibility: 'visible', collection: 'adapter', kind: 'feed', capabilities: { testConnection: true }, readiness: 'live',
        enabled: true, healthState: 'healthy', healthMarker: 'none'
      }]
    }]
  }],
  counts: { total: 1, enabled: 1, pending: 0, failed: 0 }
} as never

async function render(filter: 'all' | 'dashboard'): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(SourcesSettingsPane, {
        filter,
        onFilterChange: vi.fn(),
        onSelectProvider: vi.fn(),
        surface: {
          text: t,
          onDraftChange: vi.fn(),
          onRunNow: async () => undefined,
          onToggleSource: async () => true,
          policy: { labels: t.collectionPolicy, onChange: vi.fn(), profiles: {}, supportsSentimentById: {} },
          showSourceDetails: true
        } as never,
        treeLabels: {
          title: t.title,
          categories: t.sourceCategories,
          providerNames: t.providerNames,
          providerSummary: t.providerSummary,
          unavailableCountOne: t.unavailableCountOne,
          unavailableCountOther: t.unavailableCountOther
        } as never,
        view
      })
    }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return host
}

describe('SourcesSettingsPane：业务设置不是情报源那套', () => {
  it('renders business rows and no source detail at all', async () => {
    const host = await render('dashboard')
    const text = host.textContent ?? ''
    // 业务设置：源级详情一个都不许出现。
    expect(host.querySelectorAll('h2')).toHaveLength(0)
    expect(text).not.toContain(t.testConnection)
    expect(text).not.toContain(t.apiKey.label)
    // 第二栏必须出现三项。
    for (const label of [t.businessTabs.dashboard, t.businessTabs.calendar, t.businessTabs.sentiment]) {
      expect(text).toContain(label)
    }
  })

  it('keeps the sources tree + detail on the 情报源 tab', async () => {
    const host = await render('all')
    expect(host.querySelector('aside.intelligence-catalog-pane')).not.toBeNull()
  })
})
