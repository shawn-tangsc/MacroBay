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

async function renderRow(sources: ReadonlyArray<Record<string, unknown>>): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(SettingsSourceTree, {
    filter: 'all',
    labels: {
      title: 'Sources', categories: { macro: '宏观' } as never, providerNames: {},
      providerSummary: '{total}/{enabled}', unavailableCountOne: '{count} 个不可用', unavailableCountOther: '{count} 个不可用'
    },
    onFilterChange: vi.fn(),
    onSelectProvider: vi.fn(),
    selectedProviderId: undefined,
    view: {
      groups: [{
        category: 'macro',
        providers: [{
          providerId: 'p', displayName: 'P', category: 'macro', credential: 'none', healthMarker: 'none',
          sources: sources.map((item, index) => src(`s${index}`, item))
        }]
      }],
      counts: { total: sources.length, enabled: 0, pending: 0, failed: 0 }
    } as never
  })))
  return host
}

describe('来源行状态属性（只给头像上色）', () => {
  it('marks a pending source as pending even when it is disabled', async () => {
    // 待接入优先于未启用：待接入的源即使 enabled=false 也走灰，不显示红。
    const host = await renderRow([{ visibility: 'pending', enabled: false }])
    expect(host.querySelector('.intelligence-provider-row')?.getAttribute('data-provider-state')).toBe('pending')
  })

  it('marks a fully disabled source as disabled', async () => {
    const host = await renderRow([{ enabled: false }, { enabled: false }])
    expect(host.querySelector('.intelligence-provider-row')?.getAttribute('data-provider-state')).toBe('disabled')
  })

  it('marks a source with at least one enabled capability as enabled', async () => {
    const host = await renderRow([{ enabled: false }, { enabled: true }])
    expect(host.querySelector('.intelligence-provider-row')?.getAttribute('data-provider-state')).toBe('enabled')
    expect(host.textContent).toContain('2/1')
  })
})
