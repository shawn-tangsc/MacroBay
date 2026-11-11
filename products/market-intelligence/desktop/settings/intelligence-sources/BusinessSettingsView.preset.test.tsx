// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { BusinessSettingsContent } from './BusinessSettingsView'

/**
 * 「采集与数据」每个源项的第二行：**频率**（产品 2026-11-12 定稿，界面设计签字）。
 *
 * 五条判据：
 * ① 通用采集器按预设跑的源 → 下拉，改档把 `{sourceId, collectionPreset}` 交给宿主（走按源 patch）；
 * ② 产品自有采集的源（FOMC 那行）→ **只显示「固定节奏」文字**，没有 Select/combobox（假控件更坏）；
 * ③ 未启用的源 → 整行不出现第二行（那一行整行是跳配置的按钮，不能再嵌下拉），但行本身仍可点；
 * ④ 行里最多一颗 ⓘ（手动档那句说明合在这一颗里）；
 * ⑤ 第二行带注册表模板属性——声明的行确实有人画（守卫按模板反查，不认字符串形状）。
 */
const t = productText['zh-CN'].settings.intelligenceSources
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

const ROW = '[data-cell-id="policy-path:probability"]'

async function render(input: Readonly<{
  sourceEnabled?: boolean
  preset?: string
  productCadence?: boolean
}> = {}): Promise<{ host: HTMLElement; onPresetChange: (sourceId: string, preset: string) => void }> {
  const onPresetChange = vi.fn<(sourceId: string, preset: string) => void>()
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(BusinessSettingsContent, {
        business: 'dashboard',
        isCellEnabled: () => true,
        isSourceEnabled: () => input.sourceEnabled ?? true,
        onCellToggle: vi.fn(),
        onOpenSourceConfig: vi.fn(),
        onPresetChange,
        ...(input.preset === undefined ? {} : { presets: { 'policy-path-market': input.preset } }),
        ...(input.productCadence === true ? { productCadence: new Set(['policy-path-market']) } : {}),
        resolveText: (key: string) => {
          const local = key.startsWith('settings.intelligenceSources.') ? key.slice('settings.intelligenceSources.'.length) : key
          const value = local
            .split('.')
            .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], t)
          return typeof value === 'string' ? value : key
        },
        sourceNames: { 'policy-path-market': 'Polymarket' }
      })
    }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return { host, onPresetChange }
}

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

  it('shows a plain sentence for a product-owned cadence, with no control at all', async () => {
    const { host } = await render({ productCadence: true })
    const row = host.querySelector<HTMLElement>(`${ROW} [data-preset-row="policy-path-market"]`)
    expect(row).not.toBeNull()
    expect(row!.getAttribute('data-preset-fixed')).toBe('true')
    expect(row!.textContent).toContain(t.collectionPolicy.frequency)
    expect(row!.textContent).toContain(t.collectionPolicy.fixedCadence)
    // 文字不是控件：没有 select、没有 combobox、没有按钮。
    expect(row!.querySelectorAll('select, [role="combobox"], button')).toHaveLength(0)
  })

  it('omits the second line for a disabled source but keeps the row as the one jump target', async () => {
    const { host } = await render({ sourceEnabled: false, preset: 'manual' })
    const row = host.querySelector<HTMLElement>(ROW)!
    expect(row.querySelector('[data-preset-row]')).toBeNull()
    expect(row.getAttribute('data-source-disabled')).toBe('true')
    expect(row.getAttribute('role')).toBe('button')
  })

  it('has at most one info trigger on the line (manual note merged into it)', async () => {
    const { host } = await render({ preset: 'manual' })
    const row = host.querySelector<HTMLElement>(`${ROW} [data-preset-row="policy-path-market"]`)!
    expect(row.querySelectorAll('button[aria-label]').length).toBeLessThanOrEqual(1)
  })
})
