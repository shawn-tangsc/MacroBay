import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * P1-06m focused 端到端（不启动 Electron）：真 compose + 真 P1-04 宿主 + 真 store/handlers + **真窗口工厂**
 * （只把 electron 的 `BrowserWindow` 换成语义等价的 fake），手动定时器 + 受控退出序列。
 *
 * 复现并锁定 P1-07R 真机发现的退出路径缺陷：
 * 1) 已提交独立窗存在时优雅退出**无法完成**（工厂 `close` 无条件 preventDefault ⇒ 退出关窗相位被取消，
 *    主进程残留，真机 runG/runI；无独立窗的 runH 正常退出是受控对照）；
 * 2) debounce（250ms，真机实测 261ms）窗口内的最后一次布局变更在退出时丢失，且 flush 结果不可观测；
 * 3) 对已提交 detached 面板 `closePanel` 后独立窗仍存活并继续渲染已关闭面板；
 * 4) 非退出期的原生 X 仍必须回停靠（P1-06j 不回归）。
 *
 * 退出序列与 app.ts 逐句同构：`before-quit` 置退出期标记并挂起本轮退出 → 有界 flush → 有界 dispose
 * → 标记放行 → 再次 `app.quit()` 真正退出。app.ts 本身是受保护 seam（无法 import），其编排由本文件的
 * 源形状断言 + 这里的真实组件行为共同覆盖。
 */

type FakeWebContents = {
  id: number
  loadedUrls: string[]
  listeners: Map<string, Array<(...args: never[]) => void>>
  setWindowOpenHandler: (handler: unknown) => void
  loadURL: (url: string) => Promise<void>
  isCrashed: () => boolean
  on: (event: string, listener: (...args: never[]) => void) => void
  emit: (event: string, ...args: unknown[]) => void
}

type FakeWindow = {
  readonly webContents: FakeWebContents
  destroyed: boolean
  /** 该窗口的 `close` 被 preventDefault 的次数（退出期必须为 0）。 */
  closePreventedCount: number
  close: () => boolean
  destroy: () => void
  emit: (event: string, ...args: unknown[]) => void
}

const electronMocks = vi.hoisted(() => ({ openExternal: vi.fn(), windows: [] as unknown[] }))

vi.mock('electron', () => {
  class FakeBrowserWindow {
    static instances: unknown[] = []
    readonly webContents: FakeWebContents
    readonly listeners = new Map<string, Array<(...args: never[]) => void>>()
    destroyed = false
    closePreventedCount = 0
    constructor(_options: Record<string, unknown>) {
      const self = this
      this.webContents = {
        id: 700 + FakeBrowserWindow.instances.length,
        loadedUrls: [],
        listeners: new Map<string, Array<(...args: never[]) => void>>(),
        setWindowOpenHandler: () => undefined,
        loadURL: async (url: string) => { self.webContents.loadedUrls.push(url) },
        isCrashed: () => false,
        on: (event, listener) => {
          self.webContents.listeners.set(event, [...(self.webContents.listeners.get(event) ?? []), listener])
        },
        emit: (event, ...args) => {
          for (const listener of self.webContents.listeners.get(event) ?? []) {
            (listener as (...inner: unknown[]) => void)(...args)
          }
        }
      }
      FakeBrowserWindow.instances.push(this)
      electronMocks.windows.push(this)
    }
    on(event: string, listener: (...args: never[]) => void): void {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    }
    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) (listener as (...inner: unknown[]) => void)(...args)
    }
    loadURL(url: string): Promise<void> { return this.webContents.loadURL(url) }
    isDestroyed(): boolean { return this.destroyed }
    /** 真实 Electron：`destroy()` 不派发 `close`，只派发 `closed`（同步）。 */
    destroy(): void {
      if (this.destroyed) return
      this.destroyed = true
      this.emit('closed')
    }
    /** 真实 Electron：`close` 可被 preventDefault 取消；没被取消才真正销毁并派发 `closed`。 */
    close(): boolean {
      let prevented = false
      this.emit('close', { preventDefault: () => { prevented = true } })
      if (prevented) {
        this.closePreventedCount += 1
        return false
      }
      this.destroy()
      return true
    }
    show(): void {}
    focus(): void {}
  }
  return {
    app: { isPackaged: false },
    BrowserWindow: FakeBrowserWindow,
    shell: { openExternal: electronMocks.openExternal }
  }
})

