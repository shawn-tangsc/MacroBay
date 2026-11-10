// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider, useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { DailyBriefingSettingsPanel } from './DailyBriefingSettingsPanel'

/**
 * 日报那一屏搬进配置抽屉之后，**保存失败要点名是哪一块失败**这条判据搬到这里。
 *
 * 它不是「关窗确认」那一族：关窗确认问的是「要不要丢」，这条说的是「哪一块没存上」。
 * 外壳没了以后，块本身还在，所以在块这一层断。
 */
const settingsView = {
  settings: { editorialEnabled: true, providerId: '', modelId: '', webSearchEnabled: false },
  periods: [], periodsUnreadable: false
} as never

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

/** 文案要按当前语言取：面板自己读 `useShellLanguage()`，测试里用同一个 provider。 */
function Probe(): React.ReactElement {
  return createElement(DailyBriefingSettingsPanel)
}

async function renderPanel(saveFails: boolean): Promise<HTMLElement> {
  const invoke = vi.fn(async (_productId: string, method: string) => {
    if (method.includes('getSettings')) return { state: 'available', view: settingsView }
    if (method.includes('saveSettings')) {
      if (saveFails) throw new Error('save failed')
      return { state: 'available', view: settingsView }
    }
    return { state: 'available', periods: [] }
  })
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke }, modelProviders: { list: vi.fn(async () => []) } }
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(createElement(ShellLanguageProvider, { language: 'zh-CN', children: createElement(Probe) })))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return container
}

function Language(): 'zh-CN' | 'en-US' {
  return useShellLanguage()
}

describe('the drawer briefing panel', () => {
  it('names the block that failed to save', async () => {
    const text = productText[Language() ?? 'zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing
    const container = await renderPanel(true)
    const save = [...container.querySelectorAll('button')]
      .find((button) => (button.textContent ?? '').replace(/\s+/gu, '') === text.generationSettings.save)
    expect(save).toBeDefined()
    await act(async () => { save?.click(); await new Promise((resolve) => setTimeout(resolve, 0)) })
    const failed = container.querySelector('[data-settings-save-failed="true"]')
    expect(failed).not.toBeNull()
    expect(failed?.textContent).toContain(text.settingsDrawer.sectionFailed.ai)
  })
})
