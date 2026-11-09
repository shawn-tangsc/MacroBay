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
        kind: 'adapter', enabled: true, healthState: entry.state,
        ...(entry.unavailable === true ? { unavailable: { reasonCode: 'official-endpoint-returned-403', automaticSync: 'stopped', decidedAt: '2026-11-09' } } : {})
      }
      const view = {
        groups: [{
          category: 'macro',
          providers: [{ providerId: 'demo', displayName: 'Demo', category: 'macro', credential: 'none', sources: [source] }]
        }],
        counts: { total: 1, enabled: 1, pending: 0, failed: 0 }
      }
      await act(async () => root!.render(createElement(SettingsSourceTree, {
        filter: 'all',
        labels: { title: 'Sources', categories: {} as never, providerNames: {}, providerSummary: '{total}/{enabled}' },
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

  it('does not call an unsettled read "filtered out"', async () => {
    // 空数组的 `every` 恒真：`view` 还没到时会画成「筛选后没有来源」+「清除筛选」。
    // 未结算不是被筛掉了——任何提前渲染的调用点都会立刻误导。
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(SettingsSourceTree, {
      filter: 'calendar',
      labels: { title: 'Sources', categories: {} as never, providerNames: {}, providerSummary: '{total}/{enabled}' },
      onFilterChange: vi.fn(),
      onSelectProvider: vi.fn(),
      selectedProviderId: undefined,
      view: undefined
    })))
    await act(async () => { await Promise.resolve() })

    expect(host.querySelector('[data-state="empty"]')).toBeNull()
  })
})
