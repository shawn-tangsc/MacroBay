// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { useDashboardAnalysisDrawer } from './useDashboardAnalysisDrawer'
import type { DrawerSettingsTarget } from './useDrawerAnalysisView'

/**
 * 宿主侧读的那一层：**两件事不能画错**。
 *
 * 1. 读失败必须走错误态。`marketAnalysisTimelineClient.getSettings()` 把失败收成 `undefined`，
 *    宿主如果把它当成「没配置」，读者会看到「关」——「读不到」和「关」就此混成一件。
 * 2. 打开设置的目标只能是 `analysis`：这一屏只会把人送去「AI 分析设置」那个对话框。
 */
let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

type View = ReturnType<typeof useDashboardAnalysisDrawer>

function Harness(input: Readonly<{ onOpenSettings: (target: DrawerSettingsTarget) => void; onView: (view: View) => void }>): null {
  input.onView(useDashboardAnalysisDrawer(true, input.onOpenSettings))
  return null
}

async function mount(onOpenSettings: (target: DrawerSettingsTarget) => void = () => undefined): Promise<() => View> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  let latest: View
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(Harness, { onOpenSettings, onView: (view) => { latest = view } })
    }))
    await Promise.resolve()
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return () => latest
}

/** 平台那些 client 都从 `window.platform` 走；这里只桩真正会读的两处。 */
function stubPlatform(input: Readonly<{ settings?: unknown; providers?: readonly unknown[]; fail?: boolean }>): void {
  const invoke = vi.fn(async (_productId: string, method: string) => {
    if (method !== 'marketAnalysis.getSettings') return undefined
    if (input.fail === true) throw new Error('ipc failed')
    return input.settings
  })
  ;(window as unknown as { platform: unknown }).platform = {
    products: { invoke },
    modelProviders: { list: async () => input.providers ?? [] }
  }
}

describe('the drawer analysis read', () => {
  it('says "could not read" when the settings read fails, rather than "off"', async () => {
    // 客户端把失败收成 `undefined`；宿主必须抛，否则这一屏会把「读不到」画成「关」。
    stubPlatform({ fail: true })
    const current = await mount()
    expect(current()?.state).toBe('error')
  })

  it('shows the current switch and model, and sends the reader to the analysis dialog', async () => {
    stubPlatform({
      settings: { enabled: true, providerId: 'openai', modelId: 'gpt-x', updatedAt: '2026-11-10T00:00:00.000Z' },
      providers: [{ id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-x', name: 'GPT-X' }] }]
    })
    const onOpenSettings = vi.fn()
    const current = await mount(onOpenSettings)
    const view = current()
    expect(view?.state).toBe('ready')
    if (view?.state !== 'ready') return
    expect(view.rows.map((row) => row.key)).toEqual(['configDrawer.rows.analysisSwitch', 'configDrawer.rows.analysisModel'])
    expect(view.rows[0]?.value).toBe('开')
    expect(view.rows[1]?.value).toBe('OpenAI / GPT-X')
    view.rows[1]?.action?.onSelect()
    expect(onOpenSettings).toHaveBeenCalledWith('analysis')
  })
})
