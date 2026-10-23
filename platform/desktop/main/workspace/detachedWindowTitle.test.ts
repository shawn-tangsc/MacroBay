import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false },
  // 工厂的构造器被 `createBrowserWindow` 覆盖；这里只需要模块可导入
  BrowserWindow: class {},
  nativeTheme: { shouldUseDarkColors: true },
  shell: { openExternal: () => undefined }
}))

import { SECURE_WINDOW_PREFERENCE_BASELINE, createSecureWindowSecurity } from '../../window/createMainWindow'
import { APP_DISPLAY_NAME } from '../../appIdentity'
import { createDetachedWindowFactory } from './panelDetachedWindowFactory'

/**
 * Owner: platform/desktop/main/workspace（PLAT-41 RED）。
 *
 * 缺陷（真机）：分离窗打开后 ≤300ms 的空窗期里**原生标题仍是应用名**（入口 HTML 的 `<title>`）——
 * 入口 HTML 的 `<title>` 在首次加载时覆盖了 `BrowserWindow({ title })`，渲染侧要等正文首帧后才写
 * `document.title`（实测 t≈301ms 仍是应用名，t≈507ms 才变成页面名）。
 *
 * 判据（本文件）：建窗时即注入**已解析标题**，并在 Main 侧收口 `page-title-updated`（防篡改）：
 *  - `new BrowserWindow` 之后立刻 `setTitle(已解析标题)`（不依赖渲染侧首帧）；
 *  - 只接受受控白名单里的本地化标题（语言切换仍能跟随）；其余（含入口 HTML 的应用名）一律
 *    `preventDefault()` 并强制回已解析标题；
 *  - `closed` 后移除监听（零残留监听器）。
 */
const APP_ROOT = 'file:///app/renderer'
const ENTRY = 'file:///app/renderer/index.html'
const PRELOAD = '/app/preload/index.js'
const APP_ENTRY_TITLE = APP_DISPLAY_NAME

type TitleListener = (event: { preventDefault: () => void }, title: string) => void

type FakeWindow = {
  title: string
  titleSetCalls: string[]
  webContents: {
    id: number
    titleListeners: Set<TitleListener>
    on: (event: string, listener: TitleListener) => void
    removeListener: (event: string, listener: TitleListener) => void
    emitTitle: (title: string) => { prevented: boolean }
    setWindowOpenHandler: () => void
    loadURL: () => Promise<void>
    isCrashed: () => boolean
    removeAllListeners: (event: string) => void
  }
  options: Record<string, unknown>
  listeners: Map<string, Array<(...args: never[]) => void>>
  isDestroyed: () => boolean
  destroy: () => void
  setTitle: (title: string) => void
  getTitle: () => string
  on: (event: string, listener: (...args: never[]) => void) => void
  removeListener: (event: string, listener: (...args: never[]) => void) => void
  emit: (event: string, ...args: unknown[]) => void
  show: () => void
  focus: () => void
}

const windows: FakeWindow[] = []

function createFakeWindow(options: Record<string, unknown>): FakeWindow {
  const listeners = new Map<string, Array<(...args: never[]) => void>>()
  let destroyed = false
  const window: FakeWindow = {
    title: typeof options.title === 'string' ? options.title : '',
    titleSetCalls: [],
    options,
    listeners,
    isDestroyed: () => destroyed,
    webContents: {
      id: 900 + windows.length,
      titleListeners: new Set<TitleListener>(),
      on: (event, listener) => { if (event === 'page-title-updated') window.webContents.titleListeners.add(listener) },
      removeListener: (event, listener) => { if (event === 'page-title-updated') window.webContents.titleListeners.delete(listener) },
      removeAllListeners: (event) => { if (event === 'page-title-updated') window.webContents.titleListeners.clear() },
      emitTitle: (title) => {
        let prevented = false
        const event = { preventDefault: () => { prevented = true } }
        for (const listener of [...window.webContents.titleListeners]) listener(event, title)
        // 真实 Electron 语义：未被 preventDefault 时按新标题设置窗口标题
        if (!prevented) window.title = title
        return { prevented }
      },
      setWindowOpenHandler: () => undefined,
      loadURL: async () => undefined,
      isCrashed: () => false
    },
    on: (event, listener) => { listeners.set(event, [...(listeners.get(event) ?? []), listener]) },
    removeListener: (event, listener) => {
      listeners.set(event, (listeners.get(event) ?? []).filter((entry) => entry !== listener))
    },
    emit: (event, ...args) => { for (const listener of [...(listeners.get(event) ?? [])]) (listener as (...inner: unknown[]) => void)(...args) },
    setTitle: (title) => { window.title = title; window.titleSetCalls.push(title) },
    getTitle: () => window.title,
    destroy: () => { destroyed = true; window.emit('closed') },
    show: () => undefined,
    focus: () => undefined
  }
  windows.push(window)
  return window
}

