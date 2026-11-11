// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { SourcesSettingsPane } from './SourcesSettingsPane'

/**
 * 宿主指定「要哪个视图」：抽屉把它拆成两个菜单项（`数据源` / `采集与数据`），
 * **页签条整条去掉**。没给 `pane` 的那一面（平台设置页）保持六项页签、原行为不变。
 */
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
    providers: [
      {
        providerId: 'p1', displayName: 'RealMarketAPI', category: 'macro', credential: 'none', healthMarker: 'none',
        sources: [{
          sourceId: 'realmarketapi-market', providerId: 'p1', displayName: 'RealMarketAPI', agents: [], panels: ['dashboard'],
          visibility: 'visible', collection: 'adapter', kind: 'feed', capabilities: {}, readiness: 'live',
          enabled: true, healthState: 'healthy', healthMarker: 'none'
        }]
      },
      {
        providerId: 'p2', displayName: 'Ethereum Foundation', category: 'macro', credential: 'none', healthMarker: 'none',
        sources: [{
          sourceId: 'ethereum-foundation-blog', providerId: 'p2', displayName: 'Ethereum Foundation', agents: [], panels: [],
          visibility: 'visible', collection: 'adapter', kind: 'feed', capabilities: {}, readiness: 'live',
          enabled: true, healthState: 'healthy', healthMarker: 'none'
        }]
      }
    ]
  }],
  counts: { total: 2, enabled: 2, pending: 0, failed: 0 }
} as never

async function render(pane?: 'sources' | 'business'): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(SourcesSettingsPane, {
        filter: 'all',
        ...(pane === undefined ? {} : { pane }),
        onFilterChange: vi.fn(),
        onSelectProvider: vi.fn(),
        surface: {
          text: t,
          onDraftChange: vi.fn(),
          onRunNow: async () => undefined,
          onToggleSource: async () => true,
          policy: { labels: t.collectionPolicy, onChange: vi.fn(), profiles: {} },
          showSourceDetails: true
        } as never,
        treeLabels: {
          title: t.title,
          categories: t.sourceCategories,
          providerNames: t.providerNames,
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

describe('SourcesSettingsPane：视图由宿主指定', () => {
  it('draws the source tree for pane="sources" and no tab bar', async () => {
    const host = await render('sources')
    expect(host.querySelectorAll('.intelligence-catalog-filters')).toHaveLength(0)
    expect(host.querySelector('aside.intelligence-catalog-pane')).not.toBeNull()
    // 业务设置那三项不该出现。
    expect(host.textContent).not.toContain(t.businessTabs.dashboard)
  })

  it('draws the business rows for pane="business" and no tab bar', async () => {
    const host = await render('business')
    expect(host.querySelectorAll('.intelligence-catalog-filters')).toHaveLength(0)
    for (const label of [t.businessTabs.dashboard, t.businessTabs.calendar, t.businessTabs.sentiment]) {
      expect(host.textContent).toContain(label)
    }
    // 源详情一个都不出现。
    expect(host.querySelectorAll('h2')).toHaveLength(0)
    expect(host.textContent).not.toContain(t.testConnection)
  })

  it('keeps the six-item tab bar when no pane is given (platform settings page)', async () => {
    const host = await render()
    const tabs = [...host.querySelectorAll('.intelligence-catalog-filters [role="group"] button')]
    expect(tabs).toHaveLength(6)
  })
})
