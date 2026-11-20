// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { allSources } from '../../../service/intelligence/application/providerRegistry'
import { productText } from '../../shared/i18n/productText'
import { SettingsSourceTree } from './SettingsSourceTree'

/**
 * 「哪些数据源要经代理」的黄色 `VPN` 标签（读者 2026-11-12）。
 *
 * 判据全在数据层：源在注册表里声明了 `requiresProxy`，供应商行就标；**常显**，不看读者配没配代理
 * ——那件事是另一颗药丸（`sourceBadges.proxy`），两者不是同一个意思。
 */
const t = productText['zh-CN'].settings.intelligenceSources
const en = productText['en-US'].settings.intelligenceSources
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

async function renderTree(sources: ReadonlyArray<Record<string, unknown>>): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(SettingsSourceTree, {
    filter: 'all',
    labels: {
      title: 'Sources', categories: { macro: '宏观' } as never, providerNames: {},
      unavailableCountOne: '{count} 个不可用', unavailableCountOther: '{count} 个不可用'
    },
    onFilterChange: vi.fn(),
    onSelectProvider: vi.fn(),
    selectedProviderId: undefined,
    view: {
      groups: [{
        category: 'macro',
        providers: [{
          providerId: 'binance', displayName: 'Binance', category: 'macro', credential: 'none', healthMarker: 'none',
          sources: sources.map((item, index) => src(String(item.sourceId ?? `s${index}`), item))
        }]
      }],
      counts: { total: sources.length, enabled: 0, pending: 0, failed: 0 }
    } as never
  })))
  return host
}

/** 多供应商版本：一次渲染里同时钉住「该标的」和「不该标的」。 */
async function renderProviders(groups: ReadonlyArray<{ providerId: string; sources: ReadonlyArray<Record<string, unknown>> }>): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(SettingsSourceTree, {
    filter: 'all',
    labels: {
      title: 'Sources', categories: { macro: '宏观' } as never, providerNames: {},
      unavailableCountOne: '{count} 个不可用', unavailableCountOther: '{count} 个不可用'
    },
    onFilterChange: vi.fn(),
    onSelectProvider: vi.fn(),
    selectedProviderId: undefined,
    view: {
      groups: [{
        category: 'macro',
        providers: groups.map((group) => ({
          providerId: group.providerId, displayName: group.providerId, category: 'macro', credential: 'none', healthMarker: 'none',
          sources: group.sources.map((item, index) => src(String(item.sourceId ?? `s${index}`), item))
        }))
      }],
      counts: { total: groups.reduce((sum, group) => sum + group.sources.length, 0), enabled: 0, pending: 0, failed: 0 }
    } as never
  })))
  return host
}

/** 注册表里这条源的真实 `requiresProxy`（用例读数据，不自己写死布尔）。 */
const proxyOf = (sourceId: string): boolean | undefined =>
  allSources().find((source) => source.sourceId === sourceId)?.requiresProxy

function rowOf(host: HTMLElement, displayName: string): HTMLElement | null {
  for (const row of [...host.querySelectorAll<HTMLElement>('.intelligence-provider-row')]) {
    if (row.querySelector('strong')?.textContent === displayName) return row
  }
  return null
}

const tagOf = (host: HTMLElement): HTMLElement | null => host.querySelector<HTMLElement>('.intelligence-proxy-tag')

describe('数据源列表的 VPN 标签', () => {
  it('marks a provider when any of its sources requires a proxy', async () => {
    const host = await renderTree([{ sourceId: 'binance-announcements', requiresProxy: true }])
    const tag = tagOf(host)
    expect(tag?.textContent).toBe(t.proxyTag)
    // 标签在源名后面（同一个标题行，紧挨 strong），不是另起一行的角标。
    expect(tag?.parentElement?.classList.contains('intelligence-provider-title')).toBe(true)
    expect(tag?.previousElementSibling?.tagName).toBe('STRONG')
  })

  it('keeps the provider unmarked when none of its sources needs one', async () => {
    const host = await renderTree([{ sourceId: 'sec-rss', requiresProxy: false }, { sourceId: 'coindesk-rss' }])
    expect(tagOf(host)).toBeNull()
  })

/**
   * Narwhal：2026-11-13 实测直连可用（上海电信出口、无代理，带 key 1.83s 200；不带 key 401），
   * 所以三条源都不该挂 VPN 标签。这条同时钉住两个方向——该有的还在（0xRouter / 币安），
   * 不该没有的没被顺手清掉，也不至于有人凭印象给 Narwhal 加回 `requiresProxy`。
   */
  it('tags the proxy-only sources and leaves Narwhal untagged', async () => {
    const host = await renderProviders([
      { providerId: 'narwhal', sources: ['macro-calendar-narwhal-economic-data', 'macro-calendar-narwhal-financial-events', 'macro-calendar-narwhal-central-bank-activities'].map((sourceId) => ({ sourceId, ...(proxyOf(sourceId) === true ? { requiresProxy: true } : {}) })) },
      { providerId: '0xrouter', sources: [{ sourceId: '0xrouter-aggregate-provider', ...(proxyOf('0xrouter-aggregate-provider') === true ? { requiresProxy: true } : {}) }] },
      { providerId: 'binance', sources: [{ sourceId: 'binance-futures-positioning', ...(proxyOf('binance-futures-positioning') === true ? { requiresProxy: true } : {}) }] }
    ])
    expect(rowOf(host, 'narwhal')?.querySelector('.intelligence-proxy-tag')).toBeNull()
    expect(rowOf(host, '0xrouter')?.querySelector('.intelligence-proxy-tag')?.textContent).toBe(t.proxyTag)
    expect(rowOf(host, 'binance')?.querySelector('.intelligence-proxy-tag')?.textContent).toBe(t.proxyTag)
  })

  it('carries the tag in both languages', async () => {
    const host = await renderTree([{ sourceId: 'binance-announcements', requiresProxy: true }])
    expect(tagOf(host)?.textContent).toBe(t.proxyTag)
    // 两语言同值也要走文案表：写死字面量会被界面红线判不通过。
    expect(en.proxyTag).toBe(t.proxyTag)
  })
})
