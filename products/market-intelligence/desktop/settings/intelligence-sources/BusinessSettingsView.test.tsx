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

  it('lists calendar and sentiment as flat source names, without group titles', async () => {
    const calendar = await renderContent('calendar')
    expect(calendar.host.querySelectorAll('.business-card__row')).toHaveLength(6)
    expect(calendar.host.textContent).not.toContain('官方源')
    expect(calendar.host.textContent).not.toContain('聚合源')
    // 卡片项是纯行：不是按钮、没有 onClick、点了不导航（用户 2026-11-11 取消点击跳转）。
    for (const row of [...calendar.host.querySelectorAll('.business-card__row')]) {
      expect(row.tagName).not.toBe('BUTTON')
      expect(row.getAttribute('role')).toBeNull()
      expect(row.getAttribute('tabindex')).toBeNull()
    }

    const sentiment = await renderContent('sentiment')
    expect(sentiment.host.querySelectorAll('.business-card__row')).toHaveLength(4)
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

  it('renders each item as a labeled row: 格名 left, 源名 right', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(BusinessSettingsContent, {
      business: 'calendar',
      resolveText,
      sourceNames: t.sourceNames
    })))
    const row = host.querySelector('.business-card__row')
    // 日历那面的格名就是各条 feed 的读者名，右列是源名。
    expect(row?.querySelector('.business-card__label')?.textContent).toBeTruthy()
    expect(row?.querySelector('.business-card__value')?.textContent).toBeTruthy()
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
