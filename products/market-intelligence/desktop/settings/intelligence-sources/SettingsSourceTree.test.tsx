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
