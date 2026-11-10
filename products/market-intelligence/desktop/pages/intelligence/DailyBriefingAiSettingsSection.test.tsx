// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { DailyBriefingAiSettingsSection, type DailyBriefingAiSettingsState } from './DailyBriefingAiSettingsSection'

/**
 * 这一块的两条失败句必须各说各的：
 * - 设置读不到 → 「设置没读到，请重试。」
 * - 保存失败 → 「保存失败，请重试」
 * 以前读失败也印「保存失败」，那是把「拿不到」伪装成「存不上」——读者会去改一个没坏的东西。
 */
const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing
let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

type StateProps = Omit<DailyBriefingAiSettingsState, 'saving' | 'save' | 'reload'>

const base: StateProps = {
  state: 'loading',
  draft: null,
  dirty: false,
  update: () => undefined,
  providers: [],
  candidates: [],
  defaultModel: null,
  webSearchSupported: true,
  webSearchBlocked: false,
  clearWebSearchBlocked: () => undefined
}

const draft = { editorialEnabled: true, providerId: '', modelId: '', webSearchEnabled: false }

async function render(overrides: Partial<StateProps>): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(ShellLanguageProvider, {
    language: 'zh-CN',
    children: createElement(DailyBriefingAiSettingsSection, { text, ...base, ...overrides })
  })))
  return host
}

describe('the AI editing block’s two failure sentences', () => {
  it('says the settings could not be read, not that saving failed', async () => {
    const host = await render({ state: 'load-failed', draft: null })
    const alert = host.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe(text.aiSettings.loadFailed)
    expect(host.textContent).not.toContain(text.aiSettings.failed)
  })

  it('still says the save failed when saving is what failed', async () => {
    const host = await render({ state: 'save-failed', draft })
    expect(host.textContent).toContain(text.aiSettings.failed)
    expect(host.textContent).not.toContain(text.aiSettings.loadFailed)
  })
})
