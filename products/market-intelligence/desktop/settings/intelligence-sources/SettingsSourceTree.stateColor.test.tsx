// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { SettingsSourceTree } from './SettingsSourceTree'

/**
 * 行状态只给**头像**上色（用户 2026-11-11）：待接入（优先）→ 灰、未启用（全关）→ 红、至少一项启用 → 绿。
 * **源名与副标题的文字色不随状态变**——这三条用例把属性钉住，把文字也染色就得红（见 settingsRowValues 的类级断言）。
 */
const t = productText['zh-CN'].settings.intelligenceSources
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function src(sourceId: string, overrides: Record<string, unknown> = {}) {
  return {
    sourceId, providerId: 'p', displayName: sourceId, agents: [], panels: ['dashboard'],
    visibility: 'visible', collection: 'adapter', kind: 'feed', capabilities: {}, readiness: 'live',
    enabled: true, healthState: 'healthy', healthMarker: 'none', ...overrides
  }
}

async function renderRow(sources: ReadonlyArray<Record<string, unknown>>, providers?: ReadonlyArray<ReadonlyArray<Record<string, unknown>>>): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(SettingsSourceTree, {
    filter: 'all',
    labels: {
      title: 'Sources', categories: { macro: '宏观' } as never, providerNames: {}, unavailableCountOne: '{count} 个不可用', unavailableCountOther: '{count} 个不可用'
    },
    onFilterChange: vi.fn(),
    onSelectProvider: vi.fn(),
    selectedProviderId: undefined,
    view: {
      groups: [{
        category: 'macro',
        providers: (providers ?? [sources]).map((group, groupIndex) => ({
          providerId: `p${groupIndex}`, displayName: `P${groupIndex}`, category: 'macro', credential: 'none', healthMarker: 'none',
          sources: group.map((item, index) => src(String(item.sourceId ?? `s${index}`), item))
        }))
      }],
      counts: { total: sources.length, enabled: 0, pending: 0, failed: 0 }
    } as never
  })))
  return host
}

describe('来源行状态属性（只给头像上色）', () => {
  it('marks a pending source as pending even when it is disabled', async () => {
    // 待接入优先于未启用：待接入的源即使 enabled=false 也走灰，不显示红。
    const host = await renderRow([{ sourceId: 'coindesk-rss', visibility: 'pending', enabled: false }])
    expect(host.querySelector('.intelligence-provider-row')?.getAttribute('data-provider-state')).toBe('pending')
  })

  it('greys a source that no dashboard module uses, whatever its switch says', async () => {
    // `ethereum-foundation-blog` 这类：0 模块使用 → 灰，与开/关无关（用户 2026-11-11）。
    const host = await renderRow([{ sourceId: 'ethereum-foundation-blog', enabled: true }])
    expect(host.querySelector('.intelligence-provider-row')?.getAttribute('data-provider-state')).toBe('pending')
  })

  it('marks a fully disabled source as disabled', async () => {
    const host = await renderRow([{ sourceId: 'coindesk-rss', enabled: false }, { sourceId: 'sec-rss', enabled: false }])
    expect(host.querySelector('.intelligence-provider-row')?.getAttribute('data-provider-state')).toBe('disabled')
  })

  it('marks a source with at least one enabled capability as enabled', async () => {
    const host = await renderRow([{ sourceId: 'coindesk-rss', enabled: false }, { sourceId: 'sec-rss', enabled: true }])
    expect(host.querySelector('.intelligence-provider-row')?.getAttribute('data-provider-state')).toBe('enabled')
  })
})

describe('组内按状态排序', () => {
  it('orders enabled, then disabled, then unused, and keeps same-state order stable', async () => {
    // 三个供应商：一个全关（红）、一个有一项开（绿）、一个 0 模块（灰）。渲染顺序必须是 绿 → 红 → 灰。
    const host = await renderRow([], [
      [{ sourceId: 'coindesk-rss', enabled: false }],
      [{ sourceId: 'sec-rss', enabled: true }],
      [{ sourceId: 'ethereum-foundation-blog', enabled: true }]
    ])
    const states = [...host.querySelectorAll('.intelligence-provider-row')].map((row) => row.getAttribute('data-provider-state'))
    expect(states).toEqual(['enabled', 'disabled', 'pending'])
  })
})
