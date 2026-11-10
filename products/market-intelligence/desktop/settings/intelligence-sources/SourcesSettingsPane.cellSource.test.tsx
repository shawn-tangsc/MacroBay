// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { SourcesSettingsPane } from './SourcesSettingsPane'

/**
 * 卡片项那颗开关同时表示两件事（用户 2026-11-12）：这一格用哪个源 **和** 这个源要不要开。
 * - 开：写格 true + 选中该源 + 把源设为启用；
 * - 关：写格 false；**只有这个源再没有任何开着的格在用**时才停用源（否则不动它）。
 */
const t = productText['zh-CN'].settings.intelligenceSources
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function source(sourceId: string) {
  return {
    sourceId, providerId: 'p', displayName: sourceId, agents: [], panels: ['dashboard'],
    visibility: 'visible', collection: 'adapter', kind: 'feed', capabilities: {}, readiness: 'live',
    enabled: true, healthState: 'healthy', healthMarker: 'none'
  }
}

async function render(initial: Readonly<Record<string, boolean>> = {}) {
  const onToggleSource = vi.fn(async () => true)
  const writes: Array<[string, boolean]> = []
  const selections: Array<[string, string | null]> = []
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(SourcesSettingsPane, {
        cellEnabledIo: {
          read: async () => initial,
          write: async (cellId: string, enabled: boolean) => { writes.push([cellId, enabled]) },
          writeSelection: async (cellId: string, sourceId: string | null) => { selections.push([cellId, sourceId]) }
        },
        filter: 'all',
        onFilterChange: vi.fn(),
        onSelectProvider: vi.fn(),
        pane: 'business',
        surface: {
          text: t,
          onDraftChange: vi.fn(),
          onRunNow: async () => undefined,
          onToggleSource,
          policy: { labels: t.collectionPolicy, onChange: vi.fn(), profiles: {}, supportsSentimentById: {} },
          showSourceDetails: true
        } as never,
        treeLabels: {
          title: t.title, categories: t.sourceCategories, providerNames: t.providerNames,
          providerSummary: t.providerSummary, unavailableCountOne: t.unavailableCountOne,
          unavailableCountOther: t.unavailableCountOther
        } as never,
        view: {
          groups: [{ category: 'macro', providers: [{ providerId: 'p', displayName: 'p', category: 'macro', credential: 'none', healthMarker: 'none', sources: [source('binance-futures-positioning'), source('realmarketapi-market')] }] }],
          counts: { total: 2, enabled: 2, pending: 0, failed: 0 }
        } as never
      })
    }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return { host, onToggleSource, writes, selections }
}

describe('卡片项开关 = 格选择 + 源启停', () => {
  it('turns the source on when a cell is enabled', async () => {
    // 这一格先关着，点它才算「打开」。
    const { host, onToggleSource, writes, selections } = await render({ 'quotes:btc': false })
    const row = host.querySelector<HTMLElement>('[data-cell-id="quotes:btc"]')
    const control = row?.querySelector<HTMLElement>('[role="switch"]')
    await act(async () => { control?.click() })
    expect(writes).toContainEqual(['quotes:btc', true])
    expect(selections).toContainEqual(['quotes:btc', 'binance-futures-positioning'])
    expect(onToggleSource).toHaveBeenCalledWith({ sourceId: 'binance-futures-positioning', kind: '' }, true)
  })

  it('keeps the source on while another cell of it is still used', async () => {
    const { host, onToggleSource } = await render()
    // 先开 BTC 那一格，再关它——同源的 ETH/纳指两格仍是「缺键默认开」，所以源不该被停用。
    const row = host.querySelector<HTMLElement>('[data-cell-id="quotes:btc"]')
    const control = row?.querySelector<HTMLElement>('[role="switch"]')
    await act(async () => { control?.click() })
    await act(async () => { control?.click() })
    const disableCalls = onToggleSource.mock.calls
      .filter((call) => (call as unknown as [unknown, boolean])[1] === false)
    expect(disableCalls).toHaveLength(0)
  })
})
