import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({ openExternal: vi.fn(), windows: [] as unknown[] }))

vi.mock('electron', () => {
  class FakeBrowserWindow {
    static instances: unknown[] = []
    readonly webContents: {
      id: number
      loadedUrls: string[]
      openHandler: ((details: { url: string }) => { action: 'deny' }) | null
      /** N6/P1-06g：崩溃态（`isCrashed()` 兜底信号）+ 事件端口（`render-process-gone` 主信号）。 */
      crashed: boolean
      listeners: Map<string, Array<(...args: never[]) => void>>
      setWindowOpenHandler: (handler: (details: { url: string }) => { action: 'deny' }) => void
      loadURL: (url: string) => Promise<void>
      isCrashed: () => boolean
      on: (event: string, listener: (...args: never[]) => void) => void
      emit: (event: string, ...args: unknown[]) => void
    }
    readonly options: Record<string, unknown>
    readonly listeners = new Map<string, Array<(...args: never[]) => void>>()
    destroyed = false
    shown = 0
    focused = 0
    constructor(options: Record<string, unknown>) {
      this.options = options
      electronMocks.windows.push(this)
      const owner = this
      this.webContents = {
        id: 500 + FakeBrowserWindow.instances.length,
        loadedUrls: [],
        openHandler: null,
        crashed: false,
        listeners: new Map<string, Array<(...args: never[]) => void>>(),
        setWindowOpenHandler: (handler) => { owner.webContents.openHandler = handler },
        loadURL: async (url: string) => { owner.webContents.loadedUrls.push(url) },
        isCrashed: () => owner.webContents.crashed,
        on: (event, listener) => {
          owner.webContents.listeners.set(event, [...(owner.webContents.listeners.get(event) ?? []), listener])
        },
        emit: (event, ...args) => {
          for (const listener of owner.webContents.listeners.get(event) ?? []) (listener as (...inner: unknown[]) => void)(...args)
        }
      }
      FakeBrowserWindow.instances.push(this)
    }
    on(event: string, listener: (...args: never[]) => void): void {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    }
    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) (listener as (...inner: unknown[]) => void)(...args)
    }
    loadURL(url: string): Promise<void> { return this.webContents.loadURL(url) }
    isDestroyed(): boolean { return this.destroyed }
    destroy(): void { this.destroyed = true; this.emit('closed') }
    show(): void { this.shown += 1 }
    focus(): void { this.focused += 1 }
  }
  return {
    app: { isPackaged: false },
    BrowserWindow: FakeBrowserWindow,
    shell: { openExternal: electronMocks.openExternal }
  }
})

