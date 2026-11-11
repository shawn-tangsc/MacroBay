// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { SettingsSourceTree, providerRowState } from './SettingsSourceTree'

/**
 * 行状态**只看源自己开没开**（用户 2026-11-12 原话：「数据源这里绿不绿，和里面的模块启用不启用没关系，
 * 只和整个源是不是被启用有关」）。
 *
 * 三档：全部源待接入 → `pending`（灰）；否则任一源启用 → `enabled`（绿）；否则 `disabled`（红）。
 * 颜色只给头像（`data-provider-state`），文字色不随状态变。
 *
 * 曾经有两维参与判定，都被用户否掉、这里钉住不能回来：
 * ① 「它的格在采集与数据里全关」→ 曾判 disabled；② 「0 个模块用它」→ 曾判灰/红。
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

const stateOf = (host: HTMLElement): string | null | undefined =>
  host.querySelector('.intelligence-provider-row')?.getAttribute('data-provider-state')

describe('行状态只看源自己的 enabled', () => {
  it('① stays enabled when the source is on, even if every one of its cells is off', async () => {
    // 用户截图：采集与数据里关掉「政策路径概率」，数据源里 Polymarket 变红。
    const landed = await renderRow([{ sourceId: 'policy-path-market', enabled: true }])
    expect(stateOf(landed)).toBe('enabled')
    await act(async () => root?.unmount())
    document.body.replaceChildren()

    // `twelve-data-market` 在看板里**只有备用行**（备用行缺键默认关）：旧实现下它的格全关 → 行被判红。
    // 这条是 ① 的硬红证——在 `dc0da15` 的实现上跑会红（`expected 'disabled' to be 'enabled'`），
    // 而主源那条在旧实现上仍绿（主格缺键默认开，本来就看不出这一维）。
    const fallbackOnly = await renderRow([{ sourceId: 'twelve-data-market', enabled: true }])
    expect(stateOf(fallbackOnly)).toBe('enabled')
  })

  it('② is disabled when the source itself is off, whatever its cells say', async () => {
    const host = await renderRow([{ sourceId: 'policy-path-market', enabled: false }])
    expect(stateOf(host)).toBe('disabled')
  })

  it('③ all pending → pending; pending mixed with an enabled source → enabled; pending + all off → disabled', async () => {
    const allPending = await renderRow([
      { sourceId: 'a', visibility: 'pending', enabled: false },
      { sourceId: 'b', visibility: 'pending', enabled: false }
    ])
    expect(stateOf(allPending)).toBe('pending')
    await act(async () => root?.unmount())
    document.body.replaceChildren()

    const pendingPlusOn = await renderRow([
      { sourceId: 'a', visibility: 'pending', enabled: false },
      { sourceId: 'b', visibility: 'visible', enabled: true }
    ])
    expect(stateOf(pendingPlusOn)).toBe('enabled')
    await act(async () => root?.unmount())
    document.body.replaceChildren()

    const pendingPlusOff = await renderRow([
      { sourceId: 'a', visibility: 'pending', enabled: false },
      { sourceId: 'b', visibility: 'visible', enabled: false }
    ])
    expect(stateOf(pendingPlusOff)).toBe('disabled')
  })

  it('does not take any cell or module data: the signature has one parameter and extra data changes nothing', () => {
    // 反向守卫：函数签名里**没有**第二个参数（加回来就红）；外部再塞一份格/模块快照也影响不了判定。
    expect(providerRowState.length).toBe(1)
    const provider = { sources: [src('policy-path-market', { enabled: true })] }
    const withExtra = (providerRowState as (input: unknown, extra?: unknown) => string)(provider, { 'policy-path:probability': false })
    expect(withExtra).toBe('enabled')
  })

  it('an enabled source that no dashboard module uses is still green', async () => {
    // 维护备用 / 只供分析的源：0 模块也照自己的开关上色（改前会被判灰/红）。
    const host = await renderRow([{ sourceId: 'ethereum-foundation-blog', enabled: true }])
    expect(stateOf(host)).toBe('enabled')
    await act(async () => root?.unmount())
    document.body.replaceChildren()
    const off = await renderRow([{ sourceId: 'ethereum-foundation-blog', enabled: false }])
    expect(stateOf(off)).toBe('disabled')
  })
})

describe('组内按状态排序', () => {
  it('orders enabled, then disabled, then pending, and keeps same-state order stable', async () => {
    // 三个供应商：全关（红）、有一项开（绿）、全待接入（灰）。渲染顺序必须是 绿 → 红 → 灰。
    const host = await renderRow([], [
      [{ sourceId: 'coindesk-rss', enabled: false }],
      [{ sourceId: 'sec-rss', enabled: true }],
      [{ sourceId: 'coinmarketcal', visibility: 'pending', enabled: false }]
    ])
    const states = [...host.querySelectorAll('.intelligence-provider-row')].map((row) => row.getAttribute('data-provider-state'))
    expect(states).toEqual(['enabled', 'disabled', 'pending'])
  })
})