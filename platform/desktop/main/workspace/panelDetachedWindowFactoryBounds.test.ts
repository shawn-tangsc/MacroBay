import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (...args: unknown[]) => void

const electronMocks = vi.hoisted(() => ({ windows: [] as unknown[] }))

vi.mock('electron', () => {
  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = []
    readonly options: Record<string, unknown>
    readonly listeners = new Map<string, Listener[]>()
    readonly webContents: {
      id: number
      setWindowOpenHandler: (handler: unknown) => void
      loadURL: (url: string) => Promise<void>
      isCrashed: () => boolean
      on: (event: string, listener: Listener) => void
    }
    destroyed = false
    /** 记录任何**新增**外观/尺寸 API 的调用：PLAT-04 明确禁止（零行为变更）。 */
    readonly minimumSizeCalls: unknown[] = []
    readonly zoomFactorCalls: unknown[] = []
    bounds = { x: 0, y: 0, width: 1280, height: 800 }
    boundsReads = 0
    /** 测试开关：模拟平台 `getBounds()` 缺失/抛错（必须静默降级，绝不猜、绝不抛）。 */
    getBoundsThrows = false
    constructor(options: Record<string, unknown>) {
      this.options = options
      electronMocks.windows.push(this)
      const owner = this
      this.webContents = {
        id: 700 + FakeBrowserWindow.instances.length,
        setWindowOpenHandler: () => undefined,
        loadURL: async () => undefined,
        isCrashed: () => false,
        on: () => undefined
      }
      FakeBrowserWindow.instances.push(this)
    }
    on(event: string, listener: Listener): void {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    }
    removeListener(event: string, listener: Listener): void {
      this.listeners.set(event, (this.listeners.get(event) ?? []).filter((entry) => entry !== listener))
    }
    emit(event: string, ...args: unknown[]): void {
      for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args)
    }
    /** 原生监听器计数：`closed` 之后必须归零（重复 create/destroy 绝不累积）。 */
    listenerCount(event: string): number { return (this.listeners.get(event) ?? []).length }
    getBounds(): { x: number; y: number; width: number; height: number } {
      this.boundsReads += 1
      if (this.getBoundsThrows) throw new Error('bounds-unavailable')
      return { ...this.bounds }
    }
    /** 测试接缝：不是生产 API（生产只有 Electron 自己的 setMinimumSize/zoomFactor），用于证明未被调用。 */
    setMinimumSize(...args: unknown[]): void { this.minimumSizeCalls.push(args) }
    setZoomFactor(...args: unknown[]): void { this.zoomFactorCalls.push(args) }
    isDestroyed(): boolean { return this.destroyed }
    destroy(): void { this.destroyed = true; this.emit('closed') }
    show(): void { /* 与既有实现一致：只 show，不改变任何选项 */ }
    focus(): void { /* 同上 */ }
  }
  return { app: { isPackaged: false }, BrowserWindow: FakeBrowserWindow, shell: { openExternal: () => undefined } }
})

import type { WorkspaceBounds } from '@platform/workspace/contracts'
import { SECURE_WINDOW_PREFERENCE_BASELINE, createSecureWindowSecurity } from '../../window/createMainWindow'
import { resolveWindowChromeOptions } from '../../window/windowChrome'
import { createDetachedWindowFactory } from './panelDetachedWindowFactory'

/**
 * Owner: platform/desktop/main/workspace（PLAT-04 focused，PM 授权 A 后新增）。
 * 权威：清单 PLAT-04「页窗 resize/关闭时采集」+ PM 硬约束 1/2/3/4。
 *
 * 本文件只判**工厂侧**（electron-backed，用 `vi.mock('electron')` 的假 BrowserWindow，不启动 Electron）：
 *  1) `resize`/`move` 原样广播给句柄订阅者（**不合并、不去重**：那是宿主的职责），订阅即异步补发一次当前值；
 *  2) `closed` 移除原生监听并清空订阅者 ⇒ 重复 create/destroy N 次后监听器数**不增长**、销毁后零回调；
 *  3) 零行为变更：`new BrowserWindow` 的 options 一字不动，未调用 `setMinimumSize`/`zoomFactor`，
 *     `close`/`closed`/崩溃广播语义与 P1-06g/P2-09 逐字一致（由既有 `panelDetachedWindowFactory.test.ts` 兜底）；
 *  4) 平台无法读取 bounds（缺失/抛错）⇒ 静默降级：不广播、不抛、不影响窗口语义。
 */

const APP_ROOT = 'file:///app/renderer'
const ENTRY = 'file:///app/renderer/index.html'
const PRELOAD = '/app/preload/index.js'

type FakeWindow = {
  options: Record<string, unknown>
  bounds: { x: number; y: number; width: number; height: number }
  boundsReads: number
  destroyed: boolean
  minimumSizeCalls: unknown[]
  zoomFactorCalls: unknown[]
  getBoundsThrows: boolean
  on: (event: string, listener: Listener) => void
  removeListener: (event: string, listener: Listener) => void
  emit: (event: string, ...args: unknown[]) => void
  listenerCount: (event: string) => number
  destroy: () => void
}

beforeEach(() => {
  // 每个用例都从「零窗口」开始：监听器计数与索引才可判定
  electronMocks.windows.length = 0
})

