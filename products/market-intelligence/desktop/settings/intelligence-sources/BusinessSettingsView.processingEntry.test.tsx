// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { BusinessSettingsContent } from './BusinessSettingsView'
import type { BusinessKey } from './BusinessSettingsView'
import { modulesForBusiness } from './dashboardSourceModules'

/**
 * 「采集与数据 › 舆情」卡内部、四个源之后的**一行收尾**（用户 2026-11-11 改判；界面设计定形态）：
 *
 * - 位置：舆情那张 `.business-card` **内部**、源行之后，整宽（= 卡内容宽），不再用 `--module-span`；
 * - 一行 44 高：左「内容处理」+ 11/muted 辅助词「翻译偏好 · 情绪评分」+ 右端箭头；**没有第二行/列表**；
 * - 交互：整行一个目标（`role=button` + `tabIndex=0` + Enter/Space），行内可聚焦元素 0；
 * - 只在舆情业务出现；看板/日历 0；
 * - 旧的独立卡（`data-business-card="processing-entry"`）与 `--module-span` 渲染点全部消失。
 */
const t = productText['zh-CN']
const copy = t.pages.intelligence.portal.dashboard.configDrawer
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

const resolveText = (key: string): string => {
  const local = key.startsWith('settings.intelligenceSources.') ? key.slice('settings.intelligenceSources.'.length) : key
  const value = local.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], t.settings.intelligenceSources)
  return typeof value === 'string' ? value : key
}

async function render(business: BusinessKey, onOpenProcessingSettings?: () => void): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(BusinessSettingsContent, {
        business,
        isCellEnabled: () => true,
        isSourceEnabled: () => true,
        onCellToggle: vi.fn(),
        resolveText,
        sourceNames: {},
        ...(onOpenProcessingSettings === undefined ? {} : { onOpenProcessingSettings })
      })
    }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return host
}

const ROW = '[data-processing-entry="true"]'

describe('舆情卡内部那行「内容处理」入口', () => {
  it('sits inside the sentiment card, after every source row, and spans the card width', async () => {
    const host = await render('sentiment', vi.fn())
    const card = host.querySelector<HTMLElement>('[data-business-card="sentiment"]')!
    const row = host.querySelector<HTMLElement>(ROW)!
    expect(row).not.toBeNull()
    // 在卡内部，且是卡的直接子节点 → 宽度就是卡内容宽（不是网格里的一列）。
    expect(row.parentElement).toBe(card)
    expect(card.style.getPropertyValue('--module-span')).toBe('')
    // 在四个源行之后：源行都在它前面，且数量与真实数据一致。
    const sourceRows = [...card.querySelectorAll('[data-business-row]')]
    expect(sourceRows.length).toBe(modulesForBusiness('sentiment').flatMap((module) => module.cells).length)
    expect(sourceRows.some((sourceRow) => row.compareDocumentPosition(sourceRow) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(false)
    // 旧的独立卡与网格包装都没了。
    expect(host.querySelector('[data-business-card="processing-entry"]')).toBeNull()
    expect(card.parentElement?.className).not.toContain('business-module-grid')
  })

  it('is one 44-high line: 内容处理 + 辅助词 + 箭头，没有第二行/列表', async () => {
    const host = await render('sentiment', vi.fn())
    const row = host.querySelector<HTMLElement>(ROW)!
    expect(row.children).toHaveLength(3)
    expect(row.textContent).toContain(copy.menus.processing)
    expect(row.textContent).toContain(copy.processingEntryHint)
    // 老形态那两行字段列表不再存在。
    expect(row.querySelectorAll('[data-processing-field]')).toHaveLength(0)
  })

  it('has exactly one interactive target, no focusable element inside, and a full accessible name', async () => {
    const host = await render('sentiment', vi.fn())
    const row = host.querySelector<HTMLElement>(ROW)!
    expect(row.getAttribute('role')).toBe('button')
    expect(row.getAttribute('tabindex')).toBe('0')
    expect(row.getAttribute('aria-label')).toBe(copy.processingEntryAria)
    expect(row.querySelectorAll('button, a, input, select, textarea, [tabindex]')).toHaveLength(0)
    expect(row.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('opens the processing screen through the host callback on click and on Enter/Space', async () => {
    const onOpen = vi.fn()
    const host = await render('sentiment', onOpen)
    const row = host.querySelector<HTMLElement>(ROW)!
    await act(async () => { row.click() })
    await act(async () => { row.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })) })
    await act(async () => { row.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' })) })
    expect(onOpen).toHaveBeenCalledTimes(3)
  })

  it('appears only for the sentiment business', async () => {
    const sentiment = await render('sentiment', vi.fn())
    expect(sentiment.querySelector(ROW)).not.toBeNull()
    await act(async () => root?.unmount())
    document.body.replaceChildren()
    for (const business of ['dashboard', 'calendar'] as const) {
      const host = await render(business, vi.fn())
      expect(host.querySelector(ROW), business).toBeNull()
      await act(async () => root?.unmount())
      document.body.replaceChildren()
    }
  })

  it('keeps the styles in their own file and leaves the two reader-edited stylesheets alone', () => {
    const root = process.cwd()
    const read = (path: string): string => readFileSync(join(root, path), 'utf8')
    expect(read('products/market-intelligence/desktop/pages/intelligence/processingEntryRow.css')).toContain('.business-card__processing-entry')
    expect(read('products/market-intelligence/desktop/settings/config-drawer/configDrawer.css')).not.toContain('business-card__processing-entry')
    expect(read('products/market-intelligence/desktop/settings/intelligence-sources/intelligence-sources.css')).not.toContain('business-card__processing-entry')
  })

  it('page-level wiring still uses the object-shaped menu request', () => {
    const source = readFileSync(join(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/index.tsx'), 'utf8')
    expect(source).toContain('onOpenProcessingSettings={() => openConfigDrawer({ menu: \'processing\' })}')
    expect(source).not.toContain('openConfigDrawer(\'processing\')')
  })
})
