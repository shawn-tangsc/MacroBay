// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { calendarFeedRegistry } from '../../../service/intelligence/macro-calendar/calendarFeedRegistry'

import { SettingsSourceTree } from './SettingsSourceTree'

const text = productText['zh-CN'].settings.intelligenceSources

let root: ReturnType<typeof createRoot> | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

/**
 * 「日历」那一屏的分组判据：`calendarFeedRegistry` 的 `owner`——官方源 / 聚合源。
 *
 * 不在组件里写源 id、源名，也不手抄一张 id→组 的表：Fed / BEA / BLS 是 `official`，
 * 0xRouter 三条是 `market`，CoinMarketCal 是 `pending`（它只是还没接入，仍是聚合商）。
 */
function source(sourceId: string, kind: 'official-calendar' | 'market-calendar') {
  return {
    sourceId,
    displayName: sourceId,
    providerId: sourceId.split('-')[1] ?? 'p',
    panels: ['economic-calendar'],
    visibility: 'visible',
    kind,
    enabled: true,
    healthState: 'healthy',
    healthMarker: 'none'
  }
}

function provider(providerId: string, sourceIds: ReadonlyArray<string>, kind: 'official-calendar' | 'market-calendar') {
  return {
    providerId,
    displayName: providerId,
    category: 'macro',
    credential: 'none',
    healthMarker: 'none',
    sources: sourceIds.map((sourceId) => source(sourceId, kind))
  }
}

/** 真实日历源：三个官方、三条 0xRouter、CoinMarketCal 一条。 */
function calendarView() {
  return {
    groups: [{
      category: 'macro',
      providers: [
        provider('fed', ['macro-calendar-fed'], 'official-calendar'),
        provider('bea', ['macro-calendar-bea'], 'official-calendar'),
        provider('bls', ['macro-calendar-bls'], 'official-calendar'),
        provider('0xrouter', [
          'macro-calendar-0xrouter-economic-data',
          'macro-calendar-0xrouter-financial-events',
          'macro-calendar-0xrouter-central-bank-activities'
        ], 'market-calendar'),
        provider('coinmarketcal', ['macro-calendar-coinmarketcal'], 'market-calendar')
      ]
    }],
    counts: { total: 7, enabled: 7, pending: 0, failed: 0 }
  }
}

async function render(filter: 'all' | 'calendar' | 'dashboard'): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(SettingsSourceTree, {
    filter,
    labels: {
      title: 'Sources',
      categories: { macro: '宏观', crypto: '加密市场', aggregate: '聚合数据供应商' } as never,
      providerNames: {},
      providerSummary: '{total}/{enabled}',
      unavailableCountOne: '含 {count} 个不可用的源',
      unavailableCountOther: '含 {count} 个不可用的源'
    },
    onFilterChange: vi.fn(),
    onSelectProvider: vi.fn(),
    selectedProviderId: undefined,
    view: calendarView() as never
  })))
  await act(async () => { await Promise.resolve() })
  return host
}

function groupTitles(host: HTMLElement): string[] {
  return [...host.querySelectorAll<HTMLElement>('.intelligence-catalog-group-title')].map((node) => node.textContent ?? '')
}

function providerIdsIn(host: HTMLElement, title: string): string[] {
  const group = [...host.querySelectorAll<HTMLElement>('.intelligence-catalog-group')]
    .find((node) => node.querySelector('.intelligence-catalog-group-title')?.textContent === title)
  if (group === undefined) return []
  return [...group.querySelectorAll<HTMLElement>('.intelligence-provider-row')]
    .map((row) => row.querySelector('strong')?.textContent ?? '')
}

describe('the calendar filter groups by feed owner', () => {
  it('draws exactly two groups: official sources and aggregators', async () => {
    const host = await render('calendar')

    expect(groupTitles(host)).toEqual([text.calendarGroups.official, text.calendarGroups.aggregate])
    // 官方源：Fed / BEA / BLS 三条。
    expect(providerIdsIn(host, text.calendarGroups.official).sort()).toEqual(['bea', 'bls', 'fed'])
    // 聚合源：0xRouter 三条能力 + CoinMarketCal（pending 也是聚合商，不单独开组、也不藏）。
    expect(providerIdsIn(host, text.calendarGroups.aggregate).sort()).toEqual(['0xrouter', 'coinmarketcal'])
  })

  it('moves a feed between groups when its owner changes, so the grouping is not hard-coded', async () => {
    // 反向实测：把一条 `market` 的 feed 的 owner 临时改成 `official`，它必须出现在官方源下。
    const feedId = 'macro-calendar-0xrouter-economic-data'
    const entry = calendarFeedRegistry[feedId] as { owner: string }
    const original = entry.owner
    entry.owner = 'official'
    try {
      const host = await render('calendar')
      expect(providerIdsIn(host, text.calendarGroups.official)).toContain('0xrouter')
    } finally {
      entry.owner = original
    }
  })

  it('keeps the three categories on 「全部」 and flattens every other filter', async () => {
    const all = await render('all')
    expect(groupTitles(all)).toEqual(['宏观'])

    const dashboard = await render('dashboard')
    // 看板这一面平铺：没有分组标题（模块分组等产品的模块清单，不在这里先猜）。
    expect(groupTitles(dashboard)).toEqual([])
  })
})

