// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { MarketAnalysisSettingsDialog } from './MarketAnalysisSettingsDialog'

/**
 * `variant="inline"`：**同一段实现，不套 Modal**（产品内「配置」抽屉那一屏用它）。
 *
 * 三条要钉住：
 * 1. 内联时没有对话框标题（抽屉自己有标题，第二个标题就是重复）；
 * 2. 内容一样不少——开关、说明、模型、保存/取消都在；
 * 3. 保存仍然是这个组件的同一条写路径（`marketAnalysis.saveSettings`）。
 */
const text = productText['zh-CN'].pages.intelligence.portal.analysisTimeline
/** antd 会在两个中文字之间插空格（「保 存」），按文案断字前先去掉所有空白。 */
const tight = (value: string | null | undefined): string => (value ?? '').replace(/\s+/gu, '')
const asOf = '2026-11-10T00:00:00.000Z'
let root: Root | undefined
/** 一条用例里开两份表单时，第二份的根单独记，收尾时一起卸。 */
const extraRoots: Root[] = []

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  await act(async () => { for (const extra of extraRoots.splice(0)) extra.unmount() })
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

function stubInvoke(): ReturnType<typeof vi.fn> {
  const invoke = vi.fn(async (_product: string, method: string) => {
    if (method === 'marketAnalysis.getSettings') return { enabled: true, providerId: 'provider-1', modelId: 'model-1', updatedAt: asOf }
    if (method === 'marketAnalysis.saveSettings') return { enabled: false, providerId: '', modelId: '', updatedAt: asOf }
    return undefined
  })
  vi.stubGlobal('platform', { products: { invoke }, modelProviders: { list: vi.fn(async () => []) } })
  return invoke
}

async function renderInline(onClose: () => void = () => undefined): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(createElement(ShellLanguageProvider, {
    language: 'zh-CN',
    children: createElement(MarketAnalysisSettingsDialog, { onClose, open: true, text, variant: 'inline' })
  })))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return container
}

/** 第二条独立挂载（另一处的同一份表单）：渲染到自己的容器里，查询也只看它自己。 */
async function mountSecond(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const localRoot = createRoot(container)
  extraRoots.push(localRoot)
  await act(async () => localRoot.render(createElement(ShellLanguageProvider, {
    language: 'zh-CN',
    children: createElement(MarketAnalysisSettingsDialog, { onClose: () => undefined, open: true, text, variant: 'inline' })
  })))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return container
}

describe('the analysis settings dialog, inline', () => {
  it('draws the whole form without a second title or a mask', async () => {
    stubInvoke()
    const container = await renderInline()
    expect(container.querySelector('[data-analysis-settings-inline="true"]')).not.toBeNull()
    // 内容一样不少：两个开关/模型行 + 说明 + 保存与取消。
    expect(container.querySelectorAll('.mi-analysis-timeline__settings-row')).toHaveLength(2)
    expect(container.textContent).toContain(text.analysisEnabledHint)
    expect(container.textContent).not.toContain(text.settingsTitle)
    expect(document.querySelector('.ant-modal')).toBeNull()
    const labels = Array.from(document.body.querySelectorAll('button')).map((button) => tight(button.textContent))
    expect(labels).toContain(tight(text.save))
    expect(labels).toContain(tight(text.cancel))
  })

  it('keeps an unsaved draft when another surface saves the same settings', async () => {
    // 同一份设置可以同时开在两处（页面上的对话框 + 抽屉里的这张表单）。另一处保存会广播回来、
    // 重新读设置；读者在这边动过、还没保存时，外部值不许把草稿重置——那是静默丢东西。
    let stored = { enabled: true, providerId: 'provider-1', modelId: 'model-1', updatedAt: asOf }
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.getSettings') return stored
      if (method === 'marketAnalysis.saveSettings') {
        stored = { enabled: true, providerId: 'provider-2', modelId: 'model-2', updatedAt: asOf }
        return stored
      }
      return undefined
    })
    vi.stubGlobal('platform', { products: { invoke }, modelProviders: { list: vi.fn(async () => []) } })

    const container = await renderInline()
    const before = container.querySelector<HTMLElement>('.ant-switch')
    expect(before?.getAttribute('aria-checked')).toBe('true')
    await act(async () => before?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector<HTMLElement>('.ant-switch')?.getAttribute('aria-checked')).toBe('false')

    // 另一处保存：广播后两处都会重读设置。
    const second = await mountSecond()
    const save = Array.from(second.querySelectorAll('button')).find((button) => tight(button.textContent) === tight(text.save))
    await act(async () => save?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    // 外面已经换成 provider-2 / model-2，这边读者刚拨的那一档还在。
    expect(stored.providerId).toBe('provider-2')
    expect(container.querySelector<HTMLElement>('.ant-switch')?.getAttribute('aria-checked')).toBe('false')
  })

  it('saves through the same write path as the dialog', async () => {
    const invoke = stubInvoke()
    const onClose = vi.fn()
    const container = await renderInline(onClose)
    const save = Array.from(container.querySelectorAll('button')).find((button) => tight(button.textContent) === tight(text.save))
    expect(save).toBeDefined()
    await act(async () => save?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'marketAnalysis.saveSettings', expect.objectContaining({ enabled: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
