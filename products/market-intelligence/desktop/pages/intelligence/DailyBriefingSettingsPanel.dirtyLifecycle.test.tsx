// @vitest-environment happy-dom
import { act, createElement, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmProvider, useConfirm } from '@platform/ui/components/confirm'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { ConfigSettingsDrawer } from '../../settings/config-drawer/ConfigSettingsDrawer'
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

/**
 * 「继续编辑」真的把草稿留下：这一步只有把面板和抽屉守卫放在一起才判得出来。
 * （守卫自己的三条在 `ConfigSettingsDrawer.test.tsx`；这里判的是「取消之后屏还在、值还在」。）
 */
describe('the drawer guard keeps the draft when the reader keeps editing', () => {
  function Probe({ onClose }: Readonly<{ onClose: () => void }>): ReactElement {
    const confirm = useConfirm()
    const [dirty, setDirty] = useState(false)
    return <ConfigSettingsDrawer
      briefingPanel={<DailyBriefingSettingsPanel onDirtyChange={setDirty} />}
      confirmDiscard={(input) => confirm({
        title: input.title,
        description: input.body,
        confirmLabel: input.confirmLabel,
        cancelLabel: input.cancelLabel,
        tone: 'danger',
        onConfirm: input.onDiscard
      })}
      initialMenu="briefing"
      isScreenDirty={(menu) => menu === 'briefing' && dirty}
      onClose={onClose}
      open />
  }

  const confirmButton = (label: string): HTMLButtonElement | undefined =>
    [...document.body.querySelectorAll<HTMLButtonElement>('.ant-modal-confirm-btns button')]
      .find((button) => (button.textContent ?? '').replace(/\s+/gu, '') === label)

  it('keeps the panel and the reader’s value when they answer 继续编辑, and closes only on 丢掉改动', async () => {
    stubBridge()
    const onClose = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(
      <ShellLanguageProvider language="zh-CN">
        <ConfirmProvider><Probe onClose={onClose} /></ConfirmProvider>
      </ShellLanguageProvider>
    ))
    // antd 的 Drawer 走 portal：内容挂在 document 上，不在我给的容器里。
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const body = document.body

    const toggle = switches(body)[0]
    expect(toggle).not.toBeUndefined()
    await act(async () => toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(switches(body)[0]?.getAttribute('aria-checked')).toBe('false')

    const close = body.querySelector<HTMLElement>('.drawer__header-actions button')
    expect(close).not.toBeNull()

    // 第一次关：问一句；选「继续编辑」→ 抽屉还在、值还在。
    await act(async () => close!.click())
    await act(async () => { await Promise.resolve() })
    expect(confirmButton('继续编辑')).not.toBeUndefined()
    await act(async () => confirmButton('继续编辑')!.click())
    await act(async () => { await Promise.resolve() })
    expect(onClose).not.toHaveBeenCalled()
    expect(body.querySelector('[data-briefing-settings-panel="true"]')).not.toBeNull()
    expect(switches(body)[0]?.getAttribute('aria-checked')).toBe('false')

    // 第二次关：选「丢掉改动」→ 关一次，草稿随卸载走。
    await act(async () => close!.click())
    await act(async () => { await Promise.resolve() })
    await act(async () => confirmButton('丢掉改动')!.click())
    await act(async () => { await Promise.resolve() })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
