// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { resolveProductTextKey } from '../../shared/i18n/productTextKey'

import { BusinessSettingsContent, BusinessSettingsView, type BusinessKey } from './BusinessSettingsView'
import { duplicateCardCells, duplicateCellIds, modulesForBusiness } from './dashboardSourceModules'

const t = productText['zh-CN'].settings.intelligenceSources
const resolveText = (key: string): string => resolveProductTextKey('zh-CN', key)

let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function renderContent(business: BusinessKey): Promise<{ host: HTMLElement }> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(BusinessSettingsContent, {
    business,
    resolveText,
    sourceNames: t.sourceNames
  })))
  return { host }
}

async function render(business: BusinessKey): Promise<{ host: HTMLElement }> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const onSelectSource = vi.fn()
  await act(async () => root!.render(createElement(BusinessSettingsView, {
    business,
    onBusinessChange: vi.fn(),
    resolveText,
    sourceNames: t.sourceNames
  })))
  return { host }
}

describe('业务设置的左列', () => {
  it('uses the source-tree row structure: avatar + title + subtitle + chevron', async () => {
    const { host } = await render('dashboard')
    const rows = [...host.querySelectorAll('.business-settings__nav .intelligence-provider-row')]
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.querySelector('strong')?.textContent)).toEqual(['看板', '日历', '舆情'])
    for (const row of rows) {
      // 与来源树同一套类：头像位、主文字、副标题、右侧 chevron。
      expect(row.querySelector('.intelligence-source-avatar')).not.toBeNull()
      expect(row.querySelector('.intelligence-provider-main small')).not.toBeNull()
      expect(row.querySelector('.intelligence-provider-state svg')).not.toBeNull()
    }
    // 选中态沿用树里的 `selected` + `aria-current`。
    expect(rows[0]?.className).toContain('selected')
    expect(rows[0]?.getAttribute('aria-current')).toBe('true')
  })

  it('writes real counts from the data layer, not hard-coded strings', async () => {
    const { host } = await render('dashboard')
    const subtitles = [...host.querySelectorAll('.business-settings__nav .intelligence-provider-main small')].map((node) => node.textContent)
    expect(subtitles).toEqual([
      `${modulesForBusiness('dashboard').length} 个模块`, // 7
      `${modulesForBusiness('calendar').flatMap((module) => module.sourceIds).length} 个源`, // 6
      `${modulesForBusiness('sentiment').flatMap((module) => module.sourceIds).length} 个源` // 4
    ])
  })

  it('recounts when a source leaves the mapping', async () => {
    // 反向：源数是从数据层算的——把经济日历少挂一个源，副标题立刻从 6 变 5。
    const module = modulesForBusiness('calendar')[0]!
    const original = module.cells
    try {
      ;(module as unknown as { cells: typeof original }).cells = original.slice(1)
      const { host } = await render('dashboard')
      const subtitles = [...host.querySelectorAll('.business-settings__nav .intelligence-provider-main small')].map((node) => node.textContent)
      expect(subtitles[1]).toBe('5 个源')
    } finally {
      ;(module as unknown as { cells: typeof original }).cells = original
    }
  })

  it('splits calendar into 官方源 / 聚合源 cards and keeps sentiment as one card', async () => {
    const calendar = await renderContent('calendar')
    expect(calendar.host.querySelectorAll('.business-card__row')).toHaveLength(6)
    // 日历也走两层卡片：第二层两张数据卡片，标题按注册表的 owner 分。
    const cards = [...calendar.host.querySelectorAll<HTMLElement>('[data-business-cell-card]')]
    expect(cards.map((card) => card.getAttribute('data-business-cell-card'))).toEqual(['official', 'aggregate'])
    expect(cards.map((card) => card.querySelector('.business-cell__title')?.textContent)).toEqual(['官方源', '聚合源'])
    // 官方源那几行要说清它管什么（用户 2026-11-11：看得出 CPI 的官方源、利率的官方源）。
    const official = cards[0]!.textContent ?? ''
    for (const coverage of ['利率决议', 'GDP / PCE', 'CPI / 就业']) expect(official).toContain(coverage)
    // 卡片项是纯行：不是按钮、没有 onClick、点了不导航（用户 2026-11-11 取消点击跳转）。
    for (const row of [...calendar.host.querySelectorAll('.business-card__row')]) {
      expect(row.tagName).not.toBe('BUTTON')
      expect(row.getAttribute('role')).toBeNull()
      expect(row.getAttribute('tabindex')).toBeNull()
    }

    const sentiment = await renderContent('sentiment')
    expect(sentiment.host.querySelectorAll('.business-card__row')).toHaveLength(4)
    // 舆情只有一张第二层卡片，卡头留空（业务名已经在第一层卡头）。
    const sentimentCards = [...sentiment.host.querySelectorAll<HTMLElement>('[data-business-cell-card]')]
    expect(sentimentCards).toHaveLength(1)
    expect(sentimentCards[0]!.querySelector('.business-cell__title')).toBeNull()
    // 「舆情评分」不是源，不添行。
    expect(sentiment.host.textContent).not.toContain('舆情评分')
  })
})