import type { ProductManifest } from '@platform/product-manifest'
import type { WorkspaceEvent } from '@platform/workspace/contracts'
import { createPanelLayoutStore } from '@platform/workspace/persistence/panelLayoutStore'
import type { PanelLayoutDocumentV1 } from '@platform/workspace/persistence/panelLayoutDocument'
import { createSecureWindowSecurity } from '../../window/createMainWindow'
import { composePanelWorkspace } from './composePanelWorkspace'
import { createDetachedWindowFactory } from './panelDetachedWindowFactory'
import { createPanelDetachedWindowHost, type DetachedHostEvent } from './panelDetachedWindowHost'
import { createWorkspaceWindowRegistry, type WorkspaceWindowRegistry } from './workspaceWindowRegistry'

const PRELOAD = '/app/preload/index.js'
const APP_ROOT = 'file:///app/renderer'
const ENTRY = 'file:///app/renderer/index.html'
const PAGE_ID = 'sample.overview'
const PANEL_ID = 'sample.inspector'
const MAIN_WEBCONTENTS = 1

const composeManifest = {
  id: 'sample', name: 'Sample', version: '1.0.0',
  shellContributions: {
    menuPages: [{ id: 'overview', title: { 'zh-CN': '总览', 'en-US': 'Overview' }, icon: 'home', order: 1, module: './desktop/pages/overview' }],
    settingsSections: [],
    panels: [{
      id: 'inspector', title: { 'zh-CN': '检查器', 'en-US': 'Inspector' }, icon: 'file-text',
      module: './desktop/panels/inspector', pageIds: ['overview'],
      supportedModes: ['embedded', 'docked-right', 'docked-bottom', 'detached'],
      defaultMode: 'embedded', allowMultipleInstances: true,
      minSize: { width: 320, height: 240 }, preferredSize: { width: 480, height: 360 },
      binding: { persistence: 'session', maxKeyBytes: 256 }, lifecycleEvents: ['open', 'close']
    }]
  },
  routes: [], navigation: [], settingsSections: [], serviceRoutes: [], tools: [], skills: [],
  agents: [], workflows: [], policies: [], evaluations: [], jobHandlers: [], migrations: []
} as unknown as ProductManifest

const roots: string[] = []
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  electronMocks.openExternal.mockClear()
  electronMocks.windows.length = 0
})

type Timer = { delayMs: number; run: () => void; cancelled: boolean; fired: boolean }
type SentEvent = { webContentsId: number; event: WorkspaceEvent }

/**
 * Fake Electron app：只实现退出语义所需的三个事实 ——
 * 1) `before-quit` 可 preventDefault（取消本轮退出）；
 * 2) 未被取消才进入**关窗相位**（每个窗口收到可取消的 `close`）；
 * 3) 关窗相位被任一窗口的 `close` preventDefault 取消 ⇒ 进程不退出（真机：窗口全销毁但主进程残留）。
 */
