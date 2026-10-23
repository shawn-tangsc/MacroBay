import { describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({ openExternal: vi.fn() }))

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: class {},
  shell: { openExternal: electronMocks.openExternal }
}))

import { WorkspaceTransferPolicy } from '@platform/workspace/policies'
import { createSecureWindowSecurity } from '../../window/createMainWindow'
import {
  createPanelDetachedWindowHost,
  type DetachedHostEvent,
  type DetachedWindowFactory,
  type DetachedWindowHandle
} from './panelDetachedWindowHost'
import { createWorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace。P1-06l focused 回归：**崩溃监测**（A-P05a / A-P05b）。
 *
 * 两条真机缺陷：
 * - A-P05a：加载期 `Page.crash` 与 `loadURL` 拒绝不在同一 tick 到达时，宿主把崩溃误判成
 *   `window-load-failed`（词表错）。修复要求：**先确认崩溃态再定词表**，且判定能力缺失/抛错时
 *   仍 fail-closed 报 `window-load-failed`，绝不猜测。
 * - A-P05b：**已提交**独立窗的渲染器崩溃此前只靠 `close/closed`（渲染器死了窗口还活着 ⇒ 无人察觉，
 *   面板永久停在 `detached` 且无承载者 = 僵尸窗）。修复要求：准备期与已提交期都主动感知并回收窗口。
 *
 * 全部用注入的 fake 窗口工厂 + 手动定时器，不启动 Electron、不读真实 profile。
 */

const PRELOAD = '/app/preload/index.js'
const APP_ROOT = 'file:///app/renderer'
const ENTRY = 'file:///app/renderer/index.html'

type FakeWindow = DetachedWindowHandle & {
  destroyed: boolean
  rendererCrashed: boolean
  crashListenerCount: number
  loadedUrls: string[]
}

type HarnessOptions = {
  /** loadURL 行为：默认成功。返回 reject 即模拟加载失败（可选地在拒绝前后落地崩溃态）。 */
  load?: (handle: FakeWindow) => Promise<void>
  /** 假句柄是否暴露 `isCrashed()`（缺失＝判定能力缺失，必须 fail-closed）。 */
  exposeIsCrashed?: boolean
  /** `isCrashed()` 是否抛错（判定能力异常，必须 fail-closed）。 */
  isCrashedThrows?: boolean
  /** 假句柄是否暴露 `onRendererGone`（缺失＝无法主动感知）。 */
  exposeCrashSubscription?: boolean
  /** 订阅端口是否抛错（工厂/句柄异常，不得让宿主崩掉）。 */
  subscribeThrows?: boolean
  /** 与 app.ts 一致：把工厂 `closed` 接到 onWindowDestroyed 消费方。 */
  onWindowDestroyed?: (windowInstanceId: string) => void
}

function createHarness(options: HarnessOptions = {}) {
  let sequence = 0
  const registry = createWorkspaceWindowRegistry({ createOpaqueId: (prefix) => `${prefix}-${++sequence}` })
  const main = registry.registerMainWindow({ webContentsId: 1 })
  const handles: FakeWindow[] = []
  const timers: { delayMs: number; run: () => void; cancelled: boolean }[] = []
  const events: DetachedHostEvent[] = []
  const security = createSecureWindowSecurity({ preload: PRELOAD, openExternal: (url) => void electronMocks.openExternal(url) })

  /** 让句柄进入「渲染器已崩溃」：置位真实标记并通知全部订阅者（退订后不得再收到）。 */
  const crashRenderer = (handle: FakeWindow): void => {
    if (handle.destroyed || handle.rendererCrashed) return
    handle.rendererCrashed = true
    for (const listener of [...crashListenersOf(handle)]) {
      try { listener() } catch { /* 订阅者异常不得影响窗口/其它订阅者 */ }
    }
  }
  const crashListenersOf = (handle: FakeWindow): Set<() => void> =>
    (handle as unknown as { crashListeners: Set<() => void> }).crashListeners

  const createWindow: DetachedWindowFactory = (input) => {
    const handle: FakeWindow = {
      webContentsId: handles.length + 100,
      destroyed: false,
      rendererCrashed: false,
      crashListenerCount: 0,
      loadedUrls: [],
      loadURL: (url) => {
        if (handle.destroyed) return Promise.reject(new Error('window-destroyed'))
        handle.loadedUrls.push(url)
        return options.load === undefined ? Promise.resolve() : options.load(handle)
      },
      isDestroyed: () => handle.destroyed,
      // 真实工厂顺序：`destroy()` 内**同步**派发 `closed`（异步会掩盖抢跑竞争）
      destroy: () => {
        if (handle.destroyed) return
        handle.destroyed = true
        crashListenersOf(handle).clear()
        handle.crashListenerCount = 0
        options.onWindowDestroyed?.(input.windowInstanceId)
      },
      focus: () => undefined,
      setWindowOpenHandler: () => undefined
    }
    // 真实崩溃语义：窗口销毁后 `isCrashed()` 一律 false（已销毁的窗口绝不被报成崩溃）
    if (options.exposeIsCrashed !== false) {
      handle.isCrashed = () => {
        if (handle.destroyed) return false
        if (options.isCrashedThrows === true) throw new Error('probe-unavailable')
        return handle.rendererCrashed
      }
    }
    const listeners = new Set<() => void>()
    ;(handle as unknown as { crashListeners: Set<() => void> }).crashListeners = listeners
    if (options.exposeCrashSubscription !== false) {
      handle.onRendererGone = (listener) => {
        if (options.subscribeThrows === true) throw new Error('subscribe-unavailable')
        listeners.add(listener)
        handle.crashListenerCount = listeners.size
        return () => { listeners.delete(listener); handle.crashListenerCount = listeners.size }
      }
    }
    handles.push(handle)
    return handle
  }

  const host = createPanelDetachedWindowHost({
    entryUrl: ENTRY,
    appRoot: APP_ROOT,
    createWindow,
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
    onEvent: (event) => { events.push(event) }
  })

  const request = (operationId: string) => host.requestDetach({
    operationId,
    workspaceInstanceKey: 'workspace-1',
    panelInstanceKey: `panel-${operationId}`,
    panelId: 'platform.inspector',
    title: 'Inspector',
    sourceHost: main,
    lastValidDock: 'docked-right',
    supportedModes: ['embedded', 'docked-right', 'docked-bottom', 'detached'],
    preferredSize: { width: 480, height: 360 },
    displayHintId: null
  })

  const fallbacks = () => events.filter((entry) => entry.type === 'fallback')

  /** 目标 ready → 源 released：把窗口推进到**已提交**相位（与真机 detach 提交后同形）。 */
  const commit = async (operationId: string, hostOperationId: string) => {
    await host.confirmTargetReady({ operationId: hostOperationId, windowInstanceId: registry.listDetachedHosts()[0]?.windowInstanceId ?? '', hostEpoch: registry.listDetachedHosts()[0]?.hostEpoch ?? 0 })
    return host.confirmSourceReleased({
      operationId: hostOperationId,
      windowInstanceId: registry.listDetachedHosts()[0]?.windowInstanceId ?? '',
      hostEpoch: registry.listDetachedHosts()[0]?.hostEpoch ?? 0
    })
  }

  return {
    registry, main, handles, timers, events, host, request, crashRenderer, commit, fallbacks,
    fireTimer: (delayMs: number) => {
      const due = timers.filter((timer) => !timer.cancelled && timer.delayMs === delayMs)
      for (const timer of due) { timer.cancelled = true; timer.run() }
      return due.length
    },
    pendingTimerDelays: () => [...new Set(timers.filter((timer) => !timer.cancelled).map((timer) => timer.delayMs))]
  }
}

/** 排空微任务 + 一轮宏任务：崩溃订阅/回滚链都在这些边界上收敛。 */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 12; turn += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  for (let turn = 0; turn < 12; turn += 1) await Promise.resolve()
}

