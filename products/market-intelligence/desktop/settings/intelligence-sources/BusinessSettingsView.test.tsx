// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { resolveProductTextKey } from '../../shared/i18n/productTextKey'

import { BusinessSettingsView, type BusinessKey } from './BusinessSettingsView'
import { modulesForBusiness } from './dashboardSourceModules'

const t = productText['zh-CN'].settings.intelligenceSources
const resolveText = (key: string): string => resolveProductTextKey('zh-CN', key)

let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function render(business: BusinessKey): Promise<{ host: HTMLElement; onSelectSource: ReturnType<typeof vi.fn> }> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const onSelectSource = vi.fn()
  await act(async () => root!.render(createElement(BusinessSettingsView, {
    business,
    onBusinessChange: vi.fn(),
    onSelectSource,
    resolveText,
    sourceNames: t.sourceNames
  })))
  return { host, onSelectSource }
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
    const calendar = await render('calendar')
    expect(calendar.host.querySelectorAll('.business-card__row')).toHaveLength(6)
    expect(calendar.host.textContent).not.toContain('官方源')
    expect(calendar.host.textContent).not.toContain('聚合源')
    await act(async () => { calendar.host.querySelector<HTMLButtonElement>('.business-card__row')?.click() })
    expect(calendar.onSelectSource).toHaveBeenCalledWith('macro-calendar-fed')

    const sentiment = await render('sentiment')
    expect(sentiment.host.querySelectorAll('.business-card__row')).toHaveLength(4)
    // 「舆情评分」不是源，不添行。
    expect(sentiment.host.textContent).not.toContain('舆情评分')
  })
})