describe('内容区页头与卡片项的行结构', () => {
  it('draws the business title once and no stats line', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(BusinessSettingsContent, {
      business: 'dashboard',
      resolveText,
      sourceNames: t.sourceNames
    })))
    expect(host.querySelectorAll('.intelligence-section-title')).toHaveLength(1)
    expect(host.querySelector('.intelligence-section-title')?.textContent).toBe(t.businessTabs.dashboard)
    // 页面写「共 N 个模块」这类统计就是废话（用户 2026-11-11）：不许出现。
    expect(host.textContent).not.toContain('共')
  })

  it('renders each item as a row labeled with the source name', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(BusinessSettingsContent, {
      business: 'calendar',
      resolveText,
      sourceNames: t.sourceNames
    })))
    const row = host.querySelector('.business-card__row')
    // 行标签是**源名**（用户 2026-11-11）；「格名 / 源名」两列那版已经删掉，只剩一列标签。
    expect(row?.querySelector('.business-card__label')?.textContent).toBeTruthy()
    expect(row?.querySelector('.business-card__value')).toBeNull()
  })

  it('renders the dashboard as two card layers: module card, then one card per cell', async () => {
    const { host } = await renderContent('dashboard')
    // 第一层：模块卡；第二层：数据卡片（一个格一张），卡头是格名。
    const module = host.querySelector('[data-business-card="quotes"]')
    expect(module).not.toBeNull()
    const cells = [...module!.querySelectorAll<HTMLElement>('[data-business-cell-card]')]
    expect(cells.length).toBeGreaterThan(1)
    const usd = module!.querySelector<HTMLElement>('[data-business-cell-card="usd"]')
    expect(usd?.querySelector('.business-cell__title')?.textContent).toBe('美元')
    // 一个格的候选源都放进同一张数据卡片里。
    expect(usd?.querySelectorAll('[data-cell-id]')).toHaveLength(2)
    // 第二层卡片都在模块卡的网格里（整行一张；源项一行 3 个的排版由 CSS 守卫断）。
    expect(module!.querySelectorAll('.business-cell-grid > [data-business-cell-card]').length).toBe(cells.length)
  })
})

describe('格键唯一', () => {
  it('has no duplicate cellId inside any module', () => {
    // 背离卡的「资金腿」撞过一次键，`divergence:*` 因此接不上。这条守全表（跨模块同名允许）。
    expect(duplicateCellIds()).toEqual([])
    // 同一 sourceId + 同一格不许在两张卡里重复（跨资产并进市场状态之后留下的那条）。
    expect(duplicateCardCells()).toEqual([])
  })
})