function createFakeApp(windows: () => readonly FakeWindow[]) {
  const beforeQuit: Array<(event: { preventDefault: () => void }) => void> = []
  const allClosed: Array<() => void> = []
  const outcomes: string[] = []
  let quitCalls = 0
  let quitCompleted = false
  return {
    outcomes,
    get quitCalls() { return quitCalls },
    get quitCompleted() { return quitCompleted },
    onBeforeQuit(handler: (event: { preventDefault: () => void }) => void): void { beforeQuit.push(handler) },
    onWindowAllClosed(handler: () => void): void { allClosed.push(handler) },
    quit(): boolean {
      quitCalls += 1
      let prevented = false
      const event = { preventDefault: () => { prevented = true } }
      for (const handler of [...beforeQuit]) handler(event)
      if (prevented) { outcomes.push('cancelled-before-quit'); return false }
      for (const window of [...windows()]) window.close()
      if (windows().some((window) => !window.destroyed)) { outcomes.push('cancelled-window-close'); return false }
      quitCompleted = true
      for (const handler of [...allClosed]) handler()
      outcomes.push('completed')
      return true
    }
  }
}

function createExitHarness(options: { savedAtNow?: () => string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'p1-06m-exit-'))
  roots.push(root)
  let sequence = 0
  const windowRegistry: WorkspaceWindowRegistry = createWorkspaceWindowRegistry({
    createOpaqueId: (prefix) => `${prefix}-${++sequence}`
  })
  const layoutTimers: Timer[] = []
  const transferTimers: Timer[] = []
  const timerPort = (sink: Timer[]) => ({
    schedule: (delayMs: number, run: () => void) => {
      const entry: Timer = { delayMs, run, cancelled: false, fired: false }
      sink.push(entry)
      return () => { entry.cancelled = true }
    }
  })
  const sent: SentEvent[] = []
  const windows = () => electronMocks.windows as unknown as readonly FakeWindow[]
  const fakeApp = createFakeApp(windows)
  const order: string[] = []

  // 退出期标记（app.ts 的同名模块级布尔）：`before-quit` 置位 ⇒ 窗口 `close` 不再 preventDefault
  let appQuitting = false
  let quitDisposeStarted = false
  let quitDisposeSettled = false

  let bridge: ReturnType<typeof composePanelWorkspace>['mainHostBridge'] = null
  const factory = createDetachedWindowFactory({
    appRoot: APP_ROOT,
    entryUrl: ENTRY,
    openExternal: (url) => void electronMocks.openExternal(url),
    onNativeClose: (input) => { void bridge?.nativeClose(input).catch(() => undefined) },
    onWindowDestroyed: (input) => { void bridge?.windowDestroyed(input).catch(() => undefined) },
    isAppQuitting: () => appQuitting
  })
  const host = createPanelDetachedWindowHost({
    entryUrl: ENTRY,
    appRoot: APP_ROOT,
    createWindow: factory,
    security: createSecureWindowSecurity({ preload: PRELOAD, openExternal: (url) => void electronMocks.openExternal(url) }),
    registry: windowRegistry,
    displays: () => [{ id: 'primary', workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
    timers: timerPort(transferTimers),
    onEvent: (event: DetachedHostEvent) => { bridge?.publishHostEvent(event) }
  })
  const layoutFilePath = join(root, 'workspace', 'panel-layout.json')
  const composition = composePanelWorkspace({
    productManifests: [composeManifest],
    ipcMain: { handle: () => undefined },
    layoutFilePath,
    panelLayoutStore: createPanelLayoutStore({ filePath: layoutFilePath, timers: timerPort(layoutTimers) }),
    sendToHost: (webContentsId, event) => { sent.push({ webContentsId, event }); return true },
    preferences: { getLanguage: async () => 'zh-CN', getTheme: () => 'light' , getTimeZone: async () => 'UTC'},
    windowRegistry,
    detachedHost: host,
    transferTimers: timerPort(transferTimers),
    ...(options.savedAtNow === undefined ? {} : { savedAtNow: options.savedAtNow })
  })
  if (composition.status !== 'ready') throw new Error(`composition disabled: ${composition.reason}`)
  bridge = composition.mainHostBridge

  const event = (webContentsId: number) => ({ senderFrame: { parent: null }, sender: { id: webContentsId, isDestroyed: () => false } })
  const revision = () => composition.runtimeStore.getSnapshot().layoutRevision
  const panelOf = (panelInstanceKey: string) =>
    composition.runtimeStore.getSnapshot().panels.find((panel) => panel.panelInstanceKey === panelInstanceKey)

  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 30; turn += 1) await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    for (let turn = 0; turn < 30; turn += 1) await Promise.resolve()
  }

  /** 让已排定的布局 debounce 定时器落盘，并按条件等到真实 fs 写入（mkdir/writeFile/rename）落定。 */
  const runLayoutTimers = async (): Promise<void> => {
    const due = layoutTimers.filter((timer) => !timer.cancelled && !timer.fired)
    for (const timer of due) { timer.fired = true; timer.run() }
    for (let attempt = 0; attempt < 200 && composition.layoutStore.pendingWriteCount() > 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    await settle()
  }

  const openPanel = async (): Promise<{ panelInstanceKey: string; workspaceInstanceKey: string }> => {
    await composition.start()
    composition.registerMainWindow({ webContentsId: MAIN_WEBCONTENTS })
    const workspace = await composition.handlers.command(event(MAIN_WEBCONTENTS), {
      method: 'openWorkspace', requestId: 'req-workspace', expectedRevision: 0, pageId: PAGE_ID
    })
    const panel = await composition.handlers.command(event(MAIN_WEBCONTENTS), {
      method: 'openPanel', requestId: 'req-panel', expectedRevision: revision(),
      workspaceInstanceKey: workspace.workspaceInstanceKey as string, panelId: PANEL_ID
    })
    return { panelInstanceKey: panel.panelInstanceKey as string, workspaceInstanceKey: workspace.workspaceInstanceKey as string }
  }

  /** 真实 ACK 链提交：detachPanel → 目标受控视图 → target-ready（Main 代源确认）→ source-released。 */
  const detachAndCommit = async () => {
    const keys = await openPanel()
    const detached = await composition.handlers.command(event(MAIN_WEBCONTENTS), {
      method: 'detachPanel', requestId: 'req-detach', expectedRevision: revision(), panelInstanceKey: keys.panelInstanceKey
    })
    expect(detached.status).toBe('applied')
    const targetWindow = windows()[windows().length - 1]
    if (targetWindow === undefined) throw new Error('detached window missing')
    const targetEvent = event(targetWindow.webContents.id)
    const context = await composition.handlers.getHostContext(targetEvent)
    if (context.status !== 'ok' || context.context.pendingTransfer?.status !== 'in-flight') {
      throw new Error(`no controlled pending transfer: ${JSON.stringify(context)}`)
    }
    const operationId = context.context.pendingTransfer.operationId
    await composition.handlers.hostLifecycle(targetEvent, { operationId, phase: 'target-ready' })
    await composition.handlers.hostLifecycle(event(MAIN_WEBCONTENTS), { operationId, phase: 'source-released' })
    await settle()
    return { ...keys, operationId, targetEvent, targetWindow }
  }

  const detachInFlight = async () => {
    const keys = await openPanel()
    await composition.handlers.command(event(MAIN_WEBCONTENTS), {
      method: 'detachPanel', requestId: 'req-detach', expectedRevision: revision(), panelInstanceKey: keys.panelInstanceKey
    })
    const targetWindow = windows()[windows().length - 1]
    if (targetWindow === undefined) throw new Error('detached window missing')
    return { ...keys, targetWindow }
  }

  let lastDisposeReport: Awaited<ReturnType<typeof composition.dispose>> | null = null
  let lastFlushReport: Awaited<ReturnType<typeof composition.flushLayout>> | null = null

  // app.ts 的 before-quit 编排（逐句同构）：挂起本轮退出 → 有界 flush → 有界 dispose → 放行 → 再次 quit
  fakeApp.onBeforeQuit((quitEvent) => {
    appQuitting = true
    if (quitDisposeSettled) return
    quitEvent.preventDefault()
    if (quitDisposeStarted) return
    quitDisposeStarted = true
    order.push('quit:held')
  })

  const quitChain = async (): Promise<void> => {
    order.push('flush:start')
    lastFlushReport = await composition.flushLayout()
    order.push('flush:end')
    const disposing = composition.dispose()
    // 退出期到来的原生 close（OS/渲染器自关）：绝不取消退出，窗口必须真的关闭
    for (const window of [...windows()]) window.close()
    lastDisposeReport = await disposing
    order.push('dispose:end')
    quitDisposeSettled = true
    fakeApp.quit()
  }

  /** 发起一次优雅退出并等整条退出链落定（返回时 quit 已在 dispose 之后再次触发）。 */
  const quitAndSettle = async (): Promise<void> => {
    fakeApp.quit()
    await quitChain()
    await settle()
  }

  return {
    composition, host, factory, windowRegistry, sent, order, fakeApp, windows, event,
    revision, panelOf, settle, runLayoutTimers, openPanel, detachAndCommit, detachInFlight,
    quitAndSettle, layoutFilePath,
    transferTimerDelays: () => [...new Set(transferTimers.filter((timer) => !timer.cancelled).map((timer) => timer.delayMs))],
    /** 仍**在册且未触发**的布局 debounce 定时器数（被 drain 取消后必须为 0）。 */
    layoutTimerCount: () => layoutTimers.filter((timer) => !timer.cancelled && !timer.fired).length,
    get lastDisposeReport() { return lastDisposeReport },
    get lastFlushReport() { return lastFlushReport }
  }
}