import { WorkspaceTransferPolicy } from '@platform/workspace/policies'
import { SECURE_WINDOW_PREFERENCE_BASELINE, createSecureWindowSecurity } from '../../window/createMainWindow'
import { createDetachedWindowFactory } from './panelDetachedWindowFactory'
import { createPanelDetachedWindowHost, type DetachedHostEvent, type DetachedWindowFactoryInput } from './panelDetachedWindowHost'
import { createWorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace。P1-06d focused 回归：electron-backed 独立窗工厂。
 * 用 `vi.mock('electron')` 的假 BrowserWindow 验收（不启动 Electron）：共享安全基线、受控 entry 双点校验、
 * windowOpenHandler 一律 deny、原生 X = 回停靠（preventDefault）、closed 回收、以及工厂「自行销毁再抛」契约。
 */

const APP_ROOT = 'file:///app/renderer'
const ENTRY = 'file:///app/renderer/index.html'
const PRELOAD = '/app/preload/index.js'

type FakeWindow = {
  options: Record<string, unknown>
  webContents: {
    id: number; loadedUrls: string[]; openHandler: ((details: { url: string }) => { action: 'deny' }) | null
    crashed: boolean; emit: (event: string, ...args: unknown[]) => void
  }
  destroyed: boolean
  shown: number
  focused: number
  listeners: Map<string, Array<(...args: never[]) => void>>
  emit: (event: string, ...args: unknown[]) => void
  /** 真实 Electron 语义：destroy() 不派发 close，只同步派发 closed。 */
  destroy: () => void
}

function createFactory(overrides: {
  entryUrl?: string
  appRoot?: string
  devOrigins?: readonly string[]
  onNativeClose?: (input: { windowInstanceId: string; hostEpoch: number }) => void
  onWindowDestroyed?: (input: { windowInstanceId: string; hostEpoch: number }) => void
  crashProbeIntervalMs?: number
  /** P1-06m：app 级退出期标记（`before-quit` 置位）——为真时 `close` 绝不 preventDefault。 */
  isAppQuitting?: () => boolean
} = {}) {
  const nativeCloses: Array<{ windowInstanceId: string; hostEpoch: number }> = []
  const destroyed: Array<{ windowInstanceId: string; hostEpoch: number }> = []
  const factory = createDetachedWindowFactory({
    appRoot: overrides.appRoot ?? APP_ROOT,
    entryUrl: overrides.entryUrl ?? ENTRY,
    devOrigins: overrides.devOrigins,
    openExternal: (url) => void electronMocks.openExternal(url),
    onNativeClose: overrides.onNativeClose ?? ((input) => nativeCloses.push(input)),
    onWindowDestroyed: overrides.onWindowDestroyed ?? ((input) => destroyed.push(input)),
    ...(overrides.crashProbeIntervalMs === undefined ? {} : { crashProbeIntervalMs: overrides.crashProbeIntervalMs }),
    ...(overrides.isAppQuitting === undefined ? {} : { isAppQuitting: overrides.isAppQuitting })
  })
  return { factory, nativeCloses, destroyed }
}

const security = createSecureWindowSecurity({ preload: PRELOAD, openExternal: (url) => void electronMocks.openExternal(url) })

beforeEach(() => {
  electronMocks.windows.length = 0
  electronMocks.openExternal.mockClear()
})

function input(overrides: Partial<DetachedWindowFactoryInput> = {}): DetachedWindowFactoryInput {
  return {
    windowInstanceId: 'window-target',
    hostEpoch: 2,
    bounds: { x: 10, y: 20, width: 480, height: 360 },
    security,
    title: 'Inspector',
    ...overrides
  }
}

const lastWindow = (): FakeWindow => electronMocks.windows[electronMocks.windows.length - 1] as unknown as FakeWindow

describe('独立面板窗口工厂', () => {
  it('构造期就对受控 entry fail closed（越界 file: / 非白名单 dev origin）', () => {
    expect(() => createDetachedWindowFactory({
      appRoot: APP_ROOT, entryUrl: 'file:///etc/passwd', onNativeClose: () => undefined
    })).toThrow(/detached-window-entry-rejected/)
    expect(() => createDetachedWindowFactory({
      appRoot: APP_ROOT, entryUrl: 'https://evil.example/index.html', onNativeClose: () => undefined
    })).toThrow(/detached-window-entry-rejected/)
    expect(() => createDetachedWindowFactory({ appRoot: 'not-a-file-url', entryUrl: ENTRY, onNativeClose: () => undefined })).toThrow(/detached-window-entry-rejected/)
    // 显式 dev origin 白名单内允许（dev 态唯一入口）
    expect(() => createDetachedWindowFactory({
      appRoot: APP_ROOT, entryUrl: 'http://localhost:5173/index.html',
      devOrigins: ['http://localhost:5173'], onNativeClose: () => undefined
    })).not.toThrow()
  })

  it('用与主窗同一份安全基线构造 BrowserWindow，并且只加载受控 entry', async () => {
    const { factory } = createFactory()
    const handle = factory(input())
    const window = lastWindow()
    // bounds 逐字采用（取整），外观默认不显示
    expect(window.options).toMatchObject({
      x: 10, y: 20, width: 480, height: 360, title: 'Inspector', show: false, autoHideMenuBar: true,
      // PLAT-39 ①：装饰与主窗一致（darwin hiddenInset）+ 主题派生底色（不再是硬编码 #101114）
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      trafficLightPosition: { x: 14, y: 14 },
      backgroundColor: expect.stringMatching(/^#(0b0d10|ffffff)$/)
    })
    const webPreferences = window.options.webPreferences as Record<string, unknown>
    expect(webPreferences).toMatchObject({ ...SECURE_WINDOW_PREFERENCE_BASELINE, preload: PRELOAD })
    expect(webPreferences.nodeIntegration).toBe(false)
    expect(webPreferences.contextIsolation).toBe(true)
    expect(window.webContents.id).toBe(handle.webContentsId)
    expect(handle.isDestroyed()).toBe(false)

    await handle.loadURL(ENTRY)
    expect(window.webContents.loadedUrls).toEqual([ENTRY])
    expect(window.shown).toBe(1)
    // 逐次校验：运行期被替换/拼接的 URL 一律拒绝，且不会真的加载
    await expect(handle.loadURL('file:///etc/passwd')).rejects.toThrow(/detached-window-entry-rejected/)
    await expect(handle.loadURL('http://example.com/')).rejects.toThrow(/detached-window-entry-rejected/)
    expect(window.webContents.loadedUrls).toEqual([ENTRY])
  })

  it('不安全或缺失 preload 的注入 security 一律 fail closed，不 new 窗口', () => {
    const { factory } = createFactory()
    const unsafe = { webPreferences: { ...security.webPreferences, nodeIntegration: true }, applyWindowOpenHandler: () => undefined }
    expect(() => factory(input({ security: unsafe as unknown as typeof security }))).toThrow(/window-security-rejected/)
    const noPreload = { webPreferences: { ...security.webPreferences, preload: '' }, applyWindowOpenHandler: () => undefined }
    expect(() => factory(input({ security: noPreload as unknown as typeof security }))).toThrow(/window-security-rejected/)
    expect(electronMocks.windows).toHaveLength(0)
  })

  it('windowOpenHandler 一律 deny：http(s) 只交给 openExternal 出口，绝不新开窗口', () => {
    const { factory } = createFactory()
    factory(input())
    const handler = lastWindow().webContents.openHandler
    expect(handler).not.toBeNull()
    expect(handler?.({ url: 'https://example.com/docs' })).toEqual({ action: 'deny' })
    expect(electronMocks.openExternal).toHaveBeenCalledWith('https://example.com/docs')
    expect(handler?.({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' })
    expect(electronMocks.openExternal).toHaveBeenCalledTimes(1)
  })

  it('原生 X = 回停靠：close 被 preventDefault 并回调身份，窗口不由系统关闭', async () => {
    const { factory, nativeCloses } = createFactory()
    const handle = factory(input())
    const window = lastWindow()
    const event = { preventDefault: vi.fn() }
    window.emit('close', event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(nativeCloses).toEqual([{ windowInstanceId: 'window-target', hostEpoch: 2 }])
    expect(handle.isDestroyed()).toBe(false)
    expect(window.destroyed).toBe(false)
  })

  /**
   * P1-06m：退出期（app 级 quitting 标记）`close` **绝不** preventDefault。
   * 真机 P1-07R（runG/runI）：已提交独立窗存在时 `app.quit()` 被这条无条件 preventDefault 取消 ⇒
   * 所有窗口销毁但 Electron 主进程残留；无独立窗的 runH 正常退出构成对照。
   */
  it('P1-06m 退出期 close 绝不 preventDefault 也绝不回停靠（非退出期语义逐字不变）', () => {
    let quitting = false
    const { factory, nativeCloses } = createFactory({ isAppQuitting: () => quitting })
    const handle = factory(input())
    const window = lastWindow()

    // 非退出期：仍是 P1-06e 的无条件 preventDefault + 回停靠
    const beforeQuitEvent = { preventDefault: vi.fn() }
    window.emit('close', beforeQuitEvent)
    expect(beforeQuitEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(nativeCloses).toEqual([{ windowInstanceId: 'window-target', hostEpoch: 2 }])

    // 退出期：退出关窗相位不得被取消；也不触达回停靠（退出由 appExit 统一销毁派生窗）
    quitting = true
    const quittingEvent = { preventDefault: vi.fn() }
    window.emit('close', quittingEvent)
    expect(quittingEvent.preventDefault).not.toHaveBeenCalled()
    expect(nativeCloses).toEqual([{ windowInstanceId: 'window-target', hostEpoch: 2 }])
    expect(handle.isDestroyed()).toBe(false)
    expect(window.destroyed).toBe(false)
  })

  it('P1-06m 退出期窗口真正关闭后 closed 回收登记不丢失（崩溃订阅随窗口释放）', () => {
    const { factory, destroyed } = createFactory({ isAppQuitting: () => true })
    const handle = factory(input())
    const window = lastWindow()
    const unsubscribe = handle.onRendererGone?.(() => undefined)
    window.emit('close', { preventDefault: vi.fn() })
    window.destroy()
    expect(destroyed).toEqual([{ windowInstanceId: 'window-target', hostEpoch: 2 }])
    expect(() => unsubscribe?.()).not.toThrow()
  })

  it('N6/P1-06g：句柄只读暴露渲染器崩溃态（真实崩溃窗口 true、正常窗口 false）', () => {
    const { factory } = createFactory()
    const crashed = factory(input())
    const crashedWindow = lastWindow()
    const normal = factory(input({ windowInstanceId: 'window-normal', hostEpoch: 3 }))
    // 正常窗口：两条信号都未触发 ⇒ false
    expect(normal.isCrashed?.()).toBe(false)
    expect(crashed.isCrashed?.()).toBe(false)

    // 主信号：真实 render-process-gone 事件（只作用于该窗口的 webContents）
    crashedWindow.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 133 })
    expect(crashed.isCrashed?.()).toBe(true)
    expect(normal.isCrashed?.()).toBe(false)

    // 销毁后一律 false（窗口已不存在，绝不让已销毁窗口被报成崩溃）
    crashed.destroy()
    expect(crashed.isCrashed?.()).toBe(false)
  })

  it('N6/P1-06g：未收到事件时用 webContents.isCrashed() 兜底判定', () => {
    const { factory } = createFactory()
    const handle = factory(input())
    const window = lastWindow()
    expect(handle.isCrashed?.()).toBe(false)
    window.webContents.crashed = true
    expect(handle.isCrashed?.()).toBe(true)
  })

  it('N7/P1-06l：崩溃广播（退订后不再收、订阅者抛错不影响其它订阅者与窗口语义）', () => {
    const { factory, destroyed } = createFactory()
    const handle = factory(input())
    const window = lastWindow()
    const seen: string[] = []
    const unsubscribe = handle.onRendererGone?.(() => { seen.push('first') })
    handle.onRendererGone?.(() => { seen.push('throws'); throw new Error('consumer-failed') })
    handle.onRendererGone?.(() => { seen.push('third') })
    if (unsubscribe === undefined) throw new Error('no crash subscription')
    // 退订者绝不再收到（无残留监听器）
    unsubscribe()

    // 抛错的订阅者不影响其它订阅者，也不冒泡到 Electron 事件派发
    expect(() => window.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 133 })).not.toThrow()
    expect(seen).toEqual(['throws', 'third'])
    // 崩溃只广播一次（幂等）
    window.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 133 })
    expect(seen).toEqual(['throws', 'third'])
    // 崩溃广播不改窗口语义：窗口仍由调用方显式销毁
    expect(window.destroyed).toBe(false)
    handle.destroy()
    expect(destroyed).toEqual([{ windowInstanceId: 'window-target', hostEpoch: 2 }])
  })

  it('N7/P1-06l：崩溃已发生后订阅（迟到订阅）异步补发一次，绝不在订阅调用栈里同步回调', async () => {
    const { factory } = createFactory()
    const normal = factory(input())
    const late = factory(input({ windowInstanceId: 'window-late', hostEpoch: 3 }))
    const lateWindow = lastWindow()
    // 事件端口缺失时崩溃态先由 isCrashed() 兜底证明（模拟崩溃发生在监听之前）
    lateWindow.webContents.crashed = true
    expect(normal.isCrashed?.()).toBe(false)

    const seen: string[] = []
    late.onRendererGone?.(() => seen.push('late'))
    expect(seen).toEqual([])
    await Promise.resolve()
    expect(seen).toEqual(['late'])
    // 广播只补发一次；正常窗口不受影响
    await Promise.resolve()
    expect(seen).toEqual(['late'])
    expect(normal.isCrashed?.()).toBe(false)
  })

  it('N7/P1-06l：事件端口缺失时靠 isCrashed() 兜底轮询主动广播；退订/销毁后轮询立即停止（无残留定时器）', async () => {
    const { factory, destroyed } = createFactory({ crashProbeIntervalMs: 5 })
    const handle = factory(input())
    const window = lastWindow()
    const seen: string[] = []
    const unsubscribe = handle.onRendererGone?.(() => seen.push('probe'))
    if (unsubscribe === undefined) throw new Error('no crash subscription')
    // 没有任何 `render-process-gone` 事件，只有 isCrashed() 变化：轮询必须有界时间内发现并广播
    window.webContents.crashed = true
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(seen).toEqual(['probe'])
    expect(handle.isCrashed?.()).toBe(true)

    // 退订后轮询停止：再变化也不得广播（无残留监听器/定时器）
    unsubscribe()
    window.webContents.crashed = false
    window.webContents.crashed = true
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(seen).toEqual(['probe'])

    // 窗口销毁同样停掉轮询并回收登记
    handle.destroy()
    expect(destroyed).toEqual([{ windowInstanceId: 'window-target', hostEpoch: 2 }])
  })

  it('N7/P1-06l：无订阅者时绝不建立兜底轮询（零开销），crashProbeIntervalMs=0 时也关闭', async () => {
    const { factory } = createFactory({ crashProbeIntervalMs: 5 })
    const handle = factory(input())
    const window = lastWindow()
    window.webContents.crashed = true
    await new Promise((resolve) => setTimeout(resolve, 30))
    // 没有订阅者 ⇒ 没有任何广播通道，但只读判定照旧可用（绝不误报窗口语义）
    expect(handle.isCrashed?.()).toBe(true)

    const off = createFactory({ crashProbeIntervalMs: 0 })
    const offHandle = off.factory(input({ windowInstanceId: 'window-off', hostEpoch: 4 }))
    const offWindow = lastWindow()
    const seen: string[] = []
    offHandle.onRendererGone?.(() => seen.push('off'))
    offWindow.webContents.crashed = true
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(seen).toEqual([])
  })

  it('N6/P1-06g：真实工厂句柄 + 真实宿主 ⇒ 准备期崩溃的回滚理由是 window-crashed，不是 window-load-failed', async () => {
    const { factory } = createFactory()
    const registry = createWorkspaceWindowRegistry({ createOpaqueId: (prefix) => `${prefix}-1` })
    const source = registry.registerMainWindow({ webContentsId: 1 })
    const timers: Array<{ delayMs: number; run: () => void; cancelled: boolean }> = []
    const events: DetachedHostEvent[] = []
    const host = createPanelDetachedWindowHost({
      entryUrl: ENTRY,
      appRoot: APP_ROOT,
      createWindow: factory,
      security,
      registry,
      displays: () => [{ id: 'primary', workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
      timers: {
        schedule: (delayMs, run) => {
          const entry = { delayMs, run, cancelled: false }
          timers.push(entry)
          return () => { entry.cancelled = true }
        }
      },
      onEvent: (event) => events.push(event)
    })
    const created = await host.requestDetach({
      operationId: 'op-crash',
      workspaceInstanceKey: 'workspace-1',
      panelInstanceKey: 'panel-1',
      panelId: 'platform.inspector',
      title: 'Inspector',
      sourceHost: source,
      lastValidDock: 'embedded',
      supportedModes: ['embedded', 'docked-bottom', 'detached'],
      preferredSize: { width: 480, height: 360 },
      displayHintId: null
    })
    expect(created.status).toBe('awaiting-ready')

    // 渲染器在准备期真实崩溃：target-ready 永不到达。
    // N6/P1-06g + N7/P1-06l：真实工厂的 `render-process-gone` 现在会经崩溃订阅**主动**送达宿主，
    // 宿主立即按准备期回滚（不必等截止时间），因此准备期截止时间必须已被取消（无残留定时器）；
    // 截止时间驱动的同一条判定由 focused 回归 `panelDetachedWindowCrash.test.ts` 单独覆盖。
    lastWindow().webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 133 })
    expect(timers.filter((timer) => !timer.cancelled && timer.delayMs === WorkspaceTransferPolicy.prepareTargetTimeoutMs)).toEqual([])

    expect(events.at(-1)).toMatchObject({
      type: 'fallback', fallbackReason: 'window-crashed', fallbackMode: 'docked-bottom', source: 'window-failure'
    })
    expect(registry.detachedHostCount()).toBe(0)
    expect(host.pendingOperationIds()).toEqual([])
  })

  it('N7/P1-06l：真实工厂 + 真实宿主 ⇒ 已提交窗渲染器崩溃被主动回收（僵尸窗不得存活）', async () => {
    const { factory, destroyed } = createFactory()
    const registry = createWorkspaceWindowRegistry({ createOpaqueId: (prefix) => `${prefix}-1` })
    const source = registry.registerMainWindow({ webContentsId: 1 })
    const timers: Array<{ delayMs: number; run: () => void; cancelled: boolean }> = []
    const events: DetachedHostEvent[] = []
    const host = createPanelDetachedWindowHost({
      entryUrl: ENTRY,
      appRoot: APP_ROOT,
      createWindow: factory,
      security,
      registry,
      displays: () => [{ id: 'primary', workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
      timers: {
        schedule: (delayMs, run) => {
          const entry = { delayMs, run, cancelled: false }
          timers.push(entry)
          return () => { entry.cancelled = true }
        }
      },
      onEvent: (event) => events.push(event)
    })
    const created = await host.requestDetach({
      operationId: 'op-committed-crash',
      workspaceInstanceKey: 'workspace-1',
      panelInstanceKey: 'panel-committed',
      panelId: 'platform.inspector',
      title: 'Inspector',
      sourceHost: source,
      lastValidDock: 'embedded',
      supportedModes: ['embedded', 'docked-bottom', 'detached'],
      preferredSize: { width: 480, height: 360 },
      displayHintId: null
    })
    if (created.status !== 'awaiting-ready') throw new Error(`unexpected: ${JSON.stringify(created)}`)
    const target = registry.listDetachedHosts()[0]
    if (!target) throw new Error('no detached host')
    const hostOperationId = host.pendingOperationIds()[0]
    if (hostOperationId === undefined) throw new Error('no host operation')
    // 提交（目标 ready → 源 released）：进入「已提交」相位，此后没有任何探测点
    await host.confirmTargetReady({ operationId: hostOperationId, windowInstanceId: target.windowInstanceId, hostEpoch: target.hostEpoch })
    await host.confirmSourceReleased({ operationId: hostOperationId, windowInstanceId: target.windowInstanceId, hostEpoch: target.hostEpoch })
    expect(host.committedOwners()).toEqual(['panel-committed'])
    expect(registry.detachedHostCount()).toBe(1)
    const eventsBeforeCrash = events.length

    // 真机 67-a-p05-crash.json：窗口存活、渲染器已死（CDP eval 超时）——崩溃广播必须主动把窗口回收
    lastWindow().webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 133 })

    expect(lastWindow().destroyed).toBe(true)
    expect(destroyed).toEqual([{ windowInstanceId: target.windowInstanceId, hostEpoch: target.hostEpoch }])
    expect(registry.detachedHostCount()).toBe(0)
    expect(registry.describeWindow(target.windowInstanceId)).toBeUndefined()
    // 已提交窗的失败语义与 store 回停靠由 `closed` → app 侧 `forgetHostWindow` 收敛（见 wiring 端到端 ②）：
    // 宿主在这里只回收窗口，绝不抢跑 emit（否则同步 `closed` 会导致第二条 fallback）
    expect(events.length).toBe(eventsBeforeCrash)
    expect(timers.filter((timer) => !timer.cancelled)).toEqual([])
  })

  it('closed（窗口真的销毁）回调身份，供 app 侧回收 registry 登记与飞事务', () => {
    const { factory, destroyed } = createFactory()
    const handle = factory(input())
    handle.destroy()
    expect(handle.isDestroyed()).toBe(true)
    expect(destroyed).toEqual([{ windowInstanceId: 'window-target', hostEpoch: 2 }])
    // 销毁后 focus/destroy 都是 no-op，不得抛给调用方
    expect(() => { handle.focus(); handle.destroy() }).not.toThrow()
  })

  it('N3：注入 no-op applyWindowOpenHandler 时工厂仍无条件 deny（含宿主事后重装同一份结论）', () => {
    const { factory } = createFactory()
    const noopSecurity = {
      webPreferences: security.webPreferences,
      applyWindowOpenHandler: () => undefined
    }
    const handle = factory(input({ security: noopSecurity as unknown as typeof security }))
    const window = lastWindow()
    const handler = window.webContents.openHandler
    expect(handler).not.toBeNull()
    expect(handler?.({ url: 'https://example.com/docs' })).toEqual({ action: 'deny' })
    expect(electronMocks.openExternal).toHaveBeenCalledWith('https://example.com/docs')
    expect(handler?.({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' })
    expect(electronMocks.openExternal).toHaveBeenCalledTimes(1)
    // 宿主（P1-04）拿回句柄后会用注入 security 再装一次：no-op 也不得把 deny 结论改掉
    handle.setWindowOpenHandler((() => ({ action: 'allow' })) as never)
    const afterReinstall = window.webContents.openHandler
    expect(afterReinstall?.({ url: 'https://example.com/other' })).toEqual({ action: 'deny' })
    expect(afterReinstall?.({ url: 'about:blank' })).toEqual({ action: 'deny' })
  })

  it('N4/P1-06e：onNativeClose 必填——缺省在类型层即不可构造，运行期同样 fail closed', () => {
    // 类型层：缺必填回调直接编译失败（若把 onNativeClose 改回可选，@ts-expect-error 会因未生效而报错）
    // @ts-expect-error onNativeClose 必填：缺少它不得通过类型检查
    expect(() => createDetachedWindowFactory({ appRoot: APP_ROOT, entryUrl: ENTRY })).toThrow(/native-close/)
    expect(electronMocks.windows).toHaveLength(0)
    // 运行期：类型断言绕过（JS 调用方）也必须在构造期 fail closed，绝不产生无法回停靠的窗口
    expect(() => createDetachedWindowFactory({
      appRoot: APP_ROOT, entryUrl: ENTRY, onNativeClose: undefined
    } as unknown as Parameters<typeof createDetachedWindowFactory>[0])).toThrow(/native-close/)
    expect(electronMocks.windows).toHaveLength(0)
  })

  it('closes 消费者抛错时仍 preventDefault（绝不静默按逻辑关闭）', () => {
    const { factory } = createFactory({ onNativeClose: () => { throw new Error('bridge-failed') } })
    factory(input())
    const event = { preventDefault: vi.fn() }
    expect(() => lastWindow().emit('close', event)).not.toThrow()
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(lastWindow().destroyed).toBe(false)
  })

  it('工厂契约：句柄返回之前抛错必须自行销毁窗口', () => {
    const created: FakeWindow[] = []
    const factory = createDetachedWindowFactory({
      appRoot: APP_ROOT,
      entryUrl: ENTRY,
      onNativeClose: () => undefined,
      createBrowserWindow: (options) => {
        const window = {
          options,
          // 构造成功但接安全出口时失败：工厂必须自行销毁后再抛（宿主拿不到句柄）
          webContents: { id: 900, setWindowOpenHandler: () => { throw new Error('web-contents-unavailable') } },
          destroyed: false, shown: 0, focused: 0, listeners: new Map<string, Array<(...args: never[]) => void>>(),
          on: () => undefined, emit: () => undefined,
          isDestroyed() { return this.destroyed }, destroy() { this.destroyed = true }
        }
        created.push(window as unknown as FakeWindow)
        return window as never
      }
    })
    expect(() => factory(input())).toThrow(/web-contents-unavailable/)
    expect(created[0]?.destroyed).toBe(true)
  })
})