describe('P1-06l / A-P05a：加载期崩溃词表（先确认崩溃态，再定词表）', () => {
  it('loadURL 拒绝后崩溃态在**紧随其后的微任务**落地 ⇒ window-crashed（不得误报 window-load-failed）', async () => {
    const f = createHarness({
      load: (handle) => {
        const rejected = Promise.reject(new Error('ERR_FAILED'))
        // 真实时序：崩溃信号与加载失败不在同一 tick；这里在宿主处理拒绝之后的微任务里落地崩溃态
        void Promise.resolve().then(() => Promise.resolve()).then(() => { f.crashRenderer(handle) })
        return rejected
      }
    })
    const outcome = await f.request('op-load-crash-microtask')
    expect(outcome).toMatchObject({ status: 'rolled-back', fallbackReason: 'window-crashed' })
    expect(f.fallbacks().at(-1)).toMatchObject({ type: 'fallback', fallbackReason: 'window-crashed', source: 'window-failure' })
    expect(f.handles[0]?.destroyed).toBe(true)
    expect(f.registry.detachedHostCount()).toBe(0)
    expect(f.host.pendingOperationIds()).toEqual([])
  })

  it('loadURL 拒绝后崩溃态在**紧随其后的一轮事件循环**落地 ⇒ window-crashed（真机 7D/7E/7F 时序）', async () => {
    const f = createHarness({
      load: (handle) => {
        // 真机：Page.crash 的 render-process-gone 与 loadURL 拒绝分属两个原生任务，故晚一个宏任务才可见
        setTimeout(() => { f.crashRenderer(handle) }, 0)
        return Promise.reject(new Error('ERR_FAILED'))
      }
    })
    const outcome = await f.request('op-load-crash-macrotask')
    expect(outcome).toMatchObject({ status: 'rolled-back', fallbackReason: 'window-crashed' })
    expect(f.fallbacks().map((entry) => entry.fallbackReason)).toEqual(['window-crashed'])
    expect(f.handles[0]?.destroyed).toBe(true)
    expect(f.registry.detachedHostCount()).toBe(0)
    expect(f.registry.listWindows()).toHaveLength(1)
    expect(f.pendingTimerDelays()).toEqual([])
  })

  it('崩溃信号先到（isCrashed 已为真的同 tick 加载失败）⇒ window-crashed（信号优先级不变）', async () => {
    const f = createHarness({
      load: (handle) => { f.crashRenderer(handle); return Promise.reject(new Error('ERR_FAILED')) }
    })
    expect(await f.request('op-crash-first')).toMatchObject({ status: 'rolled-back', fallbackReason: 'window-crashed' })
  })

  it('fail-closed：判定能力缺失 / 抛错 / 订阅端口抛错时一律 window-load-failed，绝不猜测崩溃', async () => {
    const missing = createHarness({ exposeIsCrashed: false, exposeCrashSubscription: false, load: () => Promise.reject(new Error('load failed')) })
    expect(await missing.request('op-no-probe')).toMatchObject({ status: 'rolled-back', fallbackReason: 'window-load-failed' })

    const throwing = createHarness({ isCrashedThrows: true, load: () => Promise.reject(new Error('load failed')) })
    expect(await throwing.request('op-throwing-probe')).toMatchObject({ status: 'rolled-back', fallbackReason: 'window-load-failed' })

    const subscribeFails = createHarness({ subscribeThrows: true, load: () => Promise.reject(new Error('load failed')) })
    expect(await subscribeFails.request('op-subscribe-throws')).toMatchObject({ status: 'rolled-back', fallbackReason: 'window-load-failed' })
    expect(subscribeFails.fallbacks().map((entry) => entry.fallbackReason)).toEqual(['window-load-failed'])
    for (const f of [missing, throwing, subscribeFails]) {
      expect(f.registry.detachedHostCount()).toBe(0)
      expect(f.handles[0]?.destroyed).toBe(true)
    }
  })

  it('非崩溃的加载失败仍如实报 window-load-failed（词表不放宽）', async () => {
    const f = createHarness({ load: () => Promise.reject(new Error('net::ERR_CONNECTION_REFUSED')) })
    expect(await f.request('op-plain-load-failure')).toMatchObject({ status: 'rolled-back', fallbackReason: 'window-load-failed' })
  })
})