type Harness = ReturnType<typeof createExitHarness>
const readLayout = (harness: Harness): PanelLayoutDocumentV1 =>
  JSON.parse(readFileSync(harness.layoutFilePath, 'utf8')) as PanelLayoutDocumentV1

describe('P1-06m 退出路径：已提交独立窗下的优雅退出必须完成', () => {
  it('退出期窗口 close 绝不 preventDefault：关窗相位不被取消、dispose 之后才再次 quit、进程真正退出', async () => {
    const harness = createExitHarness()
    const { panelInstanceKey, targetWindow } = await harness.detachAndCommit()
    expect(harness.host.committedOwners()).toEqual([panelInstanceKey])

    await harness.quitAndSettle()

    // 本轮退出被 app 级标记挂起（等有界 flush + dispose），随后由同一条链再次 app.quit() 放行
    expect(harness.fakeApp.outcomes).toEqual(['cancelled-before-quit', 'completed'])
    expect(harness.order).toEqual(['quit:held', 'flush:start', 'flush:end', 'dispose:end'])
    expect(harness.fakeApp.quitCalls).toBe(2)
    // 退出期不再 preventDefault：退出关窗相位绝不被取消（真机主进程残留的直接原因）
    expect(targetWindow.closePreventedCount).toBe(0)
    expect(targetWindow.destroyed).toBe(true)
    expect(harness.fakeApp.quitCompleted).toBe(true)
    // 零孤儿：窗口登记/owner/飞事务全部回收
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.committedOwners()).toEqual([])
    expect(harness.host.pendingOperationIds()).toEqual([])
    expect(harness.transferTimerDelays()).toEqual([])
    // 退出报告如实记录销毁数（可观测）
    expect(harness.lastDisposeReport).toMatchObject({ status: 'ready', destroyedWindows: 1 })
  })

  it('准备期（未 ACK）独立窗同样被有界销毁：owner 未建立、定时器不残留、退出完成', async () => {
    const harness = createExitHarness()
    const { targetWindow } = await harness.detachInFlight()
    expect(harness.host.pendingOperationIds()).toHaveLength(1)

    await harness.quitAndSettle()

    expect(harness.fakeApp.quitCompleted).toBe(true)
    expect(targetWindow.destroyed).toBe(true)
    expect(targetWindow.closePreventedCount).toBe(0)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.pendingOperationIds()).toEqual([])
    expect(harness.host.committedOwners()).toEqual([])
    expect(harness.transferTimerDelays()).toEqual([])
    expect(harness.lastDisposeReport).toMatchObject({ status: 'ready', destroyedWindows: 1, ownersRevoked: 0 })
  })
})

