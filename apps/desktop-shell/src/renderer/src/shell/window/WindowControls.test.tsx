// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { platformText } from '../../i18n/platformText'
import { WindowControls } from './WindowControls'

/**
 * Owner: apps/desktop-shell renderer / window（**Windows 自绘窗口按钮**）。
 *
 * 真机缺陷面（本次改动前）：Windows 上窗口顶部有一条由 OS 绘制的标题条（应用名 + 三个系统按钮），
 * 下面才是应用自己的 `.topbar`。改成 `frame: false` 后，最小化/最大化/关闭必须由本组件画在
 * 应用顶栏的最右端，并把原有的右侧内容（搜索/布局）左移一列 —— 本文件锁定：
 *  · 只有 Windows 渲染（macOS 用系统红绿灯，绝不重复画）；
 *  · 三个按钮只调既有受控 `window.platform.window.*`，不新增通道；
 *  · 最大化/还原图形与 `aria-label` 只认主进程广播（不在渲染层自造状态）；
 *  · 文案成对本地化（zh-CN / en-US）。
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  if (root) {
    const current = root
    root = undefined
    await act(async () => { current.unmount() })
  }
  container = undefined
  document.body.replaceChildren()
  delete document.documentElement.dataset.platform
  Reflect.deleteProperty(window, 'platform')
})

type FakeWindowApi = {
  minimize: ReturnType<typeof vi.fn>
  toggleMaximize: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  isMaximized: ReturnType<typeof vi.fn>
  onMaximizedChange: (callback: (value: boolean) => void) => () => void
}

function installWindowApi(maximized = false): { api: FakeWindowApi; broadcast: (value: boolean) => void } {
  let listener: ((value: boolean) => void) | null = null
  const api: FakeWindowApi = {
    minimize: vi.fn(async () => undefined),
    toggleMaximize: vi.fn(async () => true),
    close: vi.fn(async () => undefined),
    isMaximized: vi.fn(async () => maximized),
    onMaximizedChange: (callback) => {
      listener = callback
      return () => { listener = null }
    }
  }
  Reflect.set(window, 'platform', { window: api })
  return { api, broadcast: (value) => listener?.(value) }
}

async function renderControls(language: 'zh-CN' | 'en-US' = 'zh-CN'): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const current = root
  await act(async () => {
    current.render(createElement(ShellLanguageProvider, {
      language,
      children: createElement(WindowControls)
    }))
  })
  await act(async () => { for (let turn = 0; turn < 4; turn += 1) await Promise.resolve() })
  return container
}

function button(root: HTMLElement, control: 'minimize' | 'maximize' | 'close'): HTMLButtonElement {
  const element = root.querySelector<HTMLButtonElement>(`[data-window-control="${control}"]`)
  if (!element) throw new Error(`missing window control: ${control}`)
  return element
}

describe('Windows 自绘窗口按钮', () => {
  it('Windows 渲染最小化/最大化/关闭，并用本地化 aria-label + tooltip（zh-CN）', async () => {
    document.documentElement.dataset.platform = 'win32'
    installWindowApi()
    const view = await renderControls('zh-CN')
    const text = platformText['zh-CN'].windowChrome

    expect(view.querySelectorAll('[data-window-control]')).toHaveLength(3)
    expect(button(view, 'minimize').getAttribute('aria-label')).toBe(text.minimize)
    expect(button(view, 'maximize').getAttribute('title')).toBe(text.maximize)
    expect(button(view, 'close').getAttribute('aria-label')).toBe(text.close)
    // 关闭键带稳定钩子，样式侧据此给系统惯例的红底
    expect(button(view, 'close').dataset.windowControl).toBe('close')
  })

  it('en-US 用同一组件、同一组按键，只是文案成对切换', async () => {
    document.documentElement.dataset.platform = 'win32'
    installWindowApi()
    const view = await renderControls('en-US')
    expect(button(view, 'minimize').getAttribute('aria-label')).toBe('Minimize')
    expect(button(view, 'close').getAttribute('aria-label')).toBe('Close')
  })

  it('点击只走既有受控 window.platform.window.*（不新增通道、不碰主窗）', async () => {
    document.documentElement.dataset.platform = 'win32'
    const { api } = installWindowApi()
    const view = await renderControls()

    await act(async () => { button(view, 'minimize').click() })
    await act(async () => { button(view, 'maximize').click() })
    await act(async () => { button(view, 'close').click() })

    expect(api.minimize).toHaveBeenCalledTimes(1)
    expect(api.toggleMaximize).toHaveBeenCalledTimes(1)
    expect(api.close).toHaveBeenCalledTimes(1)
  })

  it('最大化图形只认主进程广播：按下后换成「还原」并换图形，再广播一次回到「最大化」', async () => {
    document.documentElement.dataset.platform = 'win32'
    const { broadcast } = installWindowApi(false)
    const view = await renderControls()
    const text = platformText['zh-CN'].windowChrome

    expect(button(view, 'maximize').dataset.maximized).toBe('false')
    expect(button(view, 'maximize').querySelector('path')?.getAttribute('d')).toContain('M0.5 0.5H9.5V9.5H0.5Z')

    await act(async () => { broadcast(true) })
    expect(button(view, 'maximize').dataset.maximized).toBe('true')
    expect(button(view, 'maximize').getAttribute('aria-label')).toBe(text.restore)

    await act(async () => { broadcast(false) })
    expect(button(view, 'maximize').dataset.maximized).toBe('false')
    expect(button(view, 'maximize').getAttribute('aria-label')).toBe(text.maximize)
  })

  it('macOS / 未知平台一个按钮都不画（系统红绿灯在左上角）', async () => {
    document.documentElement.dataset.platform = 'darwin'
    const { api } = installWindowApi()
    const view = await renderControls()
    expect(view.querySelector('[data-window-controls]')).toBeNull()
    expect(view.querySelectorAll('button')).toHaveLength(0)
    expect(api.isMaximized).not.toHaveBeenCalled()
  })

  it('preload 缺失（测试/非 Electron 环境）时按钮仍可渲染，点击不抛', async () => {
    document.documentElement.dataset.platform = 'win32'
    const view = await renderControls()
    expect(view.querySelectorAll('[data-window-control]')).toHaveLength(3)
    await act(async () => { button(view, 'close').click() })
  })
})