describe('PLAT-04 工厂 bounds 端口：原样广播 + 零泄漏 + 零行为变更', () => {
  it('resize/move 原样广播（不合并、不去重）；订阅即异步补发一次当前值，绝不同步回调', async () => {
    const factory = createDetachedWindowFactory({
      appRoot: APP_ROOT, entryUrl: ENTRY, openExternal: () => undefined, onNativeClose: () => undefined
    })
    const handle = factory({ windowInstanceId: 'w-1', hostEpoch: 2, bounds: { x: 0, y: 0, width: 1280, height: 800 }, security: createSecureWindowSecurity({ preload: PRELOAD, openExternal: () => undefined }), title: 't' })
    const fake = electronMocks.windows[0] as unknown as FakeWindow
    const seen: WorkspaceBounds[] = []
    const unsubscribe = handle.onBoundsChanged!((bounds) => seen.push(bounds))

    expect(seen).toEqual([]) // 绝不同步回调
    await Promise.resolve()
    expect(seen).toEqual([{ x: 0, y: 0, width: 1280, height: 800 }]) // 异步补发一次初始尺寸

    fake.bounds = { x: 40, y: 60, width: 1500, height: 900 }
    fake.emit('resize')
    fake.emit('move')
    // 两个原生事件 ⇒ 两条广播（工厂不做合并/去重；同值去重与合并窗口在宿主侧，已由宿主测试覆盖）
    expect(seen).toEqual([
      { x: 0, y: 0, width: 1280, height: 800 },
      { x: 40, y: 60, width: 1500, height: 900 },
      { x: 40, y: 60, width: 1500, height: 900 }
    ])

    unsubscribe()
    fake.bounds = { x: 41, y: 61, width: 1501, height: 901 }
    fake.emit('resize')
    expect(seen).toHaveLength(3) // 退订后零回调
  })

  it('closed 移除原生监听并清空订阅者：重复 create/destroy 50 次后监听器数不增长、销毁后零回调', async () => {
    const factory = createDetachedWindowFactory({
      appRoot: APP_ROOT, entryUrl: ENTRY, openExternal: () => undefined, onNativeClose: () => undefined
    })
    const security = createSecureWindowSecurity({ preload: PRELOAD, openExternal: () => undefined })
    const callbacks = { total: 0 }
    let liveNativeListeners = 0

    for (let round = 0; round < 50; round += 1) {
      const handle = factory({
        windowInstanceId: `w-${round}`, hostEpoch: 2, bounds: { x: 0, y: 0, width: 1280, height: 800 }, security, title: 't'
      })
      const fake = electronMocks.windows[round] as unknown as FakeWindow
      handle.onBoundsChanged!(() => { callbacks.total += 1 })
      await Promise.resolve()
      fake.destroy() // 真实语义：destroy() 同步派发 closed
      expect(fake.listenerCount('resize')).toBe(0)
      expect(fake.listenerCount('move')).toBe(0)
      fake.emit('resize')
      fake.emit('move')
      liveNativeListeners += fake.listenerCount('resize') + fake.listenerCount('move')
    }

    expect(callbacks.total).toBe(50) // 每次只有「订阅补发」那一次；销毁后的 resize/move 一律零回调
    expect(liveNativeListeners).toBe(0)
    // 每轮建窗都注册过原生监听（证明上面的 0 不是「从未注册」）
    expect((electronMocks.windows[49] as unknown as FakeWindow).boundsReads).toBeGreaterThan(0)
  })

  it('零行为变更：new BrowserWindow 的 options 一字不动，未调用 setMinimumSize/zoomFactor', () => {
    const factory = createDetachedWindowFactory({
      appRoot: APP_ROOT, entryUrl: ENTRY, openExternal: () => undefined, onNativeClose: () => undefined
    })
    const security = createSecureWindowSecurity({ preload: PRELOAD, openExternal: () => undefined })
    factory({ windowInstanceId: 'w-only', hostEpoch: 2, bounds: { x: 11, y: 22, width: 1333, height: 777 }, security, title: 'Only' })
    const fake = electronMocks.windows[electronMocks.windows.length - 1] as unknown as FakeWindow

    expect(fake.options).toEqual({
      x: 11, y: 22, width: 1333, height: 777, title: 'Only',
      show: false, autoHideMenuBar: true,
      // PLAT-39 ①：装饰与主窗同源（`windowChrome` 的单源策略：macOS hiddenInset、Windows 无原生标题条）、
      // 底色由主题派生（深/浅两值之一）
      ...resolveWindowChromeOptions(),
      backgroundColor: '#0b0d10',
      webPreferences: { ...SECURE_WINDOW_PREFERENCE_BASELINE, preload: PRELOAD }
    })
    expect(fake.minimumSizeCalls).toEqual([])
    expect(fake.zoomFactorCalls).toEqual([])
  })

  it('平台无法读取 bounds（getBounds 抛错）⇒ 静默降级：不广播、不抛、窗口语义不受影响', () => {
    const factory = createDetachedWindowFactory({
      appRoot: APP_ROOT, entryUrl: ENTRY, openExternal: () => undefined, onNativeClose: () => undefined
    })
    const handle = factory({ windowInstanceId: 'w-throw', hostEpoch: 2, bounds: { x: 0, y: 0, width: 1280, height: 800 }, security: createSecureWindowSecurity({ preload: PRELOAD, openExternal: () => undefined }), title: 't' })
    const fake = electronMocks.windows[electronMocks.windows.length - 1] as unknown as FakeWindow
    fake.getBoundsThrows = true
    const seen: WorkspaceBounds[] = []
    expect(() => handle.onBoundsChanged!((bounds) => seen.push(bounds))).not.toThrow()
    expect(() => { fake.emit('resize'); fake.emit('move') }).not.toThrow()
    expect(seen).toEqual([])
    expect(handle.isDestroyed()).toBe(false)
  })
})