describe('P1-06m 退出 flush：debounce 窗口内的最后变更必须有界落盘并可观测', () => {
  it('变更后 50ms（debounce 未到）退出 ⇒ 文档含最后变更、savedAt 更新、报告字段齐全', async () => {
    let savedAt = '2026-01-02T03:04:05.000Z'
    const harness = createExitHarness({ savedAtNow: () => savedAt })
    const { panelInstanceKey } = await harness.openPanel()
    // 先让 openPanel 的 debounce 落盘，得到「变更前」的磁盘基线
    await harness.runLayoutTimers()
    const baseline = readLayout(harness)
    expect(baseline.panels[0]?.dockSize).toBeUndefined()
    expect(harness.composition.layoutStore.persistenceState()).toBe('saved')

    // debounce 窗口内（<250ms）的最后一次变更：只进待写槽，绝不立刻落盘
    const resized = await harness.composition.handlers.command(harness.event(MAIN_WEBCONTENTS), {
      method: 'resizePanel', requestId: 'req-resize', expectedRevision: harness.revision(),
      panelInstanceKey, dockSize: { width: 512, height: 640 }
    })
    expect(resized.status).toBe('applied')
    expect(harness.composition.layoutStore.persistenceState()).toBe('pending')
    expect(harness.composition.layoutStore.pendingWriteCount()).toBe(1)
    expect(readLayout(harness).panels[0]?.dockSize).toBeUndefined() // 磁盘仍是旧值：这就是「会丢」的那一份

    // 退出发生在 T+50ms：时钟往后推，退出 flush 必须覆盖待写
    savedAt = '2026-01-02T03:05:00.000Z'
    const report = await harness.composition.flushLayout()
    expect(report).toMatchObject({
      status: 'ready', outcome: 'saved', hadPendingWrites: true,
      layoutRevision: resized.snapshot.layoutRevision
    })

    const flushed = readLayout(harness)
    expect(flushed.panels[0]?.dockSize).toEqual({ width: 512, height: 640 })
    expect(flushed.layoutRevision).toBe(resized.snapshot.layoutRevision)
    expect(flushed.savedAt).toBe('2026-01-02T03:05:00.000Z')
    expect(harness.composition.layoutStore.persistenceState()).toBe('saved')
    // debounce 定时器已被 drain 取消：退出后不留挂起定时器
    expect(harness.layoutTimerCount()).toBe(0)
  })

  it('无待写时退出 flush 如实报 skipped（绝不把「没跑」与「跑输」混为一谈）', async () => {
    const harness = createExitHarness()
    await harness.openPanel()
    await harness.runLayoutTimers()
    const report = await harness.composition.flushLayout()
    expect(report).toMatchObject({ status: 'ready', hadPendingWrites: false, layoutRevision: harness.revision() })
    expect(['saved', 'skipped']).toContain(report.outcome)
  })

  it('退出报告经纯函数写日志：字段齐全且绝不含路径/URL/密钥', async () => {
    const module = await import('./panelWorkspaceStartupReport') as unknown as {
      reportPanelWorkspaceFlush?: (input: { report: unknown; log?: (message: string) => void }) => void
      reportPanelWorkspaceDispose?: (input: { report: unknown; log?: (message: string) => void }) => void
      formatPanelWorkspaceFlushSummary?: (report: unknown) => string
      formatPanelWorkspaceDisposeSummary?: (report: unknown) => string
    }
    expect(typeof module.reportPanelWorkspaceFlush).toBe('function')
    expect(typeof module.reportPanelWorkspaceDispose).toBe('function')
    expect(typeof module.formatPanelWorkspaceFlushSummary).toBe('function')
    expect(typeof module.formatPanelWorkspaceDisposeSummary).toBe('function')

    const lines: string[] = []
    module.reportPanelWorkspaceFlush?.({
      report: { status: 'ready', outcome: 'saved', hadPendingWrites: true, layoutRevision: 7 }, log: (message) => lines.push(message)
    })
    module.reportPanelWorkspaceDispose?.({
      report: {
        status: 'ready', flushOutcome: 'saved', hadPendingWrites: true, layoutRevision: 7,
        destroyedWindows: 2, ownersRevoked: 1
      },
      log: (message) => lines.push(message)
    })
    expect(lines).toHaveLength(2)
    const [flushLine, disposeLine] = lines as [string, string]
    expect(flushLine).toContain('outcome=saved')
    expect(flushLine).toContain('hadPendingWrites=true')
    expect(flushLine).toContain('layoutRevision=7')
    expect(disposeLine).toContain('flushOutcome=saved')
    expect(disposeLine).toContain('hadPendingWrites=true')
    expect(disposeLine).toContain('destroyedWindows=2')
    expect(disposeLine).toContain('ownersRevoked=1')
    for (const line of lines) {
      expect(line).not.toMatch(/[/\\]/u)
      expect(line).not.toMatch(/https?:|file:|\.json|secret|token|api[-_]?key/iu)
    }
  })
})

