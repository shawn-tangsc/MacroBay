// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmProvider } from '@platform/ui/components/confirm'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { DailyBriefingSettingsPanel } from './DailyBriefingSettingsPanel'

/**
 * 配置抽屉「日报」屏的脏生命周期（搬屏时独立成文，避免和同一屏的其它用例抢一个文件）。
 *
 * 这一屏自己不带外壳：关闭/切屏由配置抽屉决定，抽屉只问一个问题——「现在有没有未保存的草稿」。
 * 这里钉四件事（关闭守卫那三条在 `ConfigSettingsDrawer.test.tsx`，不在这里重造）：
 * 1. 草稿变了报 `true`，卸载时清成 `false`（否则在别的屏关抽屉被误拦）；
 * 2. **读失败不报脏**：没有草稿可丢，关掉不该问；
 * 3. **保存成功后报 `false`**：存下的值就是新基线；
 * 4. **保存失败后仍是 `true`**，且读者刚改的值还在——这条不钉，读者会遇到「存不上、一关就没了、连问都不问」。
 */
let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

type BridgeOptions = Readonly<{ settingsFails?: boolean; saveFails?: boolean }>

const language = {
  settings: { primary: 'follow-ui', additional: [] },
  plan: { locales: ['zh-CN'], primary: { requested: 'zh-CN', used: 'zh-CN' }, writeCount: 1 }
}

function settingsView(input: Readonly<{ editorialEnabled: boolean }> = { editorialEnabled: true }): unknown {
  return {
    settings: { editorialEnabled: input.editorialEnabled, providerId: '', modelId: '', webSearchEnabled: false },
    language,
    webSearchSupported: true,
    resolved: { state: 'disabled' }
  }
}

function stubBridge(options: BridgeOptions = {}): void {
  let stored = settingsView()
  const invoke = vi.fn(async (_product: string, method: string, payload?: unknown) => {
    if (method === 'intelligence.dailyBriefing.getSettings') {
      if (options.settingsFails) throw new Error('settings-unreadable')
      return stored
    }
    if (method === 'intelligence.dailyBriefing.saveSettings') {
      if (options.saveFails) throw new Error('save-failed')
      const patch = payload as { editorialEnabled?: boolean } | undefined
      // 保存成功后返回的就是「服务器存下的那一份」，与请求一致。
      stored = settingsView({ editorialEnabled: patch?.editorialEnabled ?? true })
      return stored
    }
    if (method === 'intelligence.dailyBriefing.listPeriods') {
      return [{ id: 'default', generationTime: '07:00', windowHours: 24, language: 'zh-CN' }]
    }
    return undefined
  })
  vi.stubGlobal('platform', {
    products: { invoke },
    modelProviders: { list: vi.fn(async () => []) },
    settings: { get: vi.fn(async () => ({ modelDefaults: { agentModelId: '' } })) }
  })
}

async function mount(onDirtyChange: (dirty: boolean) => void, options: BridgeOptions = {}): Promise<HTMLElement> {
  stubBridge(options)
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(
    <ShellLanguageProvider language="zh-CN">
      <ConfirmProvider>
        <DailyBriefingSettingsPanel onDirtyChange={onDirtyChange} />
      </ConfirmProvider>
    </ShellLanguageProvider>
  ))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return host
}

const switches = (host: HTMLElement): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('.ant-switch')]
const saveButton = (host: HTMLElement): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[data-settings-save="true"]')!

describe('the briefing settings panel’s unsaved flag', () => {
  it('clears the unsaved flag when the screen is unmounted, so no other screen is blocked by it', async () => {
    const reported: boolean[] = []
    const host = await mount((dirty) => reported.push(dirty))

    // 改一处 AI 编辑的设置，草稿就有了未保存改动。
    const toggle = switches(host)[0]
    expect(toggle).not.toBeUndefined()
    await act(async () => toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(reported.at(-1)).toBe(true)

    // 切到别的屏 / 关掉这一屏：这一屏已经不在了，脏必须跟着清掉。
    await act(async () => root!.unmount())
    root = undefined
    expect(reported.at(-1)).toBe(false)
  })

  it('reports no unsaved edits when the settings could not be read at all', async () => {
    // 读不到 = 没有草稿可丢：关抽屉不该问「要不要丢改动」。
    const reported: boolean[] = []
    const host = await mount((dirty) => reported.push(dirty), { settingsFails: true })
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    expect(reported.at(-1)).toBe(false)
    expect(reported).not.toContain(true)
  })

  it('keeps the draft dirty, and its value, when the save fails', async () => {
    // 存不上时草稿还在：关抽屉必须还能问一句「要丢掉吗」。不钉这条，读者会遇到
    // 「存不上、一关就没了，连问都没问」。
    const reported: boolean[] = []
    const host = await mount((dirty) => reported.push(dirty), { saveFails: true })
    const toggle = switches(host)[0]
    await act(async () => toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(reported.at(-1)).toBe(true)

    await act(async () => saveButton(host).dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    expect(reported.at(-1)).toBe(true)
    // 读者刚改的那一格还在（关掉 AI 编辑 → 开关是关的），没有被失败重置。
    expect(switches(host)[0]?.getAttribute('aria-checked')).toBe('false')
  })

  it('reports no unsaved edits once the save goes through', async () => {
    // 存下的值就是新基线：保存成功后关抽屉不该再问。
    const reported: boolean[] = []
    const host = await mount((dirty) => reported.push(dirty))
    const toggle = switches(host)[0]
    await act(async () => toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(reported.at(-1)).toBe(true)

    await act(async () => saveButton(host).dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    expect(reported.at(-1)).toBe(false)
  })
})