/**
 * 看板页签按**模块**分组（清单：`dashboard-modules-by-panel-2026-11-10.md`）。
 * 判据：看板页签的源集合 = 各模块挂的源 ∪ 「AI 分析用」那 4 个；维护备用 / 未接入一个都不许出现。
 */
describe('the dashboard filter groups by module', () => {
  const MODULE_SOURCES = ['binance-futures-positioning', 'realmarketapi-market', 'twelve-data-market', 'policy-path-market',
    'alternative-fear-greed', 'defillama-stablecoins', '0xrouter-aggregate-provider', 'macro-calendar-fed',
    'macro-calendar-bea', 'macro-calendar-bls', 'macro-calendar-0xrouter-economic-data',
    'macro-calendar-0xrouter-financial-events', 'macro-calendar-0xrouter-central-bank-activities',
    'fred-rates-liquidity', 'sec-rss', 'coindesk-rss', 'binance-announcements', 'okx-latest-announcements']
  const ANALYSIS_ONLY = ['binance-spot-market', 'okx-api-announcements', 'coingecko-market', 'defillama-tvl']
  const MAINTENANCE = ['federal-reserve-rss', 'cftc-rss', 'github-releases']

  function viewWith(ids: readonly string[]) {
    return {
      groups: [{
        category: 'macro',
        providers: ids.map((id) => ({
          providerId: `p-${id}`,
          displayName: id,
          category: 'macro',
          credential: 'none',
          healthMarker: 'none',
          sources: [{
            sourceId: id, displayName: id, providerId: `p-${id}`, panels: ['dashboard'], visibility: 'visible',
            kind: 'feed', enabled: true, healthState: 'healthy', healthMarker: 'none'
          }]
        }))
      }],
      counts: { total: ids.length, enabled: ids.length, pending: 0, failed: 0 }
    }
  }

  async function renderDashboard(ids: readonly string[]): Promise<HTMLElement> {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(SettingsSourceTree, {
      filter: 'dashboard',
      labels: {
        title: 'Sources',
        categories: { macro: '宏观' } as never,
        providerNames: {},
        providerSummary: '{total}/{enabled}',
        unavailableCountOne: '含 {count} 个不可用的源',
        unavailableCountOther: '含 {count} 个不可用的源'
      },
      onFilterChange: vi.fn(),
      onSelectProvider: vi.fn(),
      selectedProviderId: undefined,
      view: viewWith(ids) as never
    })))
    await act(async () => { await Promise.resolve() })
    return host
  }

  it('shows the module groups plus a trailing 「AI 分析用」 group, and nothing else', async () => {
    const host = await renderDashboard([...MODULE_SOURCES, ...ANALYSIS_ONLY, ...MAINTENANCE])
    const titles = groupTitles(host)
    expect(titles).toContain('AI 分析用')
    expect(titles).not.toContain('宏观')
    // 维护备用源一个都不许出现在看板页签里。
    const shown = [...host.querySelectorAll<HTMLElement>('.intelligence-provider-row strong')].map((node) => node.textContent ?? '')
    for (const id of MAINTENANCE) expect(shown).not.toContain(id)
    // 「AI 分析用」那一组恰好那 4 个。
    expect(providerIdsIn(host, 'AI 分析用').sort()).toEqual([...ANALYSIS_ONLY].sort())
    // 共用源按模块重复出现：合并「跨资产」后，`binance-futures-positioning` 在 3 个模块下各一次。
    expect(shown.filter((name) => name === 'binance-futures-positioning')).toHaveLength(3)
  })

  it('drops a source from the module group when the mapping no longer lists it', async () => {
    // 反向：模块的源清单是数据，不是写死的渲染顺序——把一个源从清单里去掉，它就不在那个组下。
    const host = await renderDashboard(['unmapped-source'])
    const titles = groupTitles(host)
    // 没有模块用到它 → 看板页签里没有它的组（也不会按「其他」兜底塞进来）。
    expect(providerIdsIn(host, titles[0] ?? '')).not.toContain('unmapped-source')
  })
})