describe('P1-06l / A-P05b：准备期与已提交期的崩溃监测', () => {
  it('准备期（awaiting-ready）渲染器崩溃 ⇒ 主动回滚：window-crashed + 零孤儿 + 无残留订阅', async () => {
    const f = createHarness()
    const created = await f.request('op-prepare-crash')
    expect(created.status).toBe('awaiting-ready')
    expect(f.handles[0]?.crashListenerCount).toBe(1)

    f.crashRenderer(f.handles[0] as FakeWindow)
    await settle()

    expect(f.fallbacks().map((entry) => entry.fallbackReason)).toEqual(['window-crashed'])
    expect(f.fallbacks().at(-1)?.fallbackMode).toBe('docked-right')
    expect(f.handles[0]?.destroyed).toBe(true)
    expect(f.handles[0]?.crashListenerCount).toBe(0)
    expect(f.registry.detachedHostCount()).toBe(0)
    expect(f.registry.listWindows()).toHaveLength(1)
    expect(f.host.pendingOperationIds()).toEqual([])
    expect(f.pendingTimerDelays()).toEqual([])
  })

  it('准备期崩溃的判定能力只剩 isCrashed()（无事件端口）时仍不得被忽略：到期回滚报 window-crashed', async () => {
    const f = createHarness({ exposeCrashSubscription: false })
    const created = await f.request('op-prepare-crash-probe-only')
    expect(created.status).toBe('awaiting-ready')
    ;(f.handles[0] as FakeWindow).rendererCrashed = true
    expect(f.fireTimer(WorkspaceTransferPolicy.prepareTargetTimeoutMs)).toBe(1)
    await settle()
    expect(f.fallbacks().map((entry) => entry.fallbackReason)).toEqual(['window-crashed'])
    expect(f.handles[0]?.destroyed).toBe(true)
    expect(f.registry.detachedHostCount()).toBe(0)
  })

  it('已提交独立窗渲染器崩溃 ⇒ 窗口被主动回收（僵尸窗必须消失，绝不静默停在 detached）', async () => {
    const destroyed: string[] = []
    const f = createHarness({ onWindowDestroyed: (windowInstanceId) => destroyed.push(windowInstanceId) })
    const created = await f.request('op-committed-crash')
    const target = f.registry.listDetachedHosts()[0]
    if (!target) throw new Error('no detached host')
    const hostOperationId = f.host.pendingOperationIds()[0]
    if (hostOperationId === undefined) throw new Error('no host operation')
    expect(created.status).toBe('awaiting-ready')
    await f.commit('op-committed-crash', hostOperationId)
    expect(f.host.committedOwners()).toEqual(['panel-op-committed-crash'])
    expect(f.registry.detachedHostCount()).toBe(1)

    // 渲染器崩溃：窗口本身还活着（真机 67-a-p05-crash.json：窗口存活、渲染器已死、无任何 fallback）
    f.crashRenderer(f.handles[0] as FakeWindow)
    await settle()

    // 窗口被回收（destroyed + 登记释放 + closed 已派发），绝不留下「detached 但窗口仍在」的僵尸
    expect(f.handles[0]?.destroyed).toBe(true)
    expect(destroyed).toEqual([target.windowInstanceId])
    expect(f.registry.describeWindow(target.windowInstanceId)).toBeUndefined()
    expect(f.registry.detachedHostCount()).toBe(0)
    expect(f.handles[0]?.crashListenerCount).toBe(0)
    expect(f.pendingTimerDelays()).toEqual([])
  })

  it('释放期（awaiting-release）渲染器崩溃 ⇒ 立即回滚 window-crashed：窗口/登记/截止时间全部收敛', async () => {
    const f = createHarness()
    await f.request('op-release-crash')
    const target = f.registry.listDetachedHosts()[0]
    if (!target) throw new Error('no detached host')
    const hostOperationId = f.host.pendingOperationIds()[0]
    if (hostOperationId === undefined) throw new Error('no host operation')
    // 目标 ready：进入 awaiting-release（源释放截止时间已武装）
    await f.host.confirmTargetReady({ operationId: hostOperationId, windowInstanceId: target.windowInstanceId, hostEpoch: target.hostEpoch })
    expect(f.host.committedOwners()).toEqual([])

    f.crashRenderer(f.handles[0] as FakeWindow)
    await settle()

    expect(f.fallbacks().map((entry) => entry.fallbackReason)).toEqual(['window-crashed'])
    expect(f.handles[0]?.destroyed).toBe(true)
    expect(f.registry.detachedHostCount()).toBe(0)
    expect(f.host.pendingOperationIds()).toEqual([])
    expect(f.pendingTimerDelays()).toEqual([])
  })

  it('appExit 之后崩溃监测不再触发：订阅全部释放，迟到崩溃信号不改状态、不抛错', async () => {
    const f = createHarness()
    await f.request('op-exit-crash')
    const handle = f.handles[0] as FakeWindow
    expect(handle.crashListenerCount).toBe(1)
    const summary = await f.host.appExit({ flush: () => undefined })
    expect(summary.destroyedWindowIds).toHaveLength(1)
    expect(handle.crashListenerCount).toBe(0)
    const eventsAfterExit = f.events.length
    // 迟到的崩溃信号（订阅已释放 + exiting 守卫）：不得再派发任何事件、不得抛错
    handle.rendererCrashed = false
    handle.destroyed = false
    f.crashRenderer(handle)
    await settle()
    expect(f.events.length).toBe(eventsAfterExit)
    expect(f.registry.detachedHostCount()).toBe(0)
  })
})
