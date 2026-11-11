// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { SourcesSettingsPane } from './SourcesSettingsPane'

/**
 * `focus.sourceId` 在**挂载处**的判据：这一屏已经选中了某个供应商，入口再指一个源进来时，
 * 不许把选中挪走。
 *
 * 为什么不在 `ProviderDetail` 里断：那一层只画给它一个 provider，没有「选中」可言。
 * 选中态在 `SettingsSourceTree` 的 `aria-current` 上，只有把树与详情一起挂起来才断得到。
 *
 * 三条：
 * 1. 指的源不在这棵树里 → `aria-current` 仍是原来那个供应商、不滚、不标记、不抛错；
 * 2. 指的源在 → 滚到那一行并标记，**选中还是原来那个**（定位不等于切换）；
 * 3. 不透传 = 上面第 2 条会红（`ProviderDetail.focusSource.test.tsx` 已对那一段做过红证）。
 */
const t = productText['zh-CN'].settings.intelligenceSources

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
  Reflect.deleteProperty(window, 'platform')
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
})

const source = (sourceId: string, providerId: string, displayName: string) => ({
  sourceId, providerId, displayName, agents: [], panels: ['dashboard'],
  visibility: 'visible', collection: 'adapter', kind: 'feed', capabilities: {}, readiness: 'live',
  enabled: true, healthState: 'healthy', healthMarker: 'none'
})

const view = {
  groups: [{
    category: 'macro',
    providers: [
      {
        providerId: 'p1', displayName: 'RealMarketAPI', category: 'macro', credential: 'none', healthMarker: 'none',
        sources: [source('realmarketapi-market', 'p1', 'RealMarketAPI')]
      },
      {
        providerId: 'p2', displayName: 'Ethereum Foundation', category: 'macro', credential: 'none', healthMarker: 'none',
        sources: [source('ethereum-foundation-blog', 'p2', 'Ethereum Foundation')]
      }
    ]
  }],
  counts: { total: 2, enabled: 2, pending: 0, failed: 0 }
} as never

async function render(initialSourceId: string): Promise<HTMLElement> {
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke: vi.fn(async () => undefined) } }
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
        // 读者已经在看 p2：入口带进来的源只决定「滚哪一行」，不决定「选哪个供应商」。
        selectedProviderId: 'p2',
        surface: {
          text: t,
          initialSourceId,
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
        view
      } as never)
    }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return host
}

describe('focus.sourceId 不改选中', () => {
  it('leaves the selected provider alone and does not scroll when the source is missing', async () => {
    const host = await render('no-such-source')
    expect(scrollSpy).not.toHaveBeenCalled()
    expect(host.querySelector('[data-focused]')).toBeNull()
    const current = [...host.querySelectorAll<HTMLElement>('[aria-current="true"]')]
    expect(current).toHaveLength(1)
    expect(current[0]?.textContent).toContain('Ethereum Foundation')
  })

  it('scrolls to the row and marks it while the selection stays where it was', async () => {
    const host = await render('ethereum-foundation-blog')
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect(scrolled[0]?.getAttribute('data-source-row')).toBe('ethereum-foundation-blog')
    expect(host.querySelectorAll('[data-focused="true"]')).toHaveLength(1)
    const current = [...host.querySelectorAll<HTMLElement>('[aria-current="true"]')]
    expect(current).toHaveLength(1)
    expect(current[0]?.textContent).toContain('Ethereum Foundation')
  })
})
