// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { AppMenuBar } from './AppMenuBar'

/**
 * Owner: apps/desktop-shell renderer / window（**自绘标题栏里的应用菜单条**）。
 *
 * 判据：
 *  · 只有 Windows 画（macOS 的系统菜单在屏幕顶部，窗口里不重复）；
 *  · 标签来自 Main 的应用菜单（`window.platform.window.menu.list()`），渲染层不持有第二套菜单表；
 *  · 点开只调用 `menu.popup(index, x, y)`（坐标＝按钮左下角的窗口内容坐标），弹出的仍是原生子菜单；
 *  · 菜单读不到/没有 preload 时只留空菜单条，绝不伪造命令。
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

type MenuEntry = { index: number; label: string; visible: boolean }

type FakeMenuApi = {
  list: ReturnType<typeof vi.fn>
  popup: ReturnType<typeof vi.fn>
  onChanged: ReturnType<typeof vi.fn>
}

function installMenuApi(
  resolve: MenuEntry[] | (() => MenuEntry[]),
  options: { closeImmediately?: boolean } = {}
): FakeMenuApi & { change: () => void } {
  const entries = typeof resolve === 'function' ? resolve : () => resolve
  let subscriber: (() => void) | null = null
  const api: FakeMenuApi = {
    list: vi.fn(async () => entries()),
    onChanged: vi.fn((callback: () => void) => {
      subscriber = callback
      return () => { subscriber = null }
    }),
    popup: vi.fn(async () => options.closeImmediately ?? true)
  }
  Reflect.set(window, 'platform', { window: { menu: api } })
  return Object.assign(api, { change: () => subscriber?.() })
}

async function renderMenu(): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const current = root
  await act(async () => {
    current.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(AppMenuBar)
    }))
  })
  await act(async () => { for (let turn = 0; turn < 4; turn += 1) await Promise.resolve() })
  return container
}

const ENTRIES = [
  { index: 0, label: 'File', visible: true },
  { index: 1, label: 'Edit', visible: true },
  { index: 2, label: 'View', visible: true }
]

describe('Windows 自绘标题栏的应用菜单条', () => {
  it('Windows：按 Main 的菜单表渲染顶层标签（不自己造菜单文案）', async () => {
    document.documentElement.dataset.platform = 'win32'
    const api = installMenuApi(ENTRIES)
    const view = await renderMenu()

    const items = [...view.querySelectorAll<HTMLButtonElement>('[data-menu-index]')]
    expect(items.map((item) => item.textContent)).toEqual(['File', 'Edit', 'View'])
    expect(items.every((item) => item.getAttribute('aria-haspopup') === 'menu')).toBe(true)
    expect(api.list).toHaveBeenCalledTimes(1)
    expect(view.querySelector('[data-app-menu]')?.getAttribute('aria-label')).toBe('应用菜单')
  })

  it('点开只调用 menu.popup(索引, 左下角横纵坐标)，关闭后撤掉「打开中」态', async () => {
    document.documentElement.dataset.platform = 'win32'
    let release: (value: boolean) => void = () => undefined
    const api = installMenuApi(ENTRIES)
    api.popup.mockImplementation(() => new Promise<boolean>((resolve) => { release = resolve }))
    const view = await renderMenu()

    const edit = view.querySelector<HTMLButtonElement>('[data-menu-index="1"]')!
    await act(async () => { edit.click() })

    expect(api.popup).toHaveBeenCalledTimes(1)
    const [index, x, y] = api.popup.mock.calls[0] as [number, number, number]
    expect(index).toBe(1)
    expect(Number.isInteger(x)).toBe(true)
    expect(Number.isInteger(y)).toBe(true)
    expect(x).toBeGreaterThanOrEqual(0)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(edit.dataset.open).toBe('true')

    await act(async () => { release(true); await Promise.resolve() })
    expect(edit.dataset.open).toBe('false')
  })

  it('菜单重建广播后重读顶层标签：主进程改一次，Windows 菜单条自动跟上（渲染层无第二份菜单表）', async () => {
    document.documentElement.dataset.platform = 'win32'
    let entries: MenuEntry[] = [{ index: 0, label: 'File', visible: true }]
    const api = installMenuApi(() => entries)
    const view = await renderMenu()
    expect([...view.querySelectorAll('[data-menu-index]')].map((item) => item.textContent)).toEqual(['File'])

    // 主进程重建菜单（新增一项）并广播 —— 渲染层不重启、不重新挂载，只重读
    entries = [
      { index: 0, label: 'File', visible: true },
      { index: 1, label: 'Tools', visible: true }
    ]
    await act(async () => { api.change(); await Promise.resolve() })

    expect([...view.querySelectorAll('[data-menu-index]')].map((item) => item.textContent)).toEqual(['File', 'Tools'])
    expect(api.list).toHaveBeenCalledTimes(2)
  })

  it('macOS / 其它平台不画菜单条（系统菜单在屏幕顶部）', async () => {
    document.documentElement.dataset.platform = 'darwin'
    const api = installMenuApi(ENTRIES)
    const view = await renderMenu()

    expect(view.querySelector('[data-app-menu]')).toBeNull()
    expect(api.list).not.toHaveBeenCalled()
  })

  it('菜单读不到或没有 preload 时只留空菜单条：不抛、不伪造命令', async () => {
    document.documentElement.dataset.platform = 'win32'
    const view = await renderMenu()
    expect(view.querySelectorAll('[data-menu-index]')).toHaveLength(0)
    expect(view.querySelector('[data-app-menu]')).not.toBeNull()

    const failing = {
      list: vi.fn(async () => { throw new Error('menu-unavailable') }),
      popup: vi.fn(async () => false)
    }
    Reflect.set(window, 'platform', { window: { menu: failing } })
    const second = await renderMenu()
    expect(second.querySelectorAll('[data-menu-index]')).toHaveLength(0)
  })
})
