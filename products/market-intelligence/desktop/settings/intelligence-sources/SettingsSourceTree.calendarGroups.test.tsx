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
