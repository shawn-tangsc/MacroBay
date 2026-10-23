import { describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({ openExternal: vi.fn() }))

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: class {},
  shell: { openExternal: electronMocks.openExternal }
}))

import { WorkspaceOwnershipPolicy, WorkspaceTransferPolicy } from '@platform/workspace/policies'
import { createSecureWindowSecurity, isAllowedAppWindowEntryUrl, type WorkspaceWindowSecurityInput } from '../../window/createMainWindow'
import { pathToFileURL } from 'node:url'
import { createWorkspaceWindowRegistry } from './workspaceWindowRegistry'
import { resolveFailureFallbackMode, resolveUserDockMode, WorkspaceDockFallbackChain } from './workspaceWindowBounds'
import {
  createPanelDetachedWindowHost,
  type DetachedHostEvent,
  type DetachedHostOutcome,
  type DetachedWindowFactory,
  type DetachedWindowHandle
} from './panelDetachedWindowHost'

/**
 * Owner: platform/desktop/main/workspace。回归 P1-04 事件/时序矩阵：
 * create / load / ready / timeout / crash / unresponsive / native-X / app-exit / late-window / budget。
 * 全部用注入的 fake 窗口工厂 + 手动定时器，不启动 Electron。
 */

const PRELOAD = '/app/preload/index.js'
const APP_ROOT = 'file:///app/renderer'
const ENTRY = 'file:///app/renderer/index.html'