describe('P1-06m closePanel 收敛：已提交独立窗必须被销毁/收敛', () => {
  it('owner=独立窗自己的 closePanel ⇒ 窗口销毁、owner 撤销、布局交还主窗、零孤儿、无失败语义', async () => {
    const harness = createExitHarness()
    const { panelInstanceKey, targetEvent, targetWindow } = await harness.detachAndCommit()
    expect(harness.host.committedOwners()).toEqual([panelInstanceKey])

    const closed = await harness.composition.handlers.command(targetEvent, {
      method: 'closePanel', requestId: 'req-close', expectedRevision: harness.revision(), panelInstanceKey
    })
    expect(closed.status).toBe('applied')
    expect(closed.snapshot.panels[0]?.open).toBe(false)
    await harness.settle()

    // 窗口必须消失：绝不留下渲染已关闭面板的存活窗口
    expect(targetWindow.destroyed).toBe(true)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.committedOwners()).toEqual([])
    expect(harness.host.pendingOperationIds()).toEqual([])
    // 面板 open:false 语义与其他容器一致：交还到 lastValidDock，且 detached 预算不被已关闭面板占用
    expect(harness.panelOf(panelInstanceKey)).toMatchObject({ open: false, mode: 'embedded', windowInstanceId: 'main' })
    expect(harness.composition.runtimeStore.getSnapshot().panels.filter((panel) => panel.mode === 'detached')).toHaveLength(0)
    expect(harness.composition.runtimeStore.getSnapshot().pageLayouts[0]?.activePanels.embedded).toBeUndefined()
    // 逻辑关闭不是崩溃/外部销毁：一条失败回退都不许产生
    expect(harness.sent.filter((entry) => entry.event.type === 'fallback')).toEqual([])
    // 收敛必须对仍存活的主窗可观测（revision 不得静默漂移）
    expect(harness.sent.some((entry) => entry.webContentsId === MAIN_WEBCONTENTS && entry.event.type === 'container-changed')).toBe(true)
  })

  it('准备期（未 ACK）面板被 closePanel ⇒ 壳窗销毁、编排飞事务与截止时间收尾、零孤儿、无失败语义', async () => {
    const harness = createExitHarness()
    const { panelInstanceKey, targetWindow } = await harness.detachInFlight()
    expect(harness.composition.transferOrchestrator?.pendingCount()).toBe(1)

    // 准备期的 owner 仍是源（主窗）：closePanel 由主窗发起，收敛必须同样落到目标壳窗
    const closed = await harness.composition.handlers.command(harness.event(MAIN_WEBCONTENTS), {
      method: 'closePanel', requestId: 'req-close-prepare', expectedRevision: harness.revision(), panelInstanceKey
    })
    expect(closed.status).toBe('applied')
    await harness.settle()

    expect(targetWindow.destroyed).toBe(true)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.pendingOperationIds()).toEqual([])
    expect(harness.composition.transferOrchestrator?.pendingCount()).toBe(0)
    expect(harness.transferTimerDelays()).toEqual([])
    expect(harness.panelOf(panelInstanceKey)).toMatchObject({ open: false })
    expect(harness.sent.filter((entry) => entry.event.type === 'fallback')).toEqual([])
  })

  it('非退出期的原生 X 仍无条件 preventDefault 并回停靠（P1-06j 不回归）', async () => {
    const harness = createExitHarness()
    const { panelInstanceKey, targetWindow } = await harness.detachAndCommit()

    targetWindow.close()
    expect(targetWindow.closePreventedCount).toBe(1)
    await harness.settle()

    expect(targetWindow.destroyed).toBe(true)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.committedOwners()).toEqual([])
    expect(harness.panelOf(panelInstanceKey)).toMatchObject({ open: true, mode: 'embedded', windowInstanceId: 'main' })
    expect(harness.sent.filter((entry) => entry.event.type === 'fallback')).toEqual([])
  })
})

