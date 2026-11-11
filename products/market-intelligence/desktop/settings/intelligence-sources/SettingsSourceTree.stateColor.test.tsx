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

async function renderRow(sources: ReadonlyArray<Record<string, unknown>>, providers?: ReadonlyArray<ReadonlyArray<Record<string, unknown>>>, cellEnabled?: Readonly<Record<string, boolean>>): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(SettingsSourceTree, {
    ...(cellEnabled === undefined ? {} : { cellEnabled }),
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
describe('数据源的启用状态与「采集与数据」一致（用户 2026-11-12）', () => {
  it('shows a source as disabled when the source is on but every one of its cells is off', async () => {
    // 用户截图：采集与数据里「政策路径概率」关掉，数据源里 Polymarket 仍显绿。
    // 同一个事实的两处显示必须一致：格全关 → 这一行就是「关闭」。
    const host = await renderRow(
      [{ sourceId: 'policy-path-market', enabled: true }],
      undefined,
      { 'policy-path:probability': false }
    )
    expect(host.querySelector('.intelligence-provider-row')?.getAttribute('data-provider-state')).toBe('disabled')
  })

  it('goes back to enabled as soon as the cell is on again', async () => {
    const host = await renderRow(
      [{ sourceId: 'policy-path-market', enabled: true }],
      undefined,
      { 'policy-path:probability': true }
    )
    expect(host.querySelector('.intelligence-provider-row')?.getAttribute('data-provider-state')).toBe('enabled')
  })

  it('still treats a pending source as pending, never as disabled', async () => {
    // 真待接入不是「格关了」：即使它的格全关，也留在灰档。
    const host = await renderRow(
      [{ sourceId: 'policy-path-market', visibility: 'pending', enabled: false }],
      undefined,
      { 'policy-path:probability': false }
    )
    expect(host.querySelector('.intelligence-provider-row')?.getAttribute('data-provider-state')).toBe('pending')
  })

  it('stays disabled when the source itself is off, whatever the cells say', async () => {
    // 两条路都收敛到「关闭」：源自己关，或它的格全关。
    const host = await renderRow(
      [{ sourceId: 'policy-path-market', enabled: false }],
      undefined,
      { 'policy-path:probability': true }
    )
    expect(host.querySelector('.intelligence-provider-row')?.getAttribute('data-provider-state')).toBe('disabled')
  })
})

})