function createHarness(overrides: {
  entryUrl?: string
  appRoot?: string
  devOrigins?: readonly string[]
  security?: WorkspaceWindowSecurityInput
  onEvent?: (event: DetachedHostEvent) => void
  scheduleThrows?: boolean
  loadHangs?: boolean
  /** N6：假句柄是否报告渲染器进程已崩溃（生产＝`webContents.isCrashed()`）。 */
  crashed?: boolean
  displays?: readonly { id: string; workArea: { x: number; y: number; width: number; height: number } }[]
} = {}) {
  let sequence = 0
  const registry = createWorkspaceWindowRegistry({ createOpaqueId: (prefix) => `${prefix}-${++sequence}` })
  const main = registry.registerMainWindow({ webContentsId: 1 })
  const handles: FakeWindow[] = []
  const timers: { delayMs: number; run: () => void; cancelled: boolean }[] = []
  const events: DetachedHostEvent[] = []
  const security = overrides.security ?? createSecureWindowSecurity({ preload: PRELOAD, openExternal: (url) => void electronMocks.openExternal(url) })

  const createWindow: DetachedWindowFactory = (input) => {
    if (factoryFailure !== null) throw factoryFailure
    const handle = createFakeWindow(handles.length + 100, input, loadFailure, overrides.loadHangs === true, () => crashed)
    handles.push(handle)
    return handle
  }
  let factoryFailure: Error | null = null
  let loadFailure: Error | null = null
  let crashed = overrides.crashed === true

  const host = createPanelDetachedWindowHost({
    entryUrl: overrides.entryUrl ?? ENTRY,
    appRoot: overrides.appRoot ?? APP_ROOT,
    devOrigins: overrides.devOrigins,
    createWindow,
    security,
    registry,
    displays: () => overrides.displays ?? [{ id: 'primary', workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
    timers: {
      schedule: (delayMs, run) => {
        if (overrides.scheduleThrows) throw new Error('scheduler-unavailable')
        const entry = { delayMs, run, cancelled: false }
        timers.push(entry)
        return () => { entry.cancelled = true }
      }
    },
    onEvent: (event) => { events.push(event); overrides.onEvent?.(event) }
  })

  const request = (operationId: string, extra: Partial<Parameters<typeof host.requestDetach>[0]> = {}) => host.requestDetach({
    operationId,
    workspaceInstanceKey: 'workspace-1',
    panelInstanceKey: `panel-${operationId}`,
    panelId: 'platform.inspector',
    title: 'Inspector',
    sourceHost: main,
    lastValidDock: 'docked-right',
    supportedModes: ['embedded', 'docked-right', 'docked-bottom', 'detached'],
    preferredSize: { width: 480, height: 360 },
    displayHintId: null,
    ...extra
  })

  return {
    registry, main, handles, timers, events, security,
    request,
    host,
    setFactoryFailure: (error: Error | null) => { factoryFailure = error },
    setLoadFailure: (error: Error | null) => { loadFailure = error },
    setCrashed: (value: boolean) => { crashed = value },
    fireTimer: (index = 0) => { const entry = timers.filter((timer) => !timer.cancelled)[index]; if (!entry) throw new Error('no pending timer'); entry.cancelled = true; entry.run() },
    pendingTimerDelays: () => timers.filter((timer) => !timer.cancelled).map((timer) => timer.delayMs)
  }
}

type FakeWindow = DetachedWindowHandle & { destroyed: boolean; focused: number; loadedUrls: string[]; windowOpenHandler: ((details: { url: string }) => { action: 'deny' }) | null }

function createFakeWindow(webContentsId: number, input: { windowInstanceId: string }, loadFailure: Error | null, loadHangs: boolean, isRendererCrashed: () => boolean): FakeWindow {
  const handle: FakeWindow = {
    webContentsId,
    destroyed: false,
    focused: 0,
    loadedUrls: [],
    windowOpenHandler: null,
    isCrashed: () => isRendererCrashed(),
    loadURL: (url) => { if (loadFailure !== null) return Promise.reject(loadFailure); handle.loadedUrls.push(url); return loadHangs ? new Promise<void>(() => undefined) : Promise.resolve() },
    isDestroyed: () => handle.destroyed,
    destroy: () => { if (handle.destroyed) throw new Error(`double destroy ${input.windowInstanceId}`); handle.destroyed = true },
    focus: () => { handle.focused += 1 },
    setWindowOpenHandler: (handler) => { handle.windowOpenHandler = handler }
  }
  return handle
}

function expectRolledBack(outcome: DetachedHostOutcome, reason: string): void {
  expect(outcome).toMatchObject({ status: 'rolled-back', fallbackReason: reason })
}

describe('panel detached window host', () => {
  it('creates a Main-only empty-shell window with the shared security set and normalized bounds', async () => {
    const f = createHarness()
    const outcome = await f.request('op-1')

    expect(outcome).toEqual({ status: 'awaiting-ready', operationId: 'op-1', windowInstanceId: 'window-2', hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch + 1 })
    expect(f.handles).toHaveLength(1)
    expect(f.handles[0].loadedUrls).toEqual([ENTRY])
    expect(f.registry.detachedHostCount()).toBe(1)
    // 独立窗与主窗消费同一安全集合：工厂收到的就是共享对象本身
    expect(f.security.webPreferences.contextIsolation).toBe(true)
    expect(f.security.webPreferences.nodeIntegration).toBe(false)
    // window.open 一律 deny，外链走注入的 openExternal
    expect(f.handles[0].windowOpenHandler?.({ url: 'https://example.com/doc' })).toEqual({ action: 'deny' })
    expect(electronMocks.openExternal).toHaveBeenCalledWith('https://example.com/doc')
    expect(f.handles[0].windowOpenHandler?.({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' })
    expect(electronMocks.openExternal).toHaveBeenCalledTimes(1)
    expect(f.events.map((event) => event.type)).toEqual(['container-change-requested', 'container-changing'])
    expect(f.pendingTimerDelays()).toEqual([WorkspaceTransferPolicy.prepareTargetTimeoutMs])
  })

  it('rolls back with window-create-failed and leaves zero orphans', async () => {
    const f = createHarness()
    f.setFactoryFailure(new Error('boom'))
    expectRolledBack(await f.request('op-1'), 'window-create-failed')
    expect(f.registry.detachedHostCount()).toBe(0)
    expect(f.registry.listWindows()).toHaveLength(1)
    expect(f.events.at(-1)).toMatchObject({ type: 'fallback', fallbackReason: 'window-create-failed', fallbackMode: 'docked-right', source: 'window-failure' })
  })

  it('rolls back with window-load-failed and destroys the half-built window', async () => {
    const f = createHarness()
    f.setLoadFailure(new Error('load failed'))
    expectRolledBack(await f.request('op-1'), 'window-load-failed')
    expect(f.handles[0].destroyed).toBe(true)
    expect(f.registry.listDetachedHosts()).toEqual([])
    expect(f.registry.listWindows()).toHaveLength(1)
  })

  it('hosts a detached window from an app root whose real path contains spaces and non-ASCII', async () => {
    const rootPath = '/Applications/My App 工作区.app/renderer'
    const f = createHarness({ appRoot: pathToFileURL(rootPath).href, entryUrl: pathToFileURL(`${rootPath}/index.html`).href })
    expect(await f.request('op-1')).toMatchObject({ status: 'awaiting-ready' })
    expect(f.handles[0].loadedUrls).toEqual([pathToFileURL(`${rootPath}/index.html`).href])
  })

  it('rolls back a hanging entry load instead of hanging the caller', async () => {
    const f = createHarness({ loadHangs: true })
    const pending = f.request('op-1')
    // prepare 截止时间必须在建窗时就已生效（与 loadURL 是否 settle 无关）
    expect(f.pendingTimerDelays()).toEqual([WorkspaceTransferPolicy.prepareTargetTimeoutMs])
    f.fireTimer()
    expectRolledBack(await pending, 'window-load-failed')
    expect(f.handles[0].destroyed).toBe(true)
    expect(f.registry.detachedHostCount()).toBe(0)
    expect(f.host.pendingOperationIds()).toEqual([])
  })

  it('rolls back a hanging load even when the timer port is unavailable', async () => {
    const f = createHarness({ loadHangs: true, scheduleThrows: true })
    // 调度不可用必须降级为「立即超时」而不是悬挂等待
    expectRolledBack(await f.request('op-1'), 'window-load-failed')
    expect(f.handles[0].destroyed).toBe(true)
    expect(f.registry.detachedHostCount()).toBe(0)
  })

  it('reclaims a current-identity window that has no operation yet', async () => {
    const f = createHarness({ loadHangs: true })
    const pending = f.request('op-1')
    const registered = f.registry.listDetachedHosts()[0]
    expect(f.host.pendingOperationIds()).toEqual([]) // prepare 期：窗口已登记但尚无 operation
    expect(f.host.reportWindowFailure({ windowInstanceId: registered.windowInstanceId, hostEpoch: registered.hostEpoch, kind: 'crash' }))
      .toEqual({ status: 'rolled-back', operationId: '', fallbackReason: 'window-crashed', fallbackMode: undefined })
    expect(f.handles[0].destroyed).toBe(true)
    expect(f.registry.detachedHostCount()).toBe(0)
    f.fireTimer()
    expectRolledBack(await pending, 'window-load-failed')
  })

  it('reports consumer failures once and never rethrows a stale one', async () => {
    let thrown = 0
    const f = createHarness({ onEvent: (event) => { if (event.type === 'container-change-requested') { thrown += 1; throw new Error(`consumer-exploded-${thrown}`) } } })
    await f.request('op-1')

    const first = f.host.appExit({ flush: () => undefined })
    await expect(first).rejects.toThrow('consumer-exploded-1')
    await expect(first).rejects.toMatchObject({ appExitSummary: { consumerFailures: 1, firstConsumerFailure: expect.any(Error) } })

    // 诊断被消费一次即清空：第二次 appExit 不得再抛已过期的失败
    const second = await f.host.appExit({ flush: () => undefined })
    expect(second.consumerFailures).toBe(0)
    expect(second.firstConsumerFailure).toBeNull()
  })

  it('bounds consumer-failure diagnostics to a count plus the first failure', async () => {
    let thrown = 0
    const f = createHarness({ onEvent: () => { thrown += 1; throw new Error(`boom-${thrown}`) } })
    await f.request('op-1')
    await f.request('op-2') // 两次成功分离各发 requested + changing = 4 次消费者异常

    const beforeExit = f.events.length
    expect(beforeExit).toBe(4) // 两次成功分离各发 requested + changing
    const error = (await f.host.appExit({ flush: () => undefined }).catch((failure: unknown) => failure)) as Error & { appExitSummary?: { consumerFailures: number; firstConsumerFailure: unknown } }
    expect(error.message).toBe('boom-1') // 首条失败原样抛出（有界：只保留首条 + 计数）
    expect(error.appExitSummary?.consumerFailures).toBe(beforeExit + 2) // appExit 还会为两个未完成 operation 各发一条 host-detach
    expect(error.appExitSummary?.firstConsumerFailure).toBeInstanceOf(Error)
    expect(f.handles.every((handle) => handle.destroyed)).toBe(true)
    expect(f.registry.detachedHostCount()).toBe(0)
  })

  it('completes app-exit cleanup even when the event consumer throws', async () => {
    const f = createHarness({ onEvent: (event) => { if (event.type === 'host-detach') throw new Error('consumer-exploded') } })
    await f.request('op-1')
    await f.request('op-2')

    await expect(f.host.appExit({ flush: () => undefined })).rejects.toThrow('consumer-exploded')
    expect(f.handles.every((handle) => handle.destroyed)).toBe(true)
    expect(f.registry.detachedHostCount()).toBe(0)
    expect(f.registry.listDetachedHosts()).toEqual([])
    expect(f.host.pendingOperationIds()).toEqual([])
  })

  it('rolls back instead of leaking the window when the timer port refuses to schedule', async () => {
    const f = createHarness({ scheduleThrows: true })
    expectRolledBack(await f.request('op-1'), 'window-load-failed')
    expect(f.handles).toHaveLength(1)
    expect(f.handles[0].destroyed).toBe(true)
    expect(f.registry.detachedHostCount()).toBe(0)
    expect(f.host.pendingOperationIds()).toEqual([])
  })

  it('reports a failed app-exit flush instead of claiming it flushed', async () => {
    const f = createHarness()
    await f.request('op-1')
    const summary = await f.host.appExit({ flush: () => Promise.reject(new Error('flush-failed')) })
    expect(summary.flushed).toBe(false)
    expect(summary.flushOutcome).toBe('failed')
    expect(f.handles[0].destroyed).toBe(true)
  })

  it('reports a bounded app-exit flush timeout', async () => {
    const f = createHarness()
    await f.request('op-1')
    const exiting = f.host.appExit({ flush: () => new Promise<void>(() => undefined) })
    f.fireTimer(1) // index 0 是 ready 超时；index 1 才是 app-exit 的有界 flush
    const summary = await exiting
    expect(summary.flushOutcome).toBe('timeout')
    expect(summary.flushed).toBe(false)
    expect(f.handles[0].destroyed).toBe(true)
    expect(f.registry.detachedHostCount()).toBe(0)
  })

  it('ignores a window failure report carrying a stale host epoch', async () => {
    const f = createHarness()
    const created = await f.request('op-1')
    if (created.status !== 'awaiting-ready') throw new Error('expected awaiting-ready')
    f.host.confirmTargetReady({ operationId: 'op-1', windowInstanceId: created.windowInstanceId, hostEpoch: created.hostEpoch })

    expect(f.host.reportWindowFailure({ windowInstanceId: created.windowInstanceId, hostEpoch: created.hostEpoch + 1, kind: 'crash' }))
      .toEqual({ status: 'rejected', operationId: 'op-1', errorCode: 'invalid-request' })
    expect(f.handles[0].destroyed).toBe(false)
    expect(f.registry.detachedHostCount()).toBe(1)
  })

  it('ignores a native close carrying a stale host epoch', async () => {
    const f = createHarness()
    const created = await f.request('op-1')
    if (created.status !== 'awaiting-ready') throw new Error('expected awaiting-ready')
    expect(f.host.handleNativeClose({ windowInstanceId: created.windowInstanceId, hostEpoch: created.hostEpoch + 1, lastValidDock: 'docked-right', supportedModes: ['embedded', 'docked-right'] }))
      .toEqual({ status: 'ignored', reason: 'epoch-mismatch' })
    expect(f.handles[0].destroyed).toBe(false)
    expect(f.registry.detachedHostCount()).toBe(1)
    expect(f.host.pendingOperationIds()).toEqual(['op-1'])
  })

  it('uses the safe fallback chain for error paths and lastValidDock only for user re-docking', async () => {
    const f = createHarness()
    f.setFactoryFailure(new Error('boom'))
    expect(await f.request('op-1', { lastValidDock: 'docked-bottom' }))
      .toMatchObject({ status: 'rolled-back', fallbackReason: 'window-create-failed', fallbackMode: 'docked-right' })

    const allModes = ['embedded', 'docked-right', 'docked-bottom'] as const
    expect(resolveFailureFallbackMode(allModes)).toBe('docked-right')
    expect(resolveUserDockMode({ lastValidDock: 'docked-bottom', supportedModes: allModes })).toBe('docked-bottom')
    expect(resolveFailureFallbackMode(['docked-bottom', 'embedded'])).toBe('docked-bottom')
    expect(resolveUserDockMode({ lastValidDock: 'docked-bottom', supportedModes: ['embedded'] })).toBe('embedded')
  })

  it('ignores a late duplicate release ACK without touching the layout again', async () => {
    const f = createHarness()
    const created = await f.request('op-1')
    if (created.status !== 'awaiting-ready') throw new Error('expected awaiting-ready')
    const claim = { operationId: 'op-1', windowInstanceId: created.windowInstanceId, hostEpoch: created.hostEpoch }
    f.host.confirmTargetReady(claim)

    expect(f.host.confirmSourceReleased(claim)).toMatchObject({ accepted: true, outcome: { status: 'committed' } })
    expect(f.events.filter((event) => event.type === 'container-changed')).toHaveLength(1)
    expect(f.host.confirmSourceReleased(claim)).toEqual({ accepted: false, reason: 'already-committed' })
    expect(f.host.confirmSourceInvalid(claim)).toEqual({ accepted: false, reason: 'already-committed' })
    expect(f.events.filter((event) => event.type === 'container-changed')).toHaveLength(1)
    expect(f.host.committedOwners()).toEqual(['panel-op-1'])
  })

  it('destroys the window when creation-phase security setup throws', async () => {
    const throwingSecurity: WorkspaceWindowSecurityInput = {
      ...createSecureWindowSecurity({ preload: PRELOAD, openExternal: () => undefined }),
      applyWindowOpenHandler: () => { throw new Error('security apply failed') }
    }
    const f = createHarness({ security: throwingSecurity })
    expectRolledBack(await f.request('op-1'), 'window-create-failed')
    expect(f.handles).toHaveLength(1)
    expect(f.handles[0].destroyed).toBe(true)
    expect(f.registry.detachedHostCount()).toBe(0)
    expect(f.registry.listDetachedHosts()).toEqual([])
    expect(f.registry.listWindows()).toHaveLength(1)
  })

  it('never opens a second window for the same panel and focuses the existing host', async () => {
    const f = createHarness()
    const first = await f.request('op-1')
    if (first.status !== 'awaiting-ready') throw new Error('expected awaiting-ready')
    const samePanel = 'panel-op-1'

    // 尚未 ready：合并到同一个 operation，不建第二个窗
    const merged = await f.request('op-2', { panelInstanceKey: samePanel })
    expect(merged).toEqual(first)
    expect(f.handles).toHaveLength(1)
    expect(f.registry.detachedHostCount()).toBe(1)
    expect(f.host.pendingOperationIds()).toEqual(['op-1'])

    // 已 commit：聚焦既有窗口并幂等返回，不建第二个窗
    f.host.confirmTargetReady({ operationId: 'op-1', windowInstanceId: first.windowInstanceId, hostEpoch: first.hostEpoch })
    f.host.confirmSourceReleased({ operationId: 'op-1', windowInstanceId: first.windowInstanceId, hostEpoch: first.hostEpoch })
    expect(await f.request('op-3', { panelInstanceKey: samePanel }))
      .toEqual({ status: 'already-detached', operationId: 'op-3', windowInstanceId: first.windowInstanceId, hostEpoch: first.hostEpoch })
    expect(f.handles).toHaveLength(1)
    expect(f.registry.detachedHostCount()).toBe(1)
    expect(f.handles[0].focused).toBe(1)

    // 对照：不同面板各自建窗
    const other = await f.request('op-4')
    expect(other.status).toBe('awaiting-ready')
    expect(f.handles).toHaveLength(2)
    expect(f.registry.detachedHostCount()).toBe(2)
  })

  it('commits only after a release ACK from the current source host', async () => {
    const f = createHarness()
    const created = await f.request('op-1')
    if (created.status !== 'awaiting-ready') throw new Error('expected awaiting-ready')

    expect(f.host.confirmTargetReady({ operationId: 'op-1', windowInstanceId: created.windowInstanceId, hostEpoch: created.hostEpoch })).toMatchObject({ accepted: true })
    expect(f.pendingTimerDelays()).toEqual([WorkspaceTransferPolicy.releaseTimeoutMs])
    expect(f.host.confirmSourceReleased({ operationId: 'op-1', windowInstanceId: created.windowInstanceId, hostEpoch: created.hostEpoch }))
      .toMatchObject({ accepted: true, outcome: { status: 'committed' } })
    expect(f.handles[0].destroyed).toBe(false)
    expect(f.registry.detachedHostCount()).toBe(1)
    expect(f.events.map((event) => event.type)).toContain('container-changed')
  })

  it('accepts a Main-confirmed invalid source without a release ACK', async () => {
    const f = createHarness()
    const created = await f.request('op-1')
    if (created.status !== 'awaiting-ready') throw new Error('expected awaiting-ready')
    f.host.confirmTargetReady({ operationId: 'op-1', windowInstanceId: created.windowInstanceId, hostEpoch: created.hostEpoch })
    expect(f.host.confirmSourceInvalid({ operationId: 'op-1', windowInstanceId: created.windowInstanceId, hostEpoch: created.hostEpoch }))
      .toMatchObject({ accepted: true, outcome: { status: 'committed' } })
  })

  it('treats a ready timeout as rollback, never as success', async () => {
    const f = createHarness()
    await f.request('op-1')
    f.fireTimer()
    expect(f.handles[0].destroyed).toBe(true)
    expect(f.registry.detachedHostCount()).toBe(0)
    expect(f.events.some((event) => event.type === 'container-changed')).toBe(false)
    expect(f.events.at(-1)).toMatchObject({ type: 'fallback', fallbackReason: 'window-load-failed' })
    expect(f.host.pendingOperationIds()).toEqual([])
  })

  it('treats a release timeout as rollback and keeps the source owner', async () => {
    const f = createHarness()
    const created = await f.request('op-1')
    if (created.status !== 'awaiting-ready') throw new Error('expected awaiting-ready')
    f.host.confirmTargetReady({ operationId: 'op-1', windowInstanceId: created.windowInstanceId, hostEpoch: created.hostEpoch })
    f.fireTimer()
    expect(f.handles[0].destroyed).toBe(true)
    expect(f.registry.detachedHostCount()).toBe(0)
    expect(f.events.some((event) => event.type === 'container-changed')).toBe(false)
    expect(f.events.at(-1)).toMatchObject({ type: 'fallback', fallbackReason: 'content-error', source: 'window-failure' })
    expect(f.host.committedOwners()).toEqual([])
  })

  it('rejects stale ownership claims without disturbing the live transfer', async () => {
    const f = createHarness()
    const created = await f.request('op-1')
    if (created.status !== 'awaiting-ready') throw new Error('expected awaiting-ready')

    expect(f.host.confirmTargetReady({ operationId: 'op-1', windowInstanceId: created.windowInstanceId, hostEpoch: created.hostEpoch + 1 }))
      .toEqual({ accepted: false, reason: 'epoch-mismatch' })
    expect(f.host.pendingOperationIds()).toEqual(['op-1'])
    expect(f.handles[0].destroyed).toBe(false)
  })

  it('destroys a late orphan window and never touches the layout', async () => {
    const f = createHarness()
    const created = await f.request('op-1')
    if (created.status !== 'awaiting-ready') throw new Error('expected awaiting-ready')
    await f.host.appExit({ flush: () => undefined })

    expect(f.host.confirmTargetReady({ operationId: 'op-1', windowInstanceId: created.windowInstanceId, hostEpoch: created.hostEpoch }))
      .toEqual({ accepted: false, reason: 'orphaned' })
    expect(f.handles[0].destroyed).toBe(true)
    expect(f.registry.detachedHostCount()).toBe(0)
    expect(f.events.some((event) => event.type === 'container-changed')).toBe(false)
  })

  it('answers orphaned for identities it never tracked and emits no layout events', async () => {
    const f = createHarness()
    expect(f.host.confirmTargetReady({ operationId: 'op-unknown', windowInstanceId: 'window-999', hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch }))
      .toEqual({ accepted: false, reason: 'orphaned' })
    expect(f.host.confirmSourceReleased({ operationId: 'op-unknown', windowInstanceId: 'window-999', hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch }))
      .toEqual({ accepted: false, reason: 'orphaned' })
    expect(f.events).toEqual([])
    expect(f.registry.listWindows()).toHaveLength(1)
  })

  it('never destroys a live window for a stale-epoch claim across different source hosts', async () => {
    const f = createHarness()
    const secondSource = f.registry.registerMainWindow({ webContentsId: 2, hostEpoch: 3 })
    const first = await f.request('op-a')
    const second = await f.request('op-b', { sourceHost: secondSource })
    if (first.status !== 'awaiting-ready' || second.status !== 'awaiting-ready') throw new Error('expected awaiting-ready')
    expect(first.hostEpoch).toBe(WorkspaceOwnershipPolicy.initialHostEpoch + 1)
    expect(second.hostEpoch).toBe(4)
    for (const created of [first, second]) {
      f.host.confirmTargetReady({ operationId: created.operationId, windowInstanceId: created.windowInstanceId, hostEpoch: created.hostEpoch })
      f.host.confirmSourceReleased({ operationId: created.operationId, windowInstanceId: created.windowInstanceId, hostEpoch: created.hostEpoch })
    }

    // 伪造：op-a 的 operationId + B 的 windowInstanceId + op-a 的旧 epoch
    expect(f.host.confirmTargetReady({ operationId: 'op-a', windowInstanceId: second.windowInstanceId, hostEpoch: first.hostEpoch }))
      .toEqual({ accepted: false, reason: 'epoch-mismatch' })
    expect(f.handles.every((handle) => !handle.destroyed)).toBe(true)
    expect(f.registry.describeWindow(second.windowInstanceId)).toBeDefined()
    expect(f.registry.detachedHostCount()).toBe(2)
    expect(f.host.committedOwners()).toHaveLength(2)
  })

  it('only reclaims identities the registry never knew', async () => {
    const f = createHarness()
    await f.request('op-a')
    expect(f.host.confirmTargetReady({ operationId: 'op-a', windowInstanceId: 'window-never-registered', hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch }))
      .toEqual({ accepted: false, reason: 'orphaned' })
    expect(f.registry.describeWindow('window-never-registered')).toBeUndefined()
    expect(f.handles.every((handle) => !handle.destroyed)).toBe(true)
  })

  it('never destroys another live panel window for a spoofed ready claim', async () => {
    const f = createHarness()
    const first = await f.request('op-1')
    const second = await f.request('op-2')
    if (first.status !== 'awaiting-ready' || second.status !== 'awaiting-ready') throw new Error('expected awaiting-ready')

    // 伪造：拿 op-1 的 operationId 声明 op-2 的窗口
    expect(f.host.confirmTargetReady({ operationId: 'op-1', windowInstanceId: second.windowInstanceId, hostEpoch: second.hostEpoch }))
      .toEqual({ accepted: false, reason: 'not-owner' })
    expect(f.handles.every((handle) => !handle.destroyed)).toBe(true)
    expect(f.registry.detachedHostCount()).toBe(2)
    expect(f.host.pendingOperationIds()).toEqual(['op-1', 'op-2'])
    expect(f.events.some((event) => event.type === 'container-changed')).toBe(false)
  })

  it('rolls back crash and unresponsive windows with their own fallback reason', async () => {
    for (const [kind, reason] of [['crash', 'window-crashed'], ['unresponsive', 'window-unresponsive']] as const) {
      const f = createHarness()
      const created = await f.request('op-1')
      if (created.status !== 'awaiting-ready') throw new Error('expected awaiting-ready')
      expectRolledBack(f.host.reportWindowFailure({ windowInstanceId: created.windowInstanceId, hostEpoch: created.hostEpoch, kind }), reason)
      expect(f.handles[0].destroyed).toBe(true)
      expect(f.registry.detachedHostCount()).toBe(0)
    }
  })

  it('reports window-crashed (not window-load-failed) when the renderer dies during load', async () => {
    // 加载被拒 + 渲染器已崩溃（真机 Page.crash）⇒ 原因必须是崩溃，不是加载失败
    const rejected = createHarness({ crashed: true })
    rejected.setLoadFailure(new Error('renderer-gone'))
    const rejectedOutcome = await rejected.request('op-1')
    expectRolledBack(rejectedOutcome, 'window-crashed')
    expect(rejected.events.at(-1)).toMatchObject({ type: 'fallback', fallbackReason: 'window-crashed', source: 'window-failure' })
    expect(rejected.handles[0].destroyed).toBe(true)

    // 加载悬挂 + 渲染器崩溃 ⇒ 准备截止时间同样报崩溃，且窗口零孤儿
    const hung = createHarness({ loadHangs: true, crashed: true })
    const pending = hung.request('op-1')
    hung.fireTimer()
    expectRolledBack(await pending, 'window-crashed')
    expect(hung.registry.detachedHostCount()).toBe(0)
    expect(hung.events.at(-1)).toMatchObject({ type: 'fallback', fallbackReason: 'window-crashed' })
  })

  it('reports window-crashed when the renderer dies during prepare and never sends target-ready', async () => {
    const f = createHarness()
    const created = await f.request('op-1')
    if (created.status !== 'awaiting-ready') throw new Error('expected awaiting-ready')
    f.setCrashed(true)
    f.fireTimer() // 准备期截止时间（渲染器崩溃后 target-ready 永不到达）

    expect(f.handles[0].destroyed).toBe(true)
    expect(f.registry.detachedHostCount()).toBe(0)
    expect(f.events.at(-1)).toMatchObject({ type: 'fallback', fallbackReason: 'window-crashed', source: 'window-failure' })
    expect(f.host.pendingOperationIds()).toEqual([])
  })

  it('keeps window-load-failed when the renderer is alive (load failure and prepare timeout)', async () => {
    const alive = createHarness({ crashed: false })
    alive.setLoadFailure(new Error('load failed'))
    expectRolledBack(await alive.request('op-1'), 'window-load-failed')

    const timeout = createHarness({ crashed: false })
    await timeout.request('op-1')
    timeout.fireTimer()
    expect(timeout.events.at(-1)).toMatchObject({ type: 'fallback', fallbackReason: 'window-load-failed' })
  })

  it('distinguishes the failure fallback chain from user intent with a registration lacking docked-right', async () => {
    // P1-07 的缺口：lastValidDock 恰为链首时两种策略同解。这里用「不支持 docked-right + lastValidDock=embedded」
    // 的受限注册把两者区分开：错误路径必须走链（docked-bottom），用户意图才用 lastValidDock（embedded）。
    const restricted = { lastValidDock: 'embedded' as const, supportedModes: ['embedded', 'docked-bottom'] as const }

    const failure = createHarness()
    const failed = await failure.request('op-1', restricted)
    if (failed.status !== 'awaiting-ready') throw new Error('expected awaiting-ready')
    expect(failure.host.reportWindowFailure({
      windowInstanceId: failed.windowInstanceId, hostEpoch: failed.hostEpoch, kind: 'crash'
    })).toMatchObject({ status: 'rolled-back', fallbackReason: 'window-crashed', fallbackMode: 'docked-bottom' })
    expect(failure.events.at(-1)).toMatchObject({ fallbackReason: 'window-crashed', fallbackMode: 'docked-bottom' })
    expect(resolveFailureFallbackMode(restricted.supportedModes)).toBe('docked-bottom')
    expect(resolveUserDockMode(restricted)).toBe('embedded')

    const user = createHarness()
    const committed = await user.request('op-1', restricted)
    if (committed.status !== 'awaiting-ready') throw new Error('expected awaiting-ready')
    user.host.confirmTargetReady({ operationId: 'op-1', windowInstanceId: committed.windowInstanceId, hostEpoch: committed.hostEpoch })
    user.host.confirmSourceReleased({ operationId: 'op-1', windowInstanceId: committed.windowInstanceId, hostEpoch: committed.hostEpoch })
    expect(user.host.handleNativeClose({
      windowInstanceId: committed.windowInstanceId, hostEpoch: committed.hostEpoch, ...restricted
    })).toEqual({ status: 'redocked', mode: 'embedded' })
  })

  it('re-docks on native close via lastValidDock then the documented fallback chain', async () => {
    const f = createHarness()
    const created = await f.request('op-1')
    if (created.status !== 'awaiting-ready') throw new Error('expected awaiting-ready')
    f.host.confirmTargetReady({ operationId: 'op-1', windowInstanceId: created.windowInstanceId, hostEpoch: created.hostEpoch })
    f.host.confirmSourceReleased({ operationId: 'op-1', windowInstanceId: created.windowInstanceId, hostEpoch: created.hostEpoch })

    const closed = f.host.handleNativeClose({ windowInstanceId: created.windowInstanceId, hostEpoch: created.hostEpoch, lastValidDock: 'docked-bottom', supportedModes: ['embedded', 'docked-right', 'docked-bottom'] })
    expect(closed).toEqual({ status: 'redocked', mode: 'docked-bottom' })
    expect(f.handles[0].destroyed).toBe(true)
    expect(f.registry.detachedHostCount()).toBe(0)
    // 原生 X 不是逻辑关闭：任何输出都不得携带 open 字段
    expect(JSON.stringify(closed)).not.toContain('open')
    expect(JSON.stringify(f.events)).not.toContain('"open"')
    expect(f.host.committedOwners()).toEqual([])
  })

  it('P1-06j：原生关闭在销毁窗口**之前**记下用户回停靠意图，供 closed 到达时消费', async () => {
    const f = createHarness()
    const created = await f.request('op-1')
    if (created.status !== 'awaiting-ready') throw new Error('expected awaiting-ready')
    f.host.confirmTargetReady({ operationId: 'op-1', windowInstanceId: created.windowInstanceId, hostEpoch: created.hostEpoch })
    f.host.confirmSourceReleased({ operationId: 'op-1', windowInstanceId: created.windowInstanceId, hostEpoch: created.hostEpoch })
    expect(f.host.redockedByUser(created.windowInstanceId)).toBeUndefined()

    // 工厂 `destroy()` 内同步派发 `closed`：标记必须在销毁之前就已就位，否则 closed 侧只能看到「孤儿外部销毁」
    let seenDuringDestroy: string | undefined
    const originalDestroy = f.handles[0].destroy
    f.handles[0].destroy = () => { seenDuringDestroy = f.host.redockedByUser(created.windowInstanceId); originalDestroy() }

    expect(f.host.handleNativeClose({
      windowInstanceId: created.windowInstanceId, hostEpoch: created.hostEpoch,
      lastValidDock: 'docked-bottom', supportedModes: ['embedded', 'docked-right', 'docked-bottom']
    })).toEqual({ status: 'redocked', mode: 'docked-bottom' })
    expect(seenDuringDestroy).toBe('docked-bottom')
    // 意图是「已消费」语义：消费后释放，不再影响后续窗口身份
    f.host.forgetRedockIntent(created.windowInstanceId)
    expect(f.host.redockedByUser(created.windowInstanceId)).toBeUndefined()
    expect(f.host.redockIntentCount()).toBe(0)
    // 外部销毁（无原生关闭）不留任何用户意图标记：失败链语义不被污染
    const external = createHarness()
    const externalCreated = await external.request('op-1')
    if (externalCreated.status !== 'awaiting-ready') throw new Error('expected awaiting-ready')
    external.host.reportWindowFailure({ windowInstanceId: externalCreated.windowInstanceId, hostEpoch: externalCreated.hostEpoch, kind: 'crash' })
    expect(external.host.redockedByUser(externalCreated.windowInstanceId)).toBeUndefined()
    expect(external.host.redockIntentCount()).toBe(0)
  })

  it('falls back along WorkspaceDockFallbackChain when lastValidDock is unsupported', async () => {
    const f = createHarness()
    const created = await f.request('op-1')
    if (created.status !== 'awaiting-ready') throw new Error('expected awaiting-ready')
    expect(f.host.handleNativeClose({ windowInstanceId: created.windowInstanceId, hostEpoch: created.hostEpoch, lastValidDock: 'embedded', supportedModes: ['docked-right'] }))
      .toEqual({ status: 'redocked', mode: 'docked-right' })
    expect(WorkspaceDockFallbackChain).toEqual(['docked-right', 'docked-bottom', 'embedded'])
    expect(resolveUserDockMode({ lastValidDock: 'embedded', supportedModes: ['embedded'] })).toBe('embedded')
    expect(resolveUserDockMode({ lastValidDock: 'docked-bottom', supportedModes: [] })).toBeUndefined()
    expect(resolveFailureFallbackMode(['embedded'])).toBe('embedded')
    expect(resolveFailureFallbackMode([])).toBeUndefined()
  })

  it('freezes layout, flushes once and destroys every derived window on app exit', async () => {
    const f = createHarness()
    const first = await f.request('op-1')
    const second = await f.request('op-2')
    if (first.status !== 'awaiting-ready' || second.status !== 'awaiting-ready') throw new Error('expected awaiting-ready')
    f.host.confirmTargetReady({ operationId: 'op-2', windowInstanceId: second.windowInstanceId, hostEpoch: second.hostEpoch })
    f.host.confirmSourceReleased({ operationId: 'op-2', windowInstanceId: second.windowInstanceId, hostEpoch: second.hostEpoch })
    const createdBefore = f.handles.length
    const flush = vi.fn(async () => undefined)

    const summary = await f.host.appExit({ flush })

    expect(flush).toHaveBeenCalledOnce()
    expect(summary.destroyedWindowIds).toHaveLength(2)
    expect(summary.ownersRevoked).toBe(1)
    expect(f.handles.every((handle) => handle.destroyed)).toBe(true)
    expect(f.handles).toHaveLength(createdBefore)
    expect(f.registry.detachedHostCount()).toBe(0)
    expect(f.host.pendingOperationIds()).toEqual([])
    expect(JSON.stringify(summary)).not.toContain('open')
    expect(await f.request('op-3')).toEqual({ status: 'rejected', operationId: 'op-3', errorCode: 'main-window-closing' })
  })

  it('rejects the ninth detached host with limit-reached and keeps the existing hosts', async () => {
    const f = createHarness()
    for (let index = 0; index < WorkspaceTransferPolicy.maxDetachedHosts; index += 1) {
      expect((await f.request(`op-${index}`)).status).toBe('awaiting-ready')
    }
    const factoryCalls = f.handles.length
    expect(await f.request('op-overflow')).toEqual({ status: 'rejected', operationId: 'op-overflow', errorCode: 'limit-reached' })
    expect(f.handles).toHaveLength(factoryCalls)
    expect(f.registry.detachedHostCount()).toBe(WorkspaceTransferPolicy.maxDetachedHosts)
  })

  it('falls back instead of creating a window when bounds cannot be corrected', async () => {
    const f = createHarness({ displays: [] })
    expectRolledBack(await f.request('op-1'), 'screen-unavailable')
    expect(f.handles).toEqual([])
    expect(f.registry.detachedHostCount()).toBe(0)
  })

  it('rejects arbitrary entry urls and weakened security at construction time', () => {
    const f = createHarness()
    const policy = { appRoot: APP_ROOT }
    expect(isAllowedAppWindowEntryUrl(ENTRY, policy)).toBe(true)
    expect(isAllowedAppWindowEntryUrl(APP_ROOT, policy)).toBe(true)
    expect(isAllowedAppWindowEntryUrl('file:///etc/passwd', policy)).toBe(false)
    expect(isAllowedAppWindowEntryUrl('file:///app/renderer/../../etc/passwd', policy)).toBe(false)
    expect(isAllowedAppWindowEntryUrl('file:///app/renderer-evil/index.html', policy)).toBe(false)
    expect(isAllowedAppWindowEntryUrl(ENTRY, { appRoot: '' })).toBe(false)
    expect(isAllowedAppWindowEntryUrl('https://evil.example/app', policy)).toBe(false)
    expect(() => createHarness({ entryUrl: 'https://evil.example/app' })).toThrow(/entry/)
    expect(() => createHarness({ entryUrl: 'file:///etc/passwd' })).toThrow(/entry/)
    expect(() => createHarness({ entryUrl: 'file://evilhost/app/renderer/index.html' })).toThrow(/entry/)
    expect(() => createHarness({ entryUrl: 'file:///app/renderer/..%2f..%2fetc/passwd' })).toThrow(/entry/)
    expect(() => createHarness({ entryUrl: ENTRY, appRoot: 'file:///app/other' })).toThrow(/entry/)
    expect(() => createHarness({ entryUrl: 'http://127.0.0.1:5173/', devOrigins: ['http://127.0.0.1:5173'] })).not.toThrow()
    expect(() => createHarness({ entryUrl: 'http://127.0.0.1:5173/', devOrigins: [] })).toThrow(/entry/)
    // 故意注入被削弱的运行时配置：宿主必须 fail closed，而不是静默接受
    expect(() => createHarness({ security: { ...f.security, webPreferences: { ...f.security.webPreferences, contextIsolation: false } } })).toThrow(/security/)
    expect(() => createHarness({ security: { ...f.security, webPreferences: { ...f.security.webPreferences, nodeIntegration: true } } })).toThrow(/security/)
  })
})
