// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { BusinessSettingsContent, otherBusinessGroups, type BusinessKey } from './BusinessSettingsView'
import { modulesForBusiness } from './dashboardSourceModules'

/**
 * 「采集与数据」每个源项的第二行：**频率**（产品 2026-11-12 定稿，界面设计 2026-11-12 签字）。
 *
 * 判据：
 * ① 通用采集器按预设跑的源 → 下拉，改档把 `{sourceId, collectionPreset}` 交给宿主（走按源 patch）；
 * ② 节奏**不可调**的源（产品自有作业 / 没有通用采集器）→ **照样占住这一行**：标签「频率」+
 *    值「内置频率」+ 一颗 ⓘ（为什么内置进浮层）。**没有 select / 开关 / 勾选框**——「不可操作」
 *    靠没有控件外观表达，不靠禁用态、不靠颜色；具体周期不写死（没有排期读口就不编数字）；
 * ③ 未启用的源 → 不出现第二行（那一行整行是跳配置的按钮，不能再嵌控件），但行本身仍可点；
 * ④ 行里最多一颗 ⓘ（手动档那句说明合在这一颗里）；
 * ⑤ 可调那一行带注册表模板属性——声明的行确实有人画（守卫按模板反查，不认字符串形状）；
 * ⑥ **同一张卡里「已启用源数 = preset 行数」**：这是「不许高高低低」的机械判据，
 *    三种业务各用真实数据量断一次（舆情 4 个源、日历 6 个、看板最满的 quotes 8 个格）。
 */
const t = productText['zh-CN'].settings.intelligenceSources
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

const ROW = '[data-cell-id="policy-path:probability"]'

const resolveText = (key: string): string => {
  const local = key.startsWith('settings.intelligenceSources.') ? key.slice('settings.intelligenceSources.'.length) : key
  const value = local
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], t)
  return typeof value === 'string' ? value : key
}

async function render(input: Readonly<{
  business?: BusinessKey
  sourceEnabled?: boolean
  preset?: string
  builtinCadence?: boolean
  presets?: Readonly<Record<string, string>>
}> = {}): Promise<{ host: HTMLElement; onPresetChange: (sourceId: string, preset: string) => void }> {
  const onPresetChange = vi.fn<(sourceId: string, preset: string) => void>()
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const presets = input.presets ?? (input.preset === undefined ? undefined : { 'policy-path-market': input.preset })
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(BusinessSettingsContent, {
        business: input.business ?? 'dashboard',
        isCellEnabled: () => true,
        isSourceEnabled: () => input.sourceEnabled ?? true,
        onCellToggle: vi.fn(),
        onOpenSourceConfig: vi.fn(),
        onPresetChange,
        ...(presets === undefined ? {} : { presets }),
        ...(input.builtinCadence === true ? { builtinCadence: new Set(['policy-path-market']) } : {}),
        resolveText,
        sourceNames: { 'policy-path-market': 'Polymarket' }
      })
    }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return { host, onPresetChange }
}

/** 一个源行里的「操作控件」：这些数量必须是 0；ⓘ 是说明入口，不算。 */
const OPERATION_CONTROLS = 'select, [role="combobox"], [role="switch"], input'