describe('P1-06m app.ts 退出编排（受保护 seam：源形状断言）', () => {
  const appSource = readFileSync(resolve(__dirname, '../app.ts'), 'utf8')

  it('before-quit 置退出期标记并挂起本轮退出，dispose 完成后才再次 app.quit()', () => {
    expect(appSource).toContain('let appQuitting = false')
    expect(appSource).toContain('let quitDisposeSettled = false')
    expect(appSource).toContain('isAppQuitting: () => appQuitting')
    const beforeQuitIndex = appSource.indexOf("app.on('before-quit'")
    expect(beforeQuitIndex).toBeGreaterThan(0)
    const block = appSource.slice(beforeQuitIndex, beforeQuitIndex + 800)
    expect(block).toContain('appQuitting = true')
    expect(block).toContain('event.preventDefault()')
    expect(block).toContain('quitDisposeSettled = true')
    expect(block).toContain('app.quit()')
    // 有界逃逸：清理挂住也绝不让进程永远退不出去
    expect(block).toContain('setTimeout')
  })

  it('退出第一件事是有界 flush 待写布局，并记录 flush/dispose 结果', () => {
    const disposeIndex = appSource.indexOf('async function disposePlatformRuntimes')
    const disposeBlock = appSource.slice(disposeIndex, disposeIndex + 400)
    expect(disposeBlock).toContain('await flushPanelWorkspaceLayoutForExit()')
    expect(appSource).toContain('reportPanelWorkspaceFlush({ report: await panelWorkspaceForDisposal.flushLayout() })')
    expect(appSource).toContain('reportPanelWorkspaceDispose({ report:')
  })

  it('window-all-closed 只发起 app.quit()：清理编排归 before-quit 单点，绝不并发两条链', () => {
    const index = appSource.indexOf("app.on('window-all-closed'")
    expect(index).toBeGreaterThan(0)
    const block = appSource.slice(index, index + 400)
    expect(block).toContain('app.quit()')
    expect(block).not.toContain('disposePlatformRuntimes')
  })

  it('SIGTERM/SIGINT 也进同一条优雅退出编排（信号路径同样不得绕过 flush 与派生窗销毁）', () => {
    expect(appSource).toContain("for (const signal of ['SIGTERM', 'SIGINT'] as const)")
    expect(appSource).toContain("process.on(signal, () => { app.quit() })")
  })
})
