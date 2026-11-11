// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { BusinessSettingsContent } from './BusinessSettingsView'

/**
 * 「采集与数据」每一行的**交互目标只有一个**（用户 2026-11-12）：
 * - 源开着 → 名字是按钮（原生 `<button>`），整行**不是**按钮；
 * - 源自由关着（红辉光）→ 整行是按钮，名字不再单独做按钮；
 * - 开关只切换、不冒泡成跳转。
 *
 * 红辉光行的可点区域、名字按钮的悬停/聚焦形态归界面设计签字；这里只钉结构与可访问性。
 */
const t = productText['zh-CN'].settings.intelligenceSources
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function render(input: Readonly<{ sourceEnabled: boolean; onOpen?: ReturnType<typeof vi.fn> }>): Promise<{ host: HTMLElement; onCellToggle: ReturnType<typeof vi.fn>; onOpen: ReturnType<typeof vi.fn> }> {
  const onCellToggle = vi.fn()
  const onOpen = input.onOpen ?? vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(BusinessSettingsContent, {
        business: 'dashboard',
        onCellToggle,
        onOpenSourceConfig: onOpen as unknown as (sourceId: string) => void,
        isCellEnabled: () => true,
        isSourceEnabled: () => input.sourceEnabled,
        resolveText: (key: string) => {
          const name = key.startsWith('settings.intelligenceSources.') ? key.slice('settings.intelligenceSources.'.length) : key
          const value = (t as unknown as Record<string, unknown>)[name]
          return typeof value === 'string' ? value : key
        },
        sourceNames: { 'policy-path-market': 'Polymarket' }
      })
    }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return { host, onCellToggle, onOpen }
}

const ROW = '[data-cell-id="policy-path:probability"]'

describe('源开着：名字是唯一的跳转按钮', () => {
  it('renders the name as a real button and the row as a plain container', async () => {
    const { host, onOpen } = await render({ sourceEnabled: true })
    const row = host.querySelector<HTMLElement>(ROW)!
    expect(row.getAttribute('role')).toBeNull()
    expect(row.getAttribute('tabindex')).toBeNull()
    const name = row.querySelector<HTMLButtonElement>('button.business-card__label--action')
    expect(name).not.toBeNull()
    expect(name!.textContent).toBe('Polymarket')
    // 可访问名沿用现成文案：打开 {name} 的配置。
    expect(name!.getAttribute('aria-label')).toBe(t.openSourceConfig.replace('{name}', 'Polymarket'))
    await act(async () => { name!.click() })
    expect(onOpen).toHaveBeenCalledWith('policy-path-market')
  })

  it('does not jump when the switch is clicked', async () => {
    const { host, onCellToggle, onOpen } = await render({ sourceEnabled: true })
    const control = host.querySelector<HTMLElement>(`${ROW} [role="switch"]`)
    await act(async () => { control?.click() })
    expect(onCellToggle).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('has exactly one navigation target in the row (the name; the switch is a control)', async () => {
    const { host } = await render({ sourceEnabled: true })
    const row = host.querySelector<HTMLElement>(ROW)!
    const jumpTargets = [...row.querySelectorAll<HTMLElement>('button, [role="button"]')]
      .filter((node) => node.getAttribute('role') !== 'switch')
    expect(jumpTargets).toHaveLength(1)
    expect(jumpTargets[0]?.className).toContain('business-card__label--action')
  })
})

describe('红辉光行：整行是唯一的跳转按钮', () => {
  it('makes the whole row the button and leaves the name a plain span', async () => {
    const { host, onOpen } = await render({ sourceEnabled: false })
    const row = host.querySelector<HTMLElement>(ROW)!
    expect(row.getAttribute('role')).toBe('button')
    expect(row.getAttribute('data-source-disabled')).toBe('true')
    expect(row.querySelector('button.business-card__label--action')).toBeNull()
    await act(async () => { row.click() })
    expect(onOpen).toHaveBeenCalledWith('policy-path-market')
  })

  it('keeps a single navigation target on the row', async () => {
    const { host } = await render({ sourceEnabled: false })
    const row = host.querySelector<HTMLElement>(ROW)!
    // 行自己是按钮，行里只有开关（控制件），再没有第二个跳转目标。
    expect(row.matches('button, [role="button"]')).toBe(true)
    expect([...row.querySelectorAll<HTMLElement>('button, [role="button"]')]
      .filter((node) => node.getAttribute('role') !== 'switch')).toHaveLength(0)
  })
})

describe('名字按钮的形态归界面设计（这里只钉 CSS 事实）', () => {
  const css = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/settings/intelligence-sources/intelligence-sources.css'), 'utf8')

  it('has no standing underline, and only the hover state adds the accent underline', () => {
    const base = /\.business-card__label--action\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(base).not.toContain('text-decoration')
    const hover = /\.business-card__label--action:hover\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(hover).toContain('text-decoration: underline')
    expect(hover).toContain('var(--accent)')
  })

  it('keeps the red row hover inside the danger family (never reads as editable)', () => {
    const hover = /\.business-card__row\[data-source-disabled='true'\]:hover\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(hover).toContain('--danger')
    // 不许把悬停写成正常底色/正常文字色——那会被读成「现在可以编辑了」。
    expect(hover).not.toContain('var(--text)')
    expect(hover).not.toContain('var(--surface)')
  })

  it('uses an accent focus ring on the whole-row button, not red', () => {
    const focus = /\.business-card__row\[data-source-disabled='true'\]:focus-visible\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(focus).toContain('var(--accent)')
    expect(focus).not.toContain('--danger')
  })
})
