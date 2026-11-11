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

/**
 * 「采集与数据 › 舆情」右边那张入口卡（用户 2026-11-12：「舆情下面有个卡片，做跳转就行了」；
 * 界面设计 2026-11-12 签字）：
 *
 * - 只在**舆情**业务下出现，看板 / 日历下 0 个；
 * - 整卡**一个**交互目标：`role="button"` + `tabIndex=0` + Enter/Space，卡内可聚焦元素为 0；
 * - 点它 → 宿主回调（页面层就是 `openConfigDrawer({ menu: 'processing' })`，对象形状）；
 * - 卡上只有「这是什么 / 点它去哪」：标题 + 「全局」短标 + 两行字段名，**没有**统计行与
 *   「翻译当前筛选结果」按钮（那属于内容处理屏）。
 */
const t = productText['zh-CN']
const copy = t.pages.intelligence.portal.dashboard.configDrawer
const translation = t.settings.intelligenceSources.translationPreferences
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

const CARD = '[data-business-card="processing-entry"]'

describe('采集与数据 · 舆情右边那张「内容处理」入口卡', () => {
  it('① 只在舆情业务出现，看板与日历下为 0', async () => {
    const sentiment = await render('sentiment', vi.fn())
    expect(sentiment.querySelector(CARD)).not.toBeNull()
    await act(async () => root?.unmount())
    document.body.replaceChildren()

    const dashboard = await render('dashboard', vi.fn())
    expect(dashboard.querySelector(CARD)).toBeNull()
    await act(async () => root?.unmount())
    document.body.replaceChildren()

    const calendar = await render('calendar', vi.fn())
    expect(calendar.querySelector(CARD)).toBeNull()
  })

  it('①b 版面：舆情卡保持整行（占 3 列），入口卡 1 列落在它下面', async () => {
    // 宽度判据（界面设计 2026-11-12）：抽屉业务区约 708、三列每列约 228；舆情卡占 2 列时源项每项约 141，
    // 而「频率」那一行至少要 150 才不挤——1180 这种常见窗宽就已经挤了。所以不能并排：
    // 舆情卡整行，入口卡占 1 列、换行落在下方（右边空两列是预期形态，不是缺陷）。
    const host = await render('sentiment', vi.fn())
    const moduleCard = host.querySelector<HTMLElement>('[data-business-card="sentiment"]')!
    const entryCard = host.querySelector<HTMLElement>(CARD)!
    expect(moduleCard.style.getPropertyValue('--module-span')).toBe('3')
    expect(entryCard.style.getPropertyValue('--module-span')).toBe('1')
  })

  it('② 整卡一个交互目标：卡内可聚焦元素为 0，可访问名完整', async () => {
    const host = await render('sentiment', vi.fn())
    const card = host.querySelector<HTMLElement>(CARD)!
    expect(card.getAttribute('role')).toBe('button')
    expect(card.getAttribute('tabindex')).toBe('0')
    expect(card.getAttribute('aria-label')).toBe(copy.processingEntryAria)
    // 卡内（不含卡本身）没有任何可聚焦元素：两行纯文本 + `aria-hidden` 箭头。
    expect(card.querySelectorAll('button, a, input, select, textarea, [tabindex]')).toHaveLength(0)
  })

  it('③ 点它触发宿主回调（页面层那条就是 openConfigDrawer({ menu: "processing" })）', async () => {
    const onOpen = vi.fn()
    const host = await render('sentiment', onOpen)
    await act(async () => { host.querySelector<HTMLElement>(CARD)!.click() })
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('④ 键盘 Enter / Space 与点击等效', async () => {
    const onOpen = vi.fn()
    const host = await render('sentiment', onOpen)
    const card = host.querySelector<HTMLElement>(CARD)!
    await act(async () => {
      card.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    })
    await act(async () => {
      card.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }))
    })
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('⑤ 卡上只有「这是什么 / 点它去哪」：没有统计行、没有「翻译当前筛选结果」按钮', async () => {
    const host = await render('sentiment', vi.fn())
    const card = host.querySelector<HTMLElement>(CARD)!
    expect(card.textContent).toContain(copy.menus.processing)
    expect(card.textContent).toContain(copy.scopeGlobal)
    expect(card.textContent).toContain(translation.title)
    expect(card.textContent).toContain(copy.groups.sentimentScoring)
    // 内容处理屏才有的两样，一个都不许搬到卡里。
    expect(card.textContent).not.toContain(translation.queueMissing)
    expect(card.querySelector('[data-drawer-row="translationStats"]')).toBeNull()
    // 不挂 ⓘ（整卡可点时它会变成嵌套可点元素）。
    expect(card.querySelectorAll('button, [role="button"]')).toHaveLength(0)
  })

  it('⑥ 样式只在新文件：两个用户正在改的样式表里没有这张卡的规则', () => {
    const root = process.cwd()
    const read = (path: string): string => readFileSync(join(root, path), 'utf8')
    const own = read('products/market-intelligence/desktop/pages/intelligence/processingEntryCard.css')
    expect(own).toContain('.business-card--entry')
    expect(read('products/market-intelligence/desktop/settings/config-drawer/configDrawer.css')).not.toContain('business-card--entry')
    expect(read('products/market-intelligence/desktop/settings/intelligence-sources/intelligence-sources.css')).not.toContain('business-card--entry')
  })

  it('页面层用的是对象形状的菜单请求，不是字符串形式', () => {
    const source = readFileSync(join(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/index.tsx'), 'utf8')
    expect(source).toContain('onOpenProcessingSettings={() => openConfigDrawer({ menu: \'processing\' })}')
    expect(source).not.toContain('openConfigDrawer(\'processing\')')
  })
})