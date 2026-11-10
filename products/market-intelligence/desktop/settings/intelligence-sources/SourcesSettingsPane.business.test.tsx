// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { SourcesSettingsPane } from './SourcesSettingsPane'

const t = productText['zh-CN'].settings.intelligenceSources
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

const view = {
  groups: [{
    category: 'macro',
    providers: [{
      providerId: 'p1', displayName: 'RealMarketAPI', category: 'macro', credential: 'api-key', healthMarker: 'none',
      sources: [{
        sourceId: 'realmarketapi-market', providerId: 'p1', displayName: 'RealMarketAPI', agents: [], panels: ['dashboard'],
        visibility: 'visible', collection: 'adapter', kind: 'feed', capabilities: { testConnection: true }, readiness: 'live',
        enabled: true, healthState: 'healthy', healthMarker: 'none'
      }]
    }]
  }],
  counts: { total: 1, enabled: 1, pending: 0, failed: 0 }
} as never

async function render(filter: 'all' | 'dashboard'): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(SourcesSettingsPane, {
        filter,
        onFilterChange: vi.fn(),
        onSelectProvider: vi.fn(),
        surface: {
          text: t,
          onDraftChange: vi.fn(),
          onRunNow: async () => undefined,
          onToggleSource: async () => true,
          policy: { labels: t.collectionPolicy, onChange: vi.fn(), profiles: {}, supportsSentimentById: {} },
          showSourceDetails: true
        } as never,
        treeLabels: {
          title: t.title,
          categories: t.sourceCategories,
          providerNames: t.providerNames,
          providerSummary: t.providerSummary,
          unavailableCountOne: t.unavailableCountOne,
          unavailableCountOther: t.unavailableCountOther
        } as never,
        view
      })
    }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return host
}

describe('SourcesSettingsPane：业务设置不是情报源那套', () => {
  it('renders business rows and no source detail at all', async () => {
    const host = await render('dashboard')
    const text = host.textContent ?? ''
    // 业务设置：源级详情一个都不许出现。
    expect(host.querySelectorAll('h2')).toHaveLength(0)
    expect(text).not.toContain(t.testConnection)
    expect(text).not.toContain(t.apiKey.label)
    // 第二栏必须出现三项。
    for (const label of [t.businessTabs.dashboard, t.businessTabs.calendar, t.businessTabs.sentiment]) {
      expect(text).toContain(label)
    }
  })

  it('keeps the sources tree + detail on the 情报源 tab', async () => {
    const host = await render('all')
    expect(host.querySelector('aside.intelligence-catalog-pane')).not.toBeNull()
  })
})

describe('骨架：页签条只渲染一次', () => {
  it('keeps the same tablist node across a tab switch', async () => {
    // 用户 2026-11-11：「tab 一切你整个重做了」。判据是**同一 DOM 节点**：抓引用 → 切一次 → 断言仍在文档且引用相等。
    function Host(): React.ReactElement {
      const [filter, setFilter] = useState<'all' | 'dashboard'>('all')
      return createElement(ShellLanguageProvider, { language: 'zh-CN', children: createElement(SourcesSettingsPane, {
        filter,
        onFilterChange: (next) => setFilter(next === 'dashboard' ? 'dashboard' : 'all'),
        onSelectProvider: vi.fn(),
        surface: {
          text: t,
          onDraftChange: vi.fn(),
          onRunNow: async () => undefined,
          onToggleSource: async () => true,
          policy: { labels: t.collectionPolicy, onChange: vi.fn(), profiles: {}, supportsSentimentById: {} },
          showSourceDetails: true
        } as never,
        treeLabels: {
          title: t.title,
          categories: t.sourceCategories,
          providerNames: t.providerNames,
          providerSummary: t.providerSummary,
          unavailableCountOne: t.unavailableCountOne,
          unavailableCountOther: t.unavailableCountOther
        } as never,
        view
      }) })
    }
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(Host)))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    const tablist = host.querySelector<HTMLElement>('.intelligence-catalog-filters [role="group"]')
    expect(tablist).not.toBeNull()
    const businessTab = [...host.querySelectorAll<HTMLButtonElement>('.intelligence-catalog-filters button')]
      .find((button) => button.textContent === t.businessTabs.dashboard || button.textContent === t.sourceFilters.dashboard)
    expect(businessTab).not.toBeUndefined()
    await act(async () => { businessTab!.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    // 同一个节点：仍在文档里、引用相等（重挂载会换成新节点）。
    const after = host.querySelector<HTMLElement>('.intelligence-catalog-filters [role="group"]')
    expect(after).not.toBeNull()
    expect(after).toBe(tablist)
    expect(tablist!.isConnected).toBe(true)
  })
})

