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
 * 所以这里钉两件事：
 * 1. 草稿变了要报 `true`（抽屉据此在关闭前问一句）；
 * 2. **这一屏被卸载时要把脏清掉**，否则抽屉会一直以为还有草稿，之后在别的屏关抽屉还被误拦。
 */
let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

function stubBridge(): void {
  const invoke = vi.fn(async (_product: string, method: string) => {
    if (method === 'intelligence.dailyBriefing.getSettings') {
      return {
        settings: { editorialEnabled: true, providerId: '', modelId: '', webSearchEnabled: false },
        language: {
          settings: { primary: 'follow-ui', additional: [] },
          plan: { locales: ['zh-CN'], primary: { requested: 'zh-CN', used: 'zh-CN' }, writeCount: 1 }
        },
        webSearchSupported: true,
        resolved: { state: 'disabled' }
      }
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

async function mount(onDirtyChange: (dirty: boolean) => void): Promise<HTMLElement> {
  stubBridge()
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

describe('the briefing settings panel’s unsaved flag', () => {
  it('clears the unsaved flag when the screen is unmounted, so no other screen is blocked by it', async () => {
    const reported: boolean[] = []
    const host = await mount((dirty) => reported.push(dirty))

    // 改一处 AI 编辑的设置，草稿就有了未保存改动。
    const toggle = host.querySelector<HTMLElement>('.ant-switch')
    expect(toggle).not.toBeNull()
    await act(async () => toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(reported.at(-1)).toBe(true)

    // 切到别的屏 / 关掉这一屏：这一屏已经不在了，脏必须跟着清掉。
    await act(async () => root!.unmount())
    root = undefined
    expect(reported.at(-1)).toBe(false)
  })
})
