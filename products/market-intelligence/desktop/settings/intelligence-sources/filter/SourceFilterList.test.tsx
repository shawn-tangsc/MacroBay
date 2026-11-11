// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { SourceFilterList, type SourceFilterListText, type SourceFilterItem } from './SourceFilterList'

const text: SourceFilterListText = {
  filters: { all: '全部', calendar: '日历', dashboard: '看板', sentiment: '舆情', pending: '待接入', advanced: '进阶' },
  filterGroupLabel: '来源筛选', grouped: '分组', tiles: '平铺', layoutGroupLabel: '布局',
  emptyTitle: '没有匹配的来源', emptyBody: '换个筛选试试。', clear: '清除筛选'
}

const items: SourceFilterItem[] = [
  { id: 'cal', name: '经济日历', status: '已启用', tabs: ['calendar'] },
  { id: 'dash', name: 'Binance 持仓', status: '已启用', tabs: ['dashboard'] },
  { id: 'news', name: '快讯', status: '未启用', tabs: ['sentiment'] }
]

let root: Root | undefined
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren() })

function render(list = items): HTMLDivElement {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => { root!.render(<SourceFilterList items={list} text={text} />) })
  return host
}

function click(host: HTMLElement, label: string): void {
  const button = [...host.querySelectorAll('button')].find((entry) => entry.textContent === label)!
  act(() => button.click())
}

describe('C5 来源列表', () => {
  it('shows exactly one block for each of the six filters', () => {
    const host = render()
    for (const [label, expected] of [['日历', ['cal']], ['看板', ['dash']], ['舆情', ['news']], ['待接入', []], ['进阶', []]] as const) {
      click(host, label)
      const ids = [...host.querySelectorAll('[data-source-id]')].map((node) => node.getAttribute('data-source-id'))
      expect(ids, label).toEqual([...expected])
    }
    click(host, '全部')
    expect(host.querySelectorAll('[data-source-id]')).toHaveLength(3)
  })

  it('switches to tiles automatically for the dashboard filter', () => {
    const host = render()
    click(host, '看板')
    expect(host.querySelector('.source-filter-list__tiles') ?? host.querySelector('.source-filter-list__tile')).not.toBeNull()
    expect(host.querySelector('.source-filter-list__mode[aria-pressed="true"]')?.textContent).toBe('平铺')
  })

  it('renders one clear action in the empty state', () => {
    const host = render()
    click(host, '待接入')
    expect(host.querySelector('.source-filter-list__empty')).not.toBeNull()
    const clears = [...host.querySelectorAll('button')].filter((button) => button.textContent === text.clear)
    expect(clears).toHaveLength(1)
  })
})
