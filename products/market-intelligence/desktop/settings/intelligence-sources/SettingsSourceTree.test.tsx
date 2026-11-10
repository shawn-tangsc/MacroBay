// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SettingsSourceTree } from './SettingsSourceTree'

let root: ReturnType<typeof createRoot> | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

describe('SettingsSourceTree', () => {
  it('draws the catalog marker from the projected state, not from the enable switch', async () => {
    // 三处消费方读同一个字段：这里钉设置页左树，抽屉目录点读的是同一份 `healthState`。
    const cases: ReadonlyArray<{ state: string; unavailable?: boolean; marker: string | null }> = [
      { state: 'repeated-failures', marker: 'is-bad' },
      { state: 'failed', marker: 'is-bad' },
      { state: 'stale', marker: 'is-warn' },
      { state: 'healthy', marker: null },
      // 没启用 / 没数据：不画；只有「启用 + 不可用」才画空心环（两个目录点同一套规则）。
      { state: 'off', marker: null },
      { state: 'off', unavailable: true, marker: 'is-muted' }
    ]
    for (const entry of cases) {
      const host = document.createElement('div')
      document.body.append(host)
      root = createRoot(host)
      const source = {
        sourceId: 'demo-source', displayName: 'Demo', providerId: 'demo', panels: ['dashboard'], visibility: 'visible',
        kind: 'adapter', enabled: true, healthState: entry.state, healthMarker: entry.marker === null ? 'none' : entry.marker === 'is-muted' ? 'ring' : entry.marker === 'is-warn' ? 'warn' : 'bad',
        ...(entry.unavailable === true ? { unavailable: { reasonCode: 'official-endpoint-returned-403', automaticSync: 'stopped', decidedAt: '2026-11-09' } } : {})
      }
      const view = {
        groups: [{
          category: 'macro',
          providers: [{
            providerId: 'demo', displayName: 'Demo', category: 'macro', credential: 'none',
            sources: [source],
            // provider 级标记由投影聚合；这里按同一形状给出。
            healthMarker: source.healthMarker
          }]
        }],
        counts: { total: 1, enabled: 1, pending: 0, failed: 0 }
      }
      await act(async () => root!.render(createElement(SettingsSourceTree, {
        filter: 'all',
        labels: { title: 'Sources', categories: {} as never, providerNames: {}, unavailableCountOne: '含 {count} 个不可用的源', unavailableCountOther: '含 {count} 个不可用的源' },
        onFilterChange: vi.fn(),
        onSelectProvider: vi.fn(),
        selectedProviderId: undefined,
        view: view as never
      })))
      await act(async () => { await Promise.resolve() })
      const marker = host.querySelector('.intelligence-provider-state i')
      expect(marker?.className ?? null, entry.state).toBe(entry.marker)
      await act(async () => root?.unmount())
      root = undefined
      document.body.replaceChildren()
    }
  })

  it('lists a source that only belongs to the calendar panel, like any other', async () => {
    // 配置面要的是**全部源**。曾经想用「按面板取」那条数据链喂这一屏，那样「只给日历」和
    // 「哪都不给」的源会在列表里消失，读者会以为没有这个源。树吃的是 `SettingsView`，
    // 所以按面板筛这一步根本不存在——这条钉的就是「不许按面板筛」。
    const calendarOnly = {
      sourceId: 'macro-calendar-bls', displayName: 'BLS', providerId: 'bls', panels: ['economic-calendar'], visibility: 'visible',
      kind: 'official-calendar', enabled: true, healthState: 'healthy', healthMarker: 'none'
    }
    const dashboardOnly = {
      sourceId: 'binance-open-interest', displayName: 'Binance', providerId: 'binance', panels: ['dashboard'], visibility: 'visible',
      kind: 'adapter', enabled: true, healthState: 'healthy', healthMarker: 'none'
    }
    const view = {
      groups: [
        { category: 'macro', providers: [{ providerId: 'bls', displayName: 'BLS', category: 'macro', credential: 'none', sources: [calendarOnly], healthMarker: 'none' }] },
        { category: 'digital-assets', providers: [{ providerId: 'binance', displayName: 'Binance', category: 'digital-assets', credential: 'api-key', sources: [dashboardOnly], healthMarker: 'none' }] }
      ],
      counts: { total: 2, enabled: 2, pending: 0, failed: 0 }
    }
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(SettingsSourceTree, {
      filter: 'all',
      labels: { title: 'Sources', categories: {} as never, providerNames: {}, unavailableCountOne: '含 {count} 个不可用的源', unavailableCountOther: '含 {count} 个不可用的源' },
      onFilterChange: vi.fn(),
      onSelectProvider: vi.fn(),
      selectedProviderId: undefined,
      view: view as never
    })))
    await act(async () => { await Promise.resolve() })
    const names = [...host.querySelectorAll('.intelligence-provider-main strong')].map((node) => node.textContent)
    expect(names).toEqual(['BLS', 'Binance'])
  })

  it('reports the provider the reader picked, and marks it as current', async () => {
    // 「选中哪个供应商」这件事现在在这里发生：抽屉里那屏的选择状态就是这颗回调。
    const onSelectProvider = vi.fn()
    const provider = (providerId: string, displayName: string): unknown => ({
      providerId, displayName, category: 'macro', credential: 'none', healthMarker: 'none',
      sources: [{
        sourceId: `${providerId}-s`, displayName, providerId, panels: ['dashboard'], visibility: 'visible',
        kind: 'adapter', enabled: true, healthState: 'healthy', healthMarker: 'none'
      }]
    })
    const view = {
      groups: [{ category: 'macro', providers: [provider('bls', 'BLS'), provider('fed', 'Fed')] }],
      counts: { total: 2, enabled: 2, pending: 0, failed: 0 }
    }
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(SettingsSourceTree, {
      filter: 'all',
      labels: { title: 'Sources', categories: {} as never, providerNames: {}, unavailableCountOne: '含 {count} 个不可用的源', unavailableCountOther: '含 {count} 个不可用的源' },
      onFilterChange: vi.fn(),
      onSelectProvider,
      selectedProviderId: 'fed',
      view: view as never
    })))
    await act(async () => { await Promise.resolve() })
    const rows = [...host.querySelectorAll<HTMLButtonElement>('.intelligence-provider-row')]
    expect(rows).toHaveLength(2)
    expect(rows.filter((row) => row.getAttribute('aria-current') === 'true')).toHaveLength(1)
    expect(rows[1]?.getAttribute('aria-current')).toBe('true')
    await act(async () => rows[0]?.click())
    expect(onSelectProvider).toHaveBeenCalledWith('bls')
  })

  it('does not call an unsettled read "filtered out"', async () => {
    // 空数组的 `every` 恒真：`view` 还没到时会画成「筛选后没有来源」+「清除筛选」。
    // 未结算不是被筛掉了——任何提前渲染的调用点都会立刻误导。
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(SettingsSourceTree, {
      filter: 'calendar',
      labels: { title: 'Sources', categories: {} as never, providerNames: {}, unavailableCountOne: '含 {count} 个不可用的源', unavailableCountOther: '含 {count} 个不可用的源' },
      onFilterChange: vi.fn(),
      onSelectProvider: vi.fn(),
      selectedProviderId: undefined,
      view: undefined
    })))
    await act(async () => { await Promise.resolve() })

    expect(host.querySelector('[data-state="empty"]')).toBeNull()
  })

  it('puts how many unavailable sources there are into the row name, and only when there is at least one', async () => {
    // ring 是 aria-hidden 的装饰：读屏听不到「取不到」。目录行自己补一句数量。
    const base = (unavailable: boolean) => ({
      groups: [{
        category: 'macro',
        providers: [{
          providerId: 'bls', displayName: 'BLS', category: 'macro', credential: 'none',
          healthMarker: unavailable ? 'ring' : 'none',
          sources: [{
            sourceId: 'bls', displayName: 'BLS', providerId: 'bls', panels: ['dashboard'], visibility: 'visible',
            kind: 'official-calendar', enabled: true, healthState: 'off', healthMarker: unavailable ? 'ring' : 'none',
            ...(unavailable ? { unavailable: { reasonCode: 'official-endpoint-returned-403', automaticSync: 'stopped', decidedAt: '2026-11-09' } } : {})
          }]
        }]
      }],
      counts: { total: 1, enabled: 1, pending: 0, failed: 0 }
    } as never)

    const render = async (unavailable: boolean): Promise<HTMLElement> => {
      const host = document.createElement('div')
      document.body.append(host)
      root = createRoot(host)
      await act(async () => root!.render(createElement(SettingsSourceTree, {
        filter: 'all',
        labels: { title: 'Sources', categories: {} as never, providerNames: {}, unavailableCountOne: '含 {count} 个不可用的源', unavailableCountOther: '含 {count} 个不可用的源' },
        onFilterChange: vi.fn(),
        onSelectProvider: vi.fn(),
        selectedProviderId: undefined,
        view: base(unavailable)
      })))
      await act(async () => { await Promise.resolve() })
      return host
    }

    const withOne = await render(true)
    const row = withOne.querySelector('.intelligence-provider-row')
    expect(row?.textContent).toContain('含 1 个不可用的源')
    // 装饰环仍是 aria-hidden，不拿它当语义载体。
    expect(row?.querySelector('.intelligence-provider-state i')?.getAttribute('aria-hidden')).toBe('true')

    const withNone = await render(false)
    expect(withNone.textContent).not.toContain('不可用的源')
    expect(withNone.querySelector('.intelligence-source-sr-only')).toBeNull()

    // 英文单复数用**真实渲染**断言：count=1 与 count=2 各一次（不许出现「1 sources」）。
    const englishLabels = {
      title: 'Sources', categories: {} as never, providerNames: {},
      unavailableCountOne: '{count} unavailable source', unavailableCountOther: '{count} unavailable sources'
    }
    const englishView = (ids: readonly string[]): never => ({
      groups: [{
        category: 'macro',
        providers: [{
          providerId: 'bls', displayName: 'BLS', category: 'macro', credential: 'none', healthMarker: 'ring',
          sources: ids.map((id) => ({
            sourceId: id, displayName: id, providerId: 'bls', panels: ['dashboard'], visibility: 'visible',
            kind: 'official-calendar', enabled: true, healthState: 'off', healthMarker: 'ring',
            unavailable: { reasonCode: 'official-endpoint-returned-403', automaticSync: 'stopped', decidedAt: '2026-11-09' }
          }))
        }]
      }],
      counts: { total: ids.length, enabled: ids.length, pending: 0, failed: 0 }
    } as never)
    const renderEnglish = async (ids: readonly string[]): Promise<HTMLElement> => {
      const host = document.createElement('div')
      document.body.append(host)
      root = createRoot(host)
      await act(async () => root!.render(createElement(SettingsSourceTree, {
        filter: 'all', labels: englishLabels, onFilterChange: vi.fn(), onSelectProvider: vi.fn(),
        selectedProviderId: undefined, view: englishView(ids)
      })))
      await act(async () => { await Promise.resolve() })
      return host
    }

    const one = await renderEnglish(['a'])
    expect(one.querySelector('.intelligence-provider-row')?.textContent).toContain('1 unavailable source')
    expect(one.querySelector('.intelligence-provider-row')?.textContent).not.toContain('1 unavailable sources')

    const two = await renderEnglish(['a', 'b'])
    expect(two.querySelector('.intelligence-provider-row')?.textContent).toContain('2 unavailable sources')
  })
  it('renders six controlled filter chips and tiles the list only for the dashboard filter', async () => {
    const onFilterChange = vi.fn()
    const source = {
      sourceId: 'demo-source', displayName: 'Demo', providerId: 'demo', panels: ['dashboard'],
      visibility: 'visible', kind: 'adapter', enabled: true, healthState: 'healthy', healthMarker: 'none'
    }
    const view = {
      groups: [{ category: 'macro', providers: [{ providerId: 'demo', displayName: 'Demo', category: 'macro', credential: 'none', healthMarker: 'none', sources: [source] }] }],
      counts: { total: 1, enabled: 1, pending: 0, failed: 0 }
    }
    const mount = async (filter: string): Promise<HTMLElement> => {
      const host = document.createElement('div')
      document.body.append(host)
      root = createRoot(host)
      await act(async () => root!.render(createElement(SettingsSourceTree, {
        filter: filter as never,
        labels: { title: 'Sources', categories: {} as never, providerNames: {}, unavailableCountOne: '含 {count} 个不可用的源', unavailableCountOther: '含 {count} 个不可用的源' },
        onFilterChange,
        onSelectProvider: vi.fn(),
        selectedProviderId: undefined,
        view: view as never
      })))
      await act(async () => { await Promise.resolve() })
      return host
    }

    // 六项、同一时刻只有一项 aria-pressed；不再是平台的 Segmented 分组。
    const host = await mount('all')
    const group = host.querySelector<HTMLElement>('.intelligence-catalog-filters [role="group"]')
    expect(group).not.toBeNull()
    const chips = [...(group?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    expect(chips).toHaveLength(6)
    expect(chips.filter((chip) => chip.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
    // 「全部」不套平铺，行照旧（行 DOM 不动）。
    expect(host.querySelector('.intelligence-catalog-list--tiles')).toBeNull()
    expect(host.querySelectorAll('.intelligence-provider-row')).toHaveLength(1)
    await act(async () => { chips[2]?.click() })
    expect(onFilterChange).toHaveBeenCalledWith('dashboard')

    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()

    // 看板那一档自动平铺：容器换成网格，行 DOM 不变（行还在、还是同一个 class）。
    const tiled = await mount('dashboard')
    const list = tiled.querySelector<HTMLElement>('.intelligence-catalog-list')
    expect(list?.getAttribute('data-list-mode')).toBe('tiles')
    expect(list?.className).toContain('intelligence-catalog-list--tiles')
  })

})
