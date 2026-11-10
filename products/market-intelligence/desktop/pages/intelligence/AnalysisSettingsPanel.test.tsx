// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { AnalysisSettingsPanel, type AnalysisScreenState } from './AnalysisSettingsPanel'

/**
 * 抽屉「AI 分析」样板屏：**脏判据用真实表单值**，不用 mock 布尔。
 *
 * 改一行 → 底栏要有（`dirty`）；改回原样 → 消失；保存成功 → 消失。保存失败由拒绝句表达，
 * 栏本身不消失（由抽屉壳按 `dirty` 决定，壳的用例另有四条）。
 */
const text = productText['zh-CN'].pages.intelligence.portal.analysisTimeline
const asOf = '2026-11-10T00:00:00.000Z'

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

function stubInvoke(saveOk: boolean): ReturnType<typeof vi.fn> {
  const invoke = vi.fn(async (_product: string, method: string) => {
    if (method === 'marketAnalysis.getSettings') return { enabled: true, providerId: '', modelId: '', updatedAt: asOf }
    if (method === 'marketAnalysis.saveSettings') {
      return saveOk
        ? { enabled: false, providerId: '', modelId: '', updatedAt: asOf }
        : Promise.reject(new Error('analysis-model-unavailable'))
    }
    return undefined
  })
  vi.stubGlobal('platform', { products: { invoke }, modelProviders: { list: vi.fn(async () => []) } })
  return invoke
}

async function mount(): Promise<{ container: HTMLElement; state: () => AnalysisScreenState }> {
  let latest: AnalysisScreenState = { dirty: false, saving: false, save: () => undefined }
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(createElement(ShellLanguageProvider, {
    language: 'zh-CN',
    children: createElement(AnalysisSettingsPanel, { onState: (state: AnalysisScreenState) => { latest = state } })
  })))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return { container, state: () => latest }
}

describe('the drawer analysis screen', () => {
  it('turns dirty on a real edit, clean when it is put back, and clean after a save', async () => {
    stubInvoke(true)
    const { container, state } = await mount()
    // 画的是一个区块 + 两行；不是卡片体系。
    expect(container.querySelectorAll('[data-settings-section-block]')).toHaveLength(1)
    expect(container.querySelectorAll('.config-drawer__row')).toHaveLength(2)
    expect(state().dirty).toBe(false)

    const toggle = container.querySelector<HTMLElement>('.config-drawer__row [role="switch"], .config-drawer__row .ant-switch')!
    await act(async () => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })
    expect(state().dirty).toBe(true)

    // 改回原样（再点一次）→ 不脏。
    await act(async () => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })
    expect(state().dirty).toBe(false)

    // 改一行再保存 → 保存成功 → 不脏（基线前进）。
    await act(async () => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })
    expect(state().dirty).toBe(true)
    await act(async () => { state().save(); await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(state().dirty).toBe(false)
  })

  it('shows the refusal notice above the block instead of between rows', async () => {
    stubInvoke(false)
    const { container, state } = await mount()
    const toggle = container.querySelector<HTMLElement>('.config-drawer__row [role="switch"], .config-drawer__row .ant-switch')!
    await act(async () => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })
    await act(async () => { state().save(); await new Promise((resolve) => setTimeout(resolve, 0)) })

    const notice = container.querySelector('.analysis-settings-screen__notice')
    expect(notice).not.toBeNull()
    const block = container.querySelector('[data-settings-section-block]')!
    // 提示在区块**上方**：不是夹在两行之间。
    expect(notice!.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(text.refusalModelUnavailable).toBeTruthy()
  })
})
