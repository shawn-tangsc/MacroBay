// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { SourcesSettingsPane } from './SourcesSettingsPane'

/**
 * 摘要与行走**同一份投影的同一个字段**（用户 2026-11-11，配图「币安 4 项能力 · 已启用 4」但只有 2 颗开关开着）：
 * 4 个源项、2 个 `source.enabled` → 左上角摘要必须是「4 项 · 已启用 2」，且恰好 2 行开关为开。
 *
 * 反向：把行开关改回读「看板某一格有没有用它」（`cellEnabled`），这一条立刻红——没有格快照时 4 行全关，
 * 摘要却仍是 2，两个数又对不上。
 */
const t = productText['zh-CN'].settings.intelligenceSources
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function source(sourceId: string, enabled: boolean) {
  return {
    sourceId, providerId: 'p', displayName: sourceId, agents: [], panels: ['dashboard'],
    visibility: 'visible', collection: 'adapter', kind: 'feed', capabilities: {}, readiness: 'live',
    enabled, healthState: enabled ? 'healthy' : 'off', healthMarker: 'none'
  }
}

async function render(): Promise<HTMLElement> {
  const sources = [
    source('binance-announcements', true),
    source('binance-futures-positioning', true),
    source('binance-api-updates', false),
    source('binance-spot-market', false)
  ]
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(SourcesSettingsPane, {
        filter: 'all',
        onFilterChange: vi.fn(),
        onSelectProvider: vi.fn(),
        pane: 'sources',
        selectedProviderId: 'p',
        surface: {
          text: t,
          onDraftChange: vi.fn(),
          onRunNow: async () => undefined,
          onToggleSource: async () => true,
          policy: { labels: t.collectionPolicy, onChange: vi.fn(), profiles: {}, supportsSentimentById: {} },
          showSourceDetails: true
        } as never,
        treeLabels: {
          title: t.title, categories: t.sourceCategories, providerNames: t.providerNames,
          providerSummary: t.providerSummary, unavailableCountOne: t.unavailableCountOne,
          unavailableCountOther: t.unavailableCountOther
        } as never,
        view: {
          groups: [{ category: 'crypto', providers: [{ providerId: 'p', displayName: '币安', category: 'crypto', credential: 'none', healthMarker: 'none', sources }] }],
          counts: { total: 4, enabled: 2, pending: 0, failed: 0 }
        } as never
      })
    }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return host
}

describe('摘要与行开关是同一个数', () => {
  it('says 4 项 · 已启用 2 and shows exactly two rows on', async () => {
    const host = await render()

    // 摘要：同一份投影里 enabled 的两个源。
    expect(host.querySelector('.intelligence-provider-row small')?.textContent)
      .toBe(t.providerSummary.replace('{total}', '4').replace('{enabled}', '2'))

    const rows = [...host.querySelectorAll<HTMLElement>(
      '[data-setting-key^="setting:sources.enabled"] [role="switch"]'
    )]
    expect(rows).toHaveLength(4)
    expect(rows.filter((control) => control.getAttribute('aria-checked') === 'true')).toHaveLength(2)
  })
})