describe('格级开关接存储（注入 IO）', () => {
  function hostWith(io: { read: () => Promise<Record<string, boolean>>; write: (cellId: string, enabled: boolean) => Promise<void> }) {
    function Host(): React.ReactElement {
      const [filter] = useState<'dashboard'>('dashboard')
      return createElement(ShellLanguageProvider, { language: 'zh-CN', children: createElement(SourcesSettingsPane, {
        cellEnabledIo: io,
        filter,
        onFilterChange: vi.fn(),
        onSelectProvider: vi.fn(),
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
        view
      }) })
    }
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    return { host }
  }

  it('reads the saved value on mount and writes through on toggle', async () => {
    const writes: Array<[string, boolean]> = []
    const io = {
      read: async () => ({ 'quotes:ndx': false }),
      write: async (cellId: string, enabled: boolean) => { writes.push([cellId, enabled]) }
    }
    const { host } = hostWith(io)
    await act(async () => root!.render(createElement(ShellLanguageProvider, { language: 'zh-CN', children: createElement('div') })))
    // 用真实 Host 重渲染
    await act(async () => { root!.render(createElement(function Real(): React.ReactElement {
      return createElement(ShellLanguageProvider, { language: 'zh-CN', children: createElement(SourcesSettingsPane, {
        cellEnabledIo: io,
        filter: 'dashboard',
        onFilterChange: vi.fn(),
        onSelectProvider: vi.fn(),
        surface: { text: t, onDraftChange: vi.fn(), onRunNow: async () => undefined, onToggleSource: async () => true, policy: { labels: t.collectionPolicy, onChange: vi.fn(), profiles: {}, supportsSentimentById: {} }, showSourceDetails: true } as never,
        treeLabels: { title: t.title, categories: t.sourceCategories, providerNames: t.providerNames, providerSummary: t.providerSummary, unavailableCountOne: t.unavailableCountOne, unavailableCountOther: t.unavailableCountOther } as never,
        view
      }) })
    })) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    const ndx = host.querySelector<HTMLElement>('[data-cell-id="quotes:ndx"]')
    expect(ndx).not.toBeNull()
    // 读回来是关的 → 该行次要化、开关打开状态为关。
    expect(ndx?.getAttribute('data-cell-enabled')).toBe('false')
    const control = ndx?.querySelector<HTMLElement>('[role="switch"]')
    expect(control?.getAttribute('aria-checked')).toBe('false')
    // 拨回来 → 写穿到注入的 IO（不再「先读再比」）。
    await act(async () => { control?.click() })
    expect(writes).toContainEqual(['quotes:ndx', true])
  })

  it('falls back to the row defaults when the read fails', async () => {
    const io = { read: async (): Promise<Record<string, boolean>> => { throw new Error('unreadable') }, write: async () => undefined }
    const { host } = hostWith(io)
    await act(async () => { root!.render(createElement(function Real(): React.ReactElement {
      return createElement(ShellLanguageProvider, { language: 'zh-CN', children: createElement(SourcesSettingsPane, {
        cellEnabledIo: io,
        filter: 'dashboard',
        onFilterChange: vi.fn(),
        onSelectProvider: vi.fn(),
        surface: { text: t, onDraftChange: vi.fn(), onRunNow: async () => undefined, onToggleSource: async () => true, policy: { labels: t.collectionPolicy, onChange: vi.fn(), profiles: {}, supportsSentimentById: {} }, showSourceDetails: true } as never,
        treeLabels: { title: t.title, categories: t.sourceCategories, providerNames: t.providerNames, providerSummary: t.providerSummary, unavailableCountOne: t.unavailableCountOne, unavailableCountOther: t.unavailableCountOther } as never,
        view
      }) })
    })) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    // 读失败 = 不知道读者存过什么：按行默认——主源开、备用行关（不是「全关」，也不是「全开」）。
    const rows = [...host.querySelectorAll<HTMLElement>('[data-cell-id]')]
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const fallback = row.getAttribute('data-cell-id')?.endsWith('-fallback') === true
      expect(row.getAttribute('data-cell-enabled')).toBe(fallback ? 'false' : 'true')
    }
  })
})

describe('卡片行：源名做标签 / 同一格的候选源互斥', () => {
  async function renderDashboard(io: {
    read: () => Promise<Record<string, boolean>>
    write: (cellId: string, enabled: boolean) => Promise<void>
  }): Promise<HTMLElement> {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(createElement(ShellLanguageProvider, {
        language: 'zh-CN',
        children: createElement(SourcesSettingsPane, {
          cellEnabledIo: io,
          filter: 'dashboard',
          onFilterChange: vi.fn(),
          onSelectProvider: vi.fn(),
          surface: { text: t, onDraftChange: vi.fn(), onRunNow: async () => undefined, onToggleSource: async () => true, policy: { labels: t.collectionPolicy, onChange: vi.fn(), profiles: {}, supportsSentimentById: {} }, showSourceDetails: true } as never,
          treeLabels: { title: t.title, categories: t.sourceCategories, providerNames: t.providerNames, providerSummary: t.providerSummary, unavailableCountOne: t.unavailableCountOne, unavailableCountOther: t.unavailableCountOther } as never,
          view
        })
      }))
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    return host
  }

  it('labels a row with the source name and wraps candidates of one cell into a sub-card', async () => {
    const host = await renderDashboard({ read: async () => ({}), write: async () => undefined })
    // 行标签是**源名**（用户 2026-11-11），不再是格名。
    const usd = host.querySelector<HTMLElement>('[data-cell-id="quotes:usd"]')
    expect(usd?.textContent).toBe(t.sourceNames['realmarketapi-market'])
    // 两层卡片：第一层模块卡，第二层「数据卡片」——一个格一张，卡头是格名。
    const group = host.querySelector<HTMLElement>('[data-business-cell-card="usd"]')
    expect(group).not.toBeNull()
    expect(group!.querySelectorAll('[data-cell-id]')).toHaveLength(2)
    expect(group!.querySelector('.business-cell__title')?.textContent).toBe('美元')
    // 单候选的格也是一张数据卡片（卡头是格名），只是里面只有一行。
    const single = host.querySelector<HTMLElement>('[data-business-cell-card="ndx"]')
    expect(single).not.toBeNull()
    expect(single!.querySelectorAll('[data-cell-id]')).toHaveLength(1)
    expect(single!.querySelector('.business-cell__title')?.textContent).toBe('纳指')
  })

  it('keeps one source per cell: enabling the fallback turns the primary off in the same event', async () => {
    const writes: Array<[string, boolean]> = []
    const host = await renderDashboard({ read: async () => ({}), write: async (cellId, enabled) => { writes.push([cellId, enabled]) } })
    const fallback = host.querySelector<HTMLElement>('[data-cell-id="quotes:usd-fallback"] [role="switch"]')
    expect(fallback).not.toBeNull()
    await act(async () => { fallback!.click() })
    // 互斥：先关同组其它源，再开这一个；顺序固定，不留同时开着的中间态。
    expect(writes).toEqual([['quotes:usd', false], ['quotes:usd-fallback', true]])
  })

  it('lets both sources of one cell be off without writing a selection', async () => {
    const writes: Array<[string, boolean]> = []
    const host = await renderDashboard({ read: async () => ({}), write: async (cellId, enabled) => { writes.push([cellId, enabled]) } })
    await act(async () => { host.querySelector<HTMLElement>('[data-cell-id="quotes:usd-fallback"] [role="switch"]')!.click() })
    writes.length = 0
    await act(async () => { host.querySelector<HTMLElement>('[data-cell-id="quotes:usd-fallback"] [role="switch"]')!.click() })
    // 全关 = 两个都 false；这一轮不写 selection（null 在存储里是删键 = 回落默认主源）。
    expect(writes).toEqual([['quotes:usd-fallback', false]])
    expect(host.querySelector('[data-business-cell-card="usd"]')?.getAttribute('data-cell-thin')).toBe('true')
  })
})