function createFactory() {
  return createDetachedWindowFactory({
    appRoot: APP_ROOT,
    entryUrl: ENTRY,
    createBrowserWindow: (options) => createFakeWindow(options as Record<string, unknown>) as never,
    onNativeClose: () => undefined
  })
}

const secureSecurity = () => createSecureWindowSecurity({ preload: PRELOAD, openExternal: () => undefined })
void SECURE_WINDOW_PREFERENCE_BASELINE
void secureSecurity

function openWindow(input: { title: string; allowedTitles?: readonly string[] }): FakeWindow {
  windows.length = 0
  const factory = createFactory()
  factory({
    windowInstanceId: 'window-panel-1',
    hostEpoch: 2,
    bounds: { x: 0, y: 0, width: 720, height: 480 },
    security: secureSecurity(),
    title: input.title,
    ...(input.allowedTitles === undefined ? {} : { allowedTitles: input.allowedTitles })
  })
  const created = windows[0]
  if (!created) throw new Error('window not created')
  return created
}

describe('PLAT-41 分离窗建窗期标题', () => {
  it('建窗时即注入已解析标题（不依赖 renderer 首帧，也不是入口 HTML 的应用名）', () => {
    const window = openWindow({ title: '行情图表', allowedTitles: ['行情图表', 'Market chart'] })
    expect(window.getTitle()).toBe('行情图表')
    // 构造参数仍是已解析标题（P1-04 契约不变），且随后显式 setTitle 一次
    expect(window.options.title).toBe('行情图表')
    expect(window.titleSetCalls).toEqual(['行情图表'])
  })

  it('入口 HTML 的应用名不会覆盖已解析标题（preventDefault + 强制回受控标题）', () => {
    const window = openWindow({ title: '行情图表', allowedTitles: ['行情图表', 'Market chart'] })
    const outcome = window.webContents.emitTitle(APP_ENTRY_TITLE)
    expect(outcome.prevented).toBe(true)
    expect(window.getTitle()).toBe('行情图表')
  })

  it('白名单内的本地化标题仍被接受（语言切换照常跟随），白名单外一律拒绝', () => {
    const window = openWindow({ title: '行情图表', allowedTitles: ['行情图表', 'Market chart'] })
    expect(window.webContents.emitTitle('Market chart').prevented).toBe(false)
    expect(window.getTitle()).toBe('Market chart')
    const tampered = window.webContents.emitTitle('https://evil.example/phishing')
    expect(tampered.prevented).toBe(true)
    expect(window.getTitle()).toBe('行情图表')
  })

  it('缺省白名单 = [已解析标题]（调用方不扩白名单时绝不放宽）', () => {
    const window = openWindow({ title: 'Inspector' })
    expect(window.webContents.emitTitle('Inspector').prevented).toBe(false)
    expect(window.webContents.emitTitle(APP_DISPLAY_NAME).prevented).toBe(true)
    expect(window.getTitle()).toBe('Inspector')
  })

  it('closed 之后移除 page-title-updated 监听（零残留监听器）', () => {
    const window = openWindow({ title: 'Inspector' })
    expect(window.webContents.titleListeners.size).toBe(1)
    window.destroy()
    expect(window.webContents.titleListeners.size).toBe(0)
  })
})