describe('每源第二行：频率', () => {
  it('offers a dropdown for a generic-collected source and writes the per-source preset', async () => {
    const { host, onPresetChange } = await render({ preset: 'manual' })
    const row = host.querySelector<HTMLElement>(`${ROW} [data-preset-row="policy-path-market"]`)
    expect(row).not.toBeNull()
    expect(row!.textContent).toContain(t.collectionPolicy.frequency)
    // ⑤ 声明的模板真的有人画（守卫按模板反查，不猜实例形状）。
    expect(row!.getAttribute('data-setting-key')).toBe('setting:sources.collection-preset@policy-path-market')
    // 一个源行里**只许有一颗开关**（源采集那颗）。用户 2026-11-12 真机报过两颗一样的圆开关并排
    // （源采集 + 「纳入情绪分析」），会被读成重复开关；第二颗已随该功能整个删除（`4c4f298`/`c3004e5`），
    // 这条钉住它不会以任何形态回来。
    expect(host.querySelector<HTMLElement>(ROW)!.querySelectorAll('[role="switch"]')).toHaveLength(1)

    // 下拉交互：打开后选「频繁」，回调收到的是按源的单字段 patch 目标。
    const selector = row!.querySelector<HTMLElement>('.ant-select-selector')!
    await act(async () => { selector.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    const option = [...document.body.querySelectorAll<HTMLElement>('.ant-select-item-option')]
      .find((entry) => entry.textContent?.trim() === t.collectionPolicy.presets.frequent)
    expect(option).toBeDefined()
    await act(async () => { option!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onPresetChange).toHaveBeenCalledWith('policy-path-market', 'frequent')
  })

  it('keeps the row for a built-in cadence: 「内置频率」 as the value, zero operation controls, why in ⓘ', async () => {
    const { host, onPresetChange } = await render({ builtinCadence: true })
    const row = host.querySelector<HTMLElement>(`${ROW} [data-preset-row="policy-path-market"]`)
    expect(row).not.toBeNull()
    // 占位标记：这一行不可调，但仍然存在（用户 2026-11-12：不许因为不可调就不画）。
    expect(row!.getAttribute('data-preset-builtin')).toBe('true')
    expect(row!.textContent).toContain(t.collectionPolicy.frequency)
    expect(row!.textContent).toContain(t.collectionPolicy.builtinCadence)
    // 不可操作靠**没有控件外观**表达：不下拉、不开关、不勾选框。
    expect(row!.querySelectorAll(OPERATION_CONTROLS)).toHaveLength(0)
    // 它不是一条可写的声明行，不许挂模板属性（挂了就等于宣称这一行能改）。
    expect(row!.hasAttribute('data-setting-key')).toBe(false)
    // 为什么内置进浮层：正文只有「频率 / 内置频率」两段，说明句不在正文里。
    const info = [...row!.querySelectorAll<HTMLElement>('button[aria-label]')]
      .find((button) => button.getAttribute('aria-label') === t.collectionPolicy.builtinCadenceNoteAria)
    expect(info).toBeDefined()
    expect(row!.textContent).not.toContain(t.collectionPolicy.builtinCadenceNote)
    // 没有写死的周期数字（「内置 · 5 分钟」这类没有真实读口就不写）。
    expect(row!.textContent).not.toMatch(/\d+\s*(分钟|分|min)/u)
    expect(onPresetChange).not.toHaveBeenCalled()
  })

  it('omits the second line for a disabled source but keeps the row as the one jump target', async () => {
    for (const input of [{ sourceEnabled: false, preset: 'manual' }, { sourceEnabled: false, builtinCadence: true }]) {
      const { host } = await render(input)
      const row = host.querySelector<HTMLElement>(ROW)!
      expect(row.querySelector('[data-preset-row]')).toBeNull()
      expect(row.getAttribute('data-source-disabled')).toBe('true')
      expect(row.getAttribute('role')).toBe('button')
      await act(async () => root?.unmount())
      document.body.replaceChildren()
    }
  })

  it('has at most one info trigger on the line (manual note merged into it)', async () => {
    const { host } = await render({ preset: 'manual' })
    const row = host.querySelector<HTMLElement>(`${ROW} [data-preset-row="policy-path-market"]`)!
    expect(row.querySelectorAll('button[aria-label]').length).toBeLessThanOrEqual(1)
  })

  it('gives every enabled source its own second line, on every card of every business', async () => {
    // 「不可调的也要占位」的机械判据：卡里已启用的源有几个，第二行就得有几行。
    // 三种业务都用**真实数据量**跑（舆情 4、日历 6、看板最满 8 格），不拿两三条夹具充数。
    for (const business of ['dashboard', 'sentiment', 'calendar'] as const) {
      const modules = modulesForBusiness(business)
      const presets = Object.fromEntries(modules.flatMap((module) => module.cells.map((cell) => [cell.sourceId, 'balanced'])))
      const { host } = await render({ business, presets })

      if (business === 'dashboard') {
        for (const module of modules) {
          const card = host.querySelector<HTMLElement>(`[data-business-card="${module.id}"]`)!
          expect(card, `card ${module.id}`).not.toBeNull()
          const rows = card.querySelectorAll('[data-business-row]')
          expect(rows.length, `rows in ${module.id}`).toBe(module.cells.length)
          expect(card.querySelectorAll('[data-preset-row]'), `preset rows in ${module.id}`).toHaveLength(rows.length)
        }
      } else {
        for (const group of otherBusinessGroups(business, resolveText)) {
          const card = host.querySelector<HTMLElement>(`[data-business-cell-card="${group.key}"]`)!
          expect(card, `card ${business}:${group.key}`).not.toBeNull()
          const rows = card.querySelectorAll('[data-business-row]')
          expect(rows.length, `rows in ${business}:${group.key}`).toBe(group.cells.length)
          expect(card.querySelectorAll('[data-preset-row]'), `preset rows in ${business}:${group.key}`).toHaveLength(rows.length)
        }
      }
      await act(async () => root?.unmount())
      document.body.replaceChildren()
    }
  })
})