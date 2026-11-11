// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { cellIdOf, modulesForBusiness } from './dashboardSourceModules'
import { SourcesSettingsPane } from './SourcesSettingsPane'

/**
 * `focus.sourcesData` 的判据：入口说了「采集与数据」的哪一项，抽屉就停在哪一项上。
 *
 * 为什么需要：日历、舆情、资金面那几格的入口原先把 `'calendar'` 当**筛选**传下来，而抽屉那屏
 * 不看筛选——四个入口全停在「看板」第一屏，读者点了 A 停在 B，还得自己在左列再点一次。
 *
 * 三条：
 * 1. 给了 `business` → 左列那一项选中、内容区就是那一项（`data-business-content`）；
 * 2. 给了 `cellId` / `moduleKey` → 滚到那个锚点一次并给它 `data-focused`（锚点由组件自己写在行上）；
 * 3. 锚点找不到 → 不滚、不标记、不抛错，但**业务照样切过去**（有一半命中就是一半有用）。
 */
const t = productText['zh-CN'].settings.intelligenceSources

const view = {
  groups: [{
    category: 'macro',
    providers: [{
      providerId: 'p1', displayName: 'RealMarketAPI', category: 'macro', credential: 'none', healthMarker: 'none',
      sources: [{
        sourceId: 'realmarketapi-market', providerId: 'p1', displayName: 'RealMarketAPI', agents: [], panels: ['dashboard'],
        visibility: 'visible', collection: 'adapter', kind: 'feed', capabilities: {}, readiness: 'live',
        enabled: true, healthState: 'healthy', healthMarker: 'none'
      }]
    }]
  }],
  counts: { total: 1, enabled: 1, pending: 0, failed: 0 }
} as never

/** 锚点从注册表算，不写死 id：模块/格改了名，这条用例跟着走，不用改测试。 */
const module0 = modulesForBusiness('dashboard')[0]!
const cell0 = module0.cells[0]!

let root: ReturnType<typeof createRoot> | undefined
let scrolled: HTMLElement[] = []
let scrollSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  scrolled = []
  scrollSpy = vi.fn(function (this: HTMLElement) { scrolled.push(this) })
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollSpy })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
})

async function render(position?: { business?: 'dashboard' | 'calendar' | 'sentiment'; moduleKey?: string; cellId?: string }): Promise<HTMLElement> {
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
        pane: 'business',
        surface: {
          text: t,
          onDraftChange: vi.fn(),
          onRunNow: async () => undefined,
          onToggleSource: async () => true,
          policy: { labels: t.collectionPolicy, onChange: vi.fn(), profiles: {} },
          showSourceDetails: true
        } as never,
        treeLabels: {
          title: t.title,
          categories: t.sourceCategories,
          providerNames: t.providerNames,
          unavailableCountOne: t.unavailableCountOne,
          unavailableCountOther: t.unavailableCountOther
        } as never,
        ...(position === undefined ? {} : { initialBusinessPosition: position }),
        view
      } as never)
    }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return host
}

function selectedBusiness(host: HTMLElement): string | null {
  return host.querySelector('[aria-current="true"]')?.textContent ?? null
}

describe('focus.sourcesData 落到那一项', () => {
  it('switches the left column to the business the entry asked for', async () => {
    const host = await render({ business: 'calendar' })
    expect(host.querySelector('[data-business-content="calendar"]')).not.toBeNull()
    expect(selectedBusiness(host)).toContain(t.businessTabs.calendar)
    // 没带锚点时一次都不滚：切业务不等于「把某个东西滚到眼前」。
    expect(scrollSpy).not.toHaveBeenCalled()
  })

  it('scrolls to the cell and marks it', async () => {
    const host = await render({ business: 'dashboard', moduleKey: module0.id, cellId: cellIdOf(module0.id, cell0) })
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect(scrolled[0]?.getAttribute('data-cell-id')).toBe(cellIdOf(module0.id, cell0))
    const marked = [...host.querySelectorAll<HTMLElement>('[data-focused="true"]')]
    expect(marked).toHaveLength(1)
    expect(marked[0]?.getAttribute('data-cell-id')).toBe(cellIdOf(module0.id, cell0))
  })

  it('falls back to the module card when only a module was named', async () => {
    const host = await render({ business: 'dashboard', moduleKey: module0.id })
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect(scrolled[0]?.getAttribute('data-business-card')).toBe(module0.id)
    expect(host.querySelectorAll('[data-focused="true"]')).toHaveLength(1)
  })

  it('does not scroll or mark when the cell is gone, and still switches the business', async () => {
    const host = await render({ business: 'sentiment', cellId: 'no-such-cell' })
    expect(scrollSpy).not.toHaveBeenCalled()
    expect(host.querySelector('[data-focused]')).toBeNull()
    expect(host.querySelector('[data-business-content="sentiment"]')).not.toBeNull()
  })
})
