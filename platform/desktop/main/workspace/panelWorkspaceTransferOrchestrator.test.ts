import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({ openExternal: vi.fn() }))

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: class {},
  shell: { openExternal: electronMocks.openExternal }
}))

import type { ProductManifest } from '@platform/product-manifest'
import type { WorkspaceEvent } from '@platform/workspace/contracts'
import { WorkspaceOwnershipPolicy, WorkspaceTransferPolicy } from '@platform/workspace/policies'
import { createSecureWindowSecurity } from '../../window/createMainWindow'
import { composePanelWorkspace } from './composePanelWorkspace'
import {
  createPanelDetachedWindowHost,
  type DetachedHostEvent,
  type DetachedWindowFactory,
  type DetachedWindowHandle
} from './panelDetachedWindowHost'
import { createWorkspaceWindowRegistry, type WorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace。P1-06d focused 回归：detach 编排的完整时序矩阵。
 * 全部走真实 P1-04 宿主 + 真实 P1-05 store + 真实 compose 组合，只把窗口工厂与定时器换成注入 fake，
 * 不启动 Electron、不读真实 profile/userData。
 * 覆盖：完整 ACK 链、Main 代源确认兜底、prepare/release 超时、迟到 ACK、崩溃/失联、预算满、
 * store 拒绝后释放预留、重复 detach 合并、app-exit 期间拒绝、native-X 回停靠、未接线时的 fail closed。
 */

const PRELOAD = '/app/preload/index.js'
const APP_ROOT = 'file:///app/renderer'
const ENTRY = 'file:///app/renderer/index.html'
const PAGE_ID = 'sample.overview'
const PANEL_ID = 'sample.inspector'
const MAIN_WEBCONTENTS = 1
const TARGET_WEBCONTENTS = 100

const composeManifest = {
  id: 'sample',
  name: 'Sample',
  version: '1.0.0',
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
})

type FakeWindow = DetachedWindowHandle & {
  destroyed: boolean
  focused: number
  loadedUrls: string[]
  windowOpenHandler: ((details: { url: string }) => { action: 'deny' }) | null
}
type Timer = { delayMs: number; run: () => void; cancelled: boolean }
type SentEvent = { webContentsId: number; event: WorkspaceEvent }

function createFakeWindow(webContentsId: number, load: () => Promise<void>, onDestroyed?: () => void): FakeWindow {
  const handle: FakeWindow = {
    webContentsId, destroyed: false, focused: 0, loadedUrls: [], windowOpenHandler: null,
    loadURL: (url) => {
      if (handle.destroyed) return Promise.reject(new Error('window-destroyed'))
      handle.loadedUrls.push(url)
      return load()
    },
    isDestroyed: () => handle.destroyed,
    // P1-07R 真机顺序（P1-06j 修正）：`destroy()` 内**同步**派发 `closed`，与真实工厂的
    // `created.on('closed')` 一致；异步派发会掩盖「用户关闭意图与外部销毁收敛抢跑」的真实竞争。
    destroy: () => { handle.destroyed = true; if (onDestroyed) onDestroyed() },
    focus: () => { handle.focused += 1 },
    setWindowOpenHandler: (handler) => { handle.windowOpenHandler = handler }
  }
  return handle
}

/** 让 store/宿主的微任务队列跑干净：全部是内存操作，不需要真等待。 */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 12; turn += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  for (let turn = 0; turn < 12; turn += 1) await Promise.resolve()
}

function createHarness(options: {
  maxDetachedHosts?: number
  eventConsumerThrows?: boolean
  /** N6：受限注册（例如不支持 docked-right）用同一份清单改写面板贡献，其余逐字不变。 */
  panelSupportedModes?: readonly string[]
  panelDefaultMode?: string
  /** 与 app.ts 一致：把工厂 `closed` 接到 mainHostBridge.windowDestroyed（默认关，避免影响其它用例时序）。 */
  wireWindowDestroyed?: boolean
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'p1-06d-transfer-'))
  roots.push(root)
  let sequence = 0
  const realRegistry = createWorkspaceWindowRegistry({
    createOpaqueId: (prefix) => `${prefix}-${++sequence}`,
    maxDetachedHosts: options.maxDetachedHosts
  })
  // 只用于断言「store 拒绝时必须调用 releaseReservation」：包装成非冻结对象，其余行为逐字委托真 registry
  const releaseCalls: string[] = []
  const windowRegistry: WorkspaceWindowRegistry = {
    ...realRegistry,
    releaseReservation: (windowInstanceId) => { releaseCalls.push(windowInstanceId); return realRegistry.releaseReservation(windowInstanceId) }
  }
  const handles: FakeWindow[] = []
  const timers: Timer[] = []
  const events: DetachedHostEvent[] = []
  const sent: SentEvent[] = []
  /** 可控时钟：注入 store 的 `now`，让「相位截止时间 → _expireTransfer」可确定性验证。 */
  const clock = { value: 1_000 }
  let loadHook: (() => Promise<void>) | null = null

  const createWindow: DetachedWindowFactory = (input) => {
    const handle = createFakeWindow(
      TARGET_WEBCONTENTS + handles.length,
      async () => { if (loadHook) await loadHook() },
      () => {
        if (options.wireWindowDestroyed !== true) return
        void workspaceRef?.mainHostBridge?.windowDestroyed({ windowInstanceId: input.windowInstanceId })
      }
    )
    handles.push(handle)
    return handle
  }
  const timerPort = () => ({
    schedule: (delayMs: number, run: () => void) => {
      const entry: Timer = { delayMs, run, cancelled: false }
      timers.push(entry)
      return () => { entry.cancelled = true }
    }
  })

  const host = createPanelDetachedWindowHost({
    entryUrl: ENTRY,
    appRoot: APP_ROOT,
    createWindow,
    security: createSecureWindowSecurity({ preload: PRELOAD, openExternal: (url) => void electronMocks.openExternal(url) }),
    registry: windowRegistry,
    displays: () => [{ id: 'primary', workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
    // 宿主自有截止时间与编排截止时间取不同值，测试可分别触发（真实实现两者都来自 policy，这里只为可判别）
    timers: timerPort(),
    targetReadyTimeoutMs: 5_000,
    releaseTimeoutMs: 1_000,
    // 与 app.ts 的接线一致：宿主事件回流到 compose 的定向投递
    onEvent: (event) => {
      events.push(event)
      if (options.eventConsumerThrows === true) throw new Error('consumer-failed')
      workspaceRef?.publishHostEvent(event)
    }
  })
  /** app.ts 的晚绑定形态：宿主/工厂先构造，compose 之后再接线。 */
  let workspaceRef: {
    publishHostEvent: (event: DetachedHostEvent) => boolean
    mainHostBridge: ReturnType<typeof composePanelWorkspace>['mainHostBridge']
  } | null = null

  const manifest = options.panelSupportedModes === undefined ? composeManifest : ({
    ...composeManifest,
    shellContributions: {
      ...composeManifest.shellContributions,
      panels: (composeManifest.shellContributions?.panels ?? []).map((panel) => ({
        ...panel,
        supportedModes: options.panelSupportedModes,
        defaultMode: options.panelDefaultMode ?? panel.defaultMode
      }))
    }
  } as unknown as ProductManifest)
  const composition = composePanelWorkspace({
    productManifests: [manifest],
    ipcMain: { handle: () => undefined },
    layoutFilePath: join(root, 'workspace', 'panel-layout.json'),
    sendToHost: (webContentsId, event) => { sent.push({ webContentsId, event }); return true },
    preferences: { getLanguage: async () => 'zh-CN', getTheme: () => 'light' , getTimeZone: async () => 'UTC'},
    windowRegistry,
    detachedHost: host,
    transferTimers: timerPort(),
    storeNow: () => clock.value
  })
  if (composition.status !== 'ready') throw new Error(`composition disabled: ${composition.reason}`)
  workspaceRef = { publishHostEvent: composition.publishHostEvent, mainHostBridge: composition.mainHostBridge }

  const panelOf = (panelInstanceKey: string) =>
    composition.runtimeStore.getSnapshot().panels.find((panel) => panel.panelInstanceKey === panelInstanceKey)
  const transferOf = (panelInstanceKey: string) => panelOf(panelInstanceKey)?.transfer
  const revision = () => composition.runtimeStore.getSnapshot().layoutRevision
  const event = (webContentsId: number) => ({ senderFrame: { parent: null }, sender: { id: webContentsId, isDestroyed: () => false } })

  const openInspector = async () => {
    await composition.start()
    composition.registerMainWindow({ webContentsId: MAIN_WEBCONTENTS })
    const workspace = await composition.handlers.command(event(MAIN_WEBCONTENTS), {
      method: 'openWorkspace', requestId: 'req-workspace', expectedRevision: 0, pageId: PAGE_ID
    })
    const panel = await composition.handlers.command(event(MAIN_WEBCONTENTS), {
      method: 'openPanel', requestId: 'req-panel', expectedRevision: revision(),
      workspaceInstanceKey: workspace.workspaceInstanceKey as string, panelId: PANEL_ID
    })
    return {
      workspaceInstanceKey: workspace.workspaceInstanceKey as string,
      panelInstanceKey: panel.panelInstanceKey as string
    }
  }

  /** 触发一个「已调度且未取消」的定时器，并把可控时钟推进同样的时间；同 delay 可能多个（宿主 + 编排）。 */
  const fireTimer = async (delayMs: number): Promise<number> => {
    clock.value += delayMs
    const due = timers.filter((timer) => !timer.cancelled && timer.delayMs === delayMs)
    for (const timer of due) { timer.cancelled = true; timer.run() }
    await settle()
    return due.length
  }
  const pendingTimerDelays = () => [...new Set(timers.filter((timer) => !timer.cancelled).map((timer) => timer.delayMs))]

  const detach = (requestId: string, panelInstanceKey: string) =>
    composition.handlers.command(event(MAIN_WEBCONTENTS), {
      method: 'detachPanel', requestId, expectedRevision: revision(), panelInstanceKey
    })

  return {
    composition, host, handles, timers, events, sent, releaseCalls, windowRegistry, realRegistry, clock,
    openInspector, panelOf, transferOf, revision, event, detach, fireTimer, pendingTimerDelays, settle,
    setLoadHook: (hook: (() => Promise<void>) | null) => { loadHook = hook }
  }
}

type Harness = ReturnType<typeof createHarness>

/** 目标窗口（P1-04 已预留并 attach）对应的 webContents 事件。 */
const targetEvent = (harness: Harness) => harness.event(harness.handles[0]?.webContentsId ?? TARGET_WEBCONTENTS)

async function detachOnce(harness: Harness) {
  const keys = await harness.openInspector()
  const result = await harness.detach('req-detach', keys.panelInstanceKey)
  const transfer = harness.transferOf(keys.panelInstanceKey)
  if (!transfer) throw new Error(`no in-flight transfer: ${JSON.stringify(result)}`)
  return { ...keys, result, operationId: transfer.operationId }
}

/** 完整走完：源 prepared → 目标 ready →（目标挂载权）→ 源 released → 提交。 */
async function commitDetach(harness: Harness) {
  const started = await detachOnce(harness)
  await harness.composition.handlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), {
    operationId: started.operationId, phase: 'source-prepared', accepted: true
  })
  await harness.composition.handlers.hostLifecycle(targetEvent(harness), {
    operationId: started.operationId, phase: 'target-ready'
  })
  const released = await harness.composition.handlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), {
    operationId: started.operationId, phase: 'source-released'
  })
  return { ...started, released }
}

describe('detach 编排：完整 ACK 链', () => {
  it('detachPanel → 预留建窗（空壳 entry）→ 同一身份开事务 → ready/released → 提交到目标宿主', async () => {
    const harness = createHarness()
    const started = await detachOnce(harness)
    expect(started.result.status).toBe('applied')
    // 准备期只加载受控 entry（空壳），不挂业务
    expect(harness.handles).toHaveLength(1)
    expect(harness.handles[0]?.loadedUrls).toEqual([ENTRY])
    // 预留 + 事务：registry 预留身份 = store 转移目标身份
    expect(harness.windowRegistry.detachedHostCount()).toBe(1)
    const target = harness.windowRegistry.listDetachedHosts()[0]
    expect(harness.transferOf(started.panelInstanceKey)).toMatchObject({ phase: 'awaiting-source-prepared' })
    expect(harness.panelOf(started.panelInstanceKey)).toMatchObject({
      windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId, mode: 'embedded'
    })

    // 源 prepared：真实准入（不再 unsupported）
    const prepared = await harness.composition.handlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), {
      operationId: started.operationId, phase: 'source-prepared', accepted: true
    })
    expect(prepared).toEqual({ accepted: true })
    expect(harness.transferOf(started.panelInstanceKey)).toMatchObject({ phase: 'awaiting-target-ready' })

    // 目标 ready：宿主 awaiting-release + store awaiting-source-release + 通知源
    const ready = await harness.composition.handlers.hostLifecycle(targetEvent(harness), {
      operationId: started.operationId, phase: 'target-ready'
    })
    expect(ready).toEqual({ accepted: true })
    expect(harness.transferOf(started.panelInstanceKey)).toMatchObject({ phase: 'awaiting-source-release' })
    // store operationId 与宿主 operationId 是两份 id（渲染器只认 store 的那份），映射由编排器维护
    expect(harness.host.pendingOperationIds()).toHaveLength(1)
    expect(harness.composition.transferOrchestrator?.pendingTransfers()).toEqual([{
      panelInstanceKey: started.panelInstanceKey, storeOperationId: started.operationId,
      hostOperationId: harness.host.pendingOperationIds()[0], phase: 'releasing'
    }])
    expect(harness.sent.some((entry) => entry.webContentsId === MAIN_WEBCONTENTS && entry.event.type === 'container-changing'))
      .toBe(true)

    // 源 released：宿主 commit + store commit，目标拿到挂载权
    const released = await harness.composition.handlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), {
      operationId: started.operationId, phase: 'source-released'
    })
    expect(released).toMatchObject({ accepted: true, outcome: { status: 'committed' } })
    expect(harness.host.committedOwners()).toEqual([started.panelInstanceKey])
    expect(harness.host.pendingOperationIds()).toEqual([])
    expect(harness.transferOf(started.panelInstanceKey)).toBeUndefined()
    expect(harness.panelOf(started.panelInstanceKey)).toMatchObject({
      mode: 'detached', windowInstanceId: target?.windowInstanceId, hostEpoch: target?.hostEpoch
    })
    // 提交后不得留下任何截止时间
    expect(harness.pendingTimerDelays()).toEqual([])
    expect(harness.releaseCalls).toEqual([])
  })

  it('P1-04 没有 prepared 端口时由 Main 代源确认，target-ready 一条 ACK 也能推进 store', async () => {
    const harness = createHarness()
    const started = await detachOnce(harness)
    const ready = await harness.composition.handlers.hostLifecycle(targetEvent(harness), {
      operationId: started.operationId, phase: 'target-ready'
    })
    expect(ready).toEqual({ accepted: true })
    expect(harness.transferOf(started.panelInstanceKey)).toMatchObject({ phase: 'awaiting-source-release' })
  })

  it('已提交后重复 detach 幂等不失败，也不开第二个窗', async () => {
    const harness = createHarness()
    const committed = await commitDetach(harness)
    const again = await harness.detach('req-detach-again', committed.panelInstanceKey)
    expect(again.status).toBe('applied')
    expect(harness.handles).toHaveLength(1)
    expect(harness.windowRegistry.detachedHostCount()).toBe(1)
    expect(harness.panelOf(committed.panelInstanceKey)?.mode).toBe('detached')
  })
})

describe('detach 编排：失败、超时与零孤儿', () => {
  it('prepare 超时：宿主先回滚窗口，编排再清掉 store 飞事务，回退事件带 fallbackReason', async () => {
    const harness = createHarness()
    const started = await detachOnce(harness)
    // 宿主自有 5s 截止时间先到：销毁窗口 + 释放登记 + fallback(window-load-failed)
    expect(await harness.fireTimer(5_000)).toBe(1)
    expect(harness.handles[0]?.destroyed).toBe(true)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.pendingOperationIds()).toEqual([])
    expect(harness.events.filter((entry) => entry.type === 'fallback').map((entry) => entry.fallbackReason))
      .toEqual(['window-load-failed'])

    // 编排的 10s 截止时间：把 store 的飞事务清干净（timeout ≠ 成功）
    expect(await harness.fireTimer(WorkspaceTransferPolicy.prepareTargetTimeoutMs)).toBe(1)
    expect(harness.transferOf(started.panelInstanceKey)).toBeUndefined()
    expect(harness.panelOf(started.panelInstanceKey)).toMatchObject({
      mode: 'embedded', windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId
    })
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.pendingTimerDelays()).toEqual([])
  })

  it('编排截止时间独自到达（宿主仍在等待）时，编排必须自己收回窗口与预留，不留孤儿', async () => {
    const harness = createHarness()
    const started = await detachOnce(harness)
    expect(await harness.fireTimer(WorkspaceTransferPolicy.prepareTargetTimeoutMs)).toBe(1)
    expect(harness.transferOf(started.panelInstanceKey)).toBeUndefined()
    expect(harness.handles[0]?.destroyed).toBe(true)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.pendingOperationIds()).toEqual([])
    expect(harness.events.some((entry) => entry.type === 'fallback' && entry.fallbackReason !== undefined)).toBe(true)
  })

  it('release 超时：目标 ready 之后源不释放，一律按 content-error 回滚且零孤儿', async () => {
    const harness = createHarness()
    const started = await detachOnce(harness)
    await harness.composition.handlers.hostLifecycle(targetEvent(harness), {
      operationId: started.operationId, phase: 'target-ready'
    })
    expect(harness.pendingTimerDelays()).toContain(WorkspaceTransferPolicy.releaseTimeoutMs)
    // 宿主 1s release 截止时间先到
    expect(await harness.fireTimer(1_000)).toBe(1)
    expect(harness.events.filter((entry) => entry.type === 'fallback').map((entry) => entry.fallbackReason))
      .toEqual(['content-error'])
    // 编排 2s 截止时间收尾 store
    expect(await harness.fireTimer(WorkspaceTransferPolicy.releaseTimeoutMs)).toBe(1)
    expect(harness.transferOf(started.panelInstanceKey)).toBeUndefined()
    expect(harness.handles[0]?.destroyed).toBe(true)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.pendingOperationIds()).toEqual([])
  })

  it('目标崩溃/失联：window-failure 回滚窗口、释放预留，飞事务由有界到期重试清除', async () => {
    const harness = createHarness()
    const started = await detachOnce(harness)
    await harness.composition.handlers.hostLifecycle(targetEvent(harness), {
      operationId: started.operationId, phase: 'target-ready'
    })
    const failed = await harness.composition.handlers.hostLifecycle(targetEvent(harness), {
      operationId: started.operationId, phase: 'window-failure', kind: 'crash'
    })
    expect(failed).toEqual({ accepted: true })
    expect(harness.events.filter((entry) => entry.type === 'fallback').map((entry) => entry.fallbackReason))
      .toEqual(['window-crashed'])
    // 窗口与预留立即回收（零孤儿）；store 飞事务在相位截止时间到达后被有界清除
    expect(harness.handles[0]?.destroyed).toBe(true)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.pendingOperationIds()).toEqual([])
    expect(await harness.fireTimer(WorkspaceTransferPolicy.releaseTimeoutMs)).toBe(1)
    expect(harness.transferOf(started.panelInstanceKey)).toBeUndefined()
    expect(harness.panelOf(started.panelInstanceKey)).toMatchObject({
      mode: 'embedded', windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId, open: true
    })
  })

  it('预算满：宿主拒绝新分离，不建窗、不开事务、不挤掉既有宿主', async () => {
    const harness = createHarness({ maxDetachedHosts: 1 })
    const keys = await harness.openInspector()
    const occupied = harness.windowRegistry.reserveDetachedWindow({
      hostEpoch: 2, panelInstanceKey: 'panel-other', workspaceInstanceKey: keys.workspaceInstanceKey
    })
    expect(occupied.status).toBe('reserved')
    const result = await harness.detach('req-detach', keys.panelInstanceKey)
    expect(result).toMatchObject({ status: 'rejected', errorCode: 'limit-reached' })
    expect(harness.handles).toHaveLength(0)
    expect(harness.transferOf(keys.panelInstanceKey)).toBeUndefined()
    expect(harness.windowRegistry.detachedHostCount()).toBe(1)
    expect(harness.windowRegistry.describeWindow(
      occupied.status === 'reserved' ? occupied.record.windowInstanceId : ''
    )).toBeDefined()
  })

  it('store 拒绝时释放 registry 预留并销毁窗口：预算不被占满', async () => {
    const harness = createHarness()
    const keys = await harness.openInspector()
    // 建窗过程中发生一次真实并发命令（抬 revision），使 beginTransfer 的 expectedRevision 变陈旧
    harness.setLoadHook(async () => {
      const resized = await harness.composition.runtimeStore.resizePanel({
        requestId: 'req-concurrent', requestScope: String(MAIN_WEBCONTENTS), expectedRevision: harness.revision(),
        windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId, hostEpoch: 1,
        panelInstanceKey: keys.panelInstanceKey, dockSize: { width: 420, height: 320 }
      })
      expect(resized.status).toBe('applied')
    })
    const result = await harness.detach('req-detach', keys.panelInstanceKey)
    expect(result).toMatchObject({ status: 'rejected', errorCode: 'stale-revision' })
    // 预留必须显式释放，且窗口必须销毁：8 窗口预算绝不能被一次失败的 detach 占满
    expect(harness.releaseCalls).toHaveLength(1)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.handles[0]?.destroyed).toBe(true)
    expect(harness.host.pendingOperationIds()).toEqual([])
    expect(harness.transferOf(keys.panelInstanceKey)).toBeUndefined()
    expect(harness.events.some((entry) => entry.type === 'fallback' && entry.fallbackReason !== undefined)).toBe(true)
  })

  it('重复 detach：合并到同一事务，第二个请求被拒且不开第二个窗', async () => {
    const harness = createHarness()
    const keys = await harness.openInspector()
    const first = await harness.detach('req-detach-1', keys.panelInstanceKey)
    expect(first.status).toBe('applied')
    const operationId = harness.transferOf(keys.panelInstanceKey)?.operationId
    const second = await harness.detach('req-detach-2', keys.panelInstanceKey)
    expect(second).toMatchObject({ status: 'rejected', errorCode: 'transfer-in-progress' })
    expect(harness.handles).toHaveLength(1)
    expect(harness.windowRegistry.detachedHostCount()).toBe(1)
    expect(harness.transferOf(keys.panelInstanceKey)?.operationId).toBe(operationId)
    // 第二个请求不得改状态、不得再开事务
    expect(harness.host.pendingOperationIds()).toHaveLength(1)
    expect(harness.composition.transferOrchestrator?.pendingCount()).toBe(1)
  })

  it('窗口被外部销毁：app 侧桥回收登记与飞事务，不留孤儿也不占预算', async () => {
    const harness = createHarness()
    const started = await detachOnce(harness)
    const target = harness.windowRegistry.listDetachedHosts()[0]
    if (!target) throw new Error('no detached host')
    harness.handles[0]!.destroyed = true
    await harness.composition.mainHostBridge?.windowDestroyed({ windowInstanceId: target.windowInstanceId })
    expect(harness.windowRegistry.describeWindow(target.windowInstanceId)).toBeUndefined()
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.transferOf(started.panelInstanceKey)).toBeUndefined()
    expect(harness.host.pendingOperationIds()).toEqual([])
    expect(harness.composition.transferOrchestrator?.pendingCount()).toBe(0)
  })

  it('F1：已提交窗口被外部销毁 ⇒ 复用回停靠链回到停靠态、归属主窗，回退事件投递给主窗，随后仍可再 detach', async () => {
    const harness = createHarness()
    const committed = await commitDetach(harness)
    const target = harness.windowRegistry.listDetachedHosts()[0]
    if (!target) throw new Error('no detached host')
    const revisionBefore = harness.revision()

    harness.handles[0]!.destroyed = true
    await harness.composition.mainHostBridge?.windowDestroyed({ windowInstanceId: target.windowInstanceId })

    // 登记/预算/宿主 owner 全部收敛
    expect(harness.windowRegistry.describeWindow(target.windowInstanceId)).toBeUndefined()
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.committedOwners()).toEqual([])
    expect(harness.composition.transferOrchestrator?.pendingCount()).toBe(0)
    // 绝不留下「mode=detached 但没有窗口」的持久状态：回到安全回退链的停靠模式并归属主窗
    const panel = harness.panelOf(committed.panelInstanceKey)
    expect(panel).toMatchObject({
      open: true, mode: 'docked-right',
      windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId,
      hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch
    })
    expect(harness.revision()).toBeGreaterThan(revisionBefore)
    // 回退事件必须真的投递给仍存活的主窗（不能因 owner 指向已销毁窗口而丢弃）
    const delivered = harness.sent.filter((entry) => entry.event.type === 'fallback')
    expect(delivered.length).toBeGreaterThan(0)
    expect(delivered[0]?.webContentsId).toBe(MAIN_WEBCONTENTS)
    expect(delivered[0]?.event.fallbackReason).toBeDefined()
    expect(delivered[0]?.event.fallbackMode).toBe('docked-right')
    expect(delivered[0]?.event.scope.panelInstanceKey).toBe(committed.panelInstanceKey)
    // 幂等：重复外部销毁不二次回退、不抛错、revision 不再变化
    const stableRevision = harness.revision()
    await harness.composition.mainHostBridge?.windowDestroyed({ windowInstanceId: target.windowInstanceId })
    expect(harness.revision()).toBe(stableRevision)
    expect(harness.panelOf(committed.panelInstanceKey)).toMatchObject({ mode: 'docked-right' })
    // 回退后该面板仍可再次分离（不会被「detached 但无窗口」永久锁死）
    const again = await harness.detach('req-detach-again', committed.panelInstanceKey)
    expect(again.status).toBe('applied')
    expect(harness.handles).toHaveLength(2)
    expect(harness.windowRegistry.detachedHostCount()).toBe(1)
  })

  it('N1：相位≥1 回滚留下的有界到期重试定时器会被 dispose 取消（退出后无挂起编排定时器）', async () => {
    const harness = createHarness()
    const started = await detachOnce(harness)
    await harness.composition.handlers.hostLifecycle(targetEvent(harness), {
      operationId: started.operationId, phase: 'target-ready'
    })
    await harness.composition.handlers.hostLifecycle(targetEvent(harness), {
      operationId: started.operationId, phase: 'window-failure', kind: 'crash'
    })
    // 相位 ≥1 的中止只能到期清除：编排必须留下一个有界重试定时器
    expect(harness.pendingTimerDelays()).toContain(WorkspaceTransferPolicy.releaseTimeoutMs)
    await harness.composition.dispose()
    expect(harness.pendingTimerDelays()).toEqual([])
  })

  it('N2：退出时消费者抛错不阻断清理，dispose 不 reject 且如实上报有界 flush 结论', async () => {
    const harness = createHarness({ eventConsumerThrows: true })
    const committed = await commitDetach(harness)
    const dispose = await harness.composition.dispose()
    expect(dispose.status).toBe('ready')
    // P1-04 清理优先再抛：窗口必须已被销毁，编排侧只吸收异常并如实上报
    expect(harness.handles[0]?.destroyed).toBe(true)
    expect(harness.host.committedOwners()).toEqual([])
    // 消费者失败 ≠ flush 超时：有界 flush 的真实结论必须如实上报（落盘成功即 saved）
    expect(dispose.flushOutcome).not.toBe('timeout')
    expect(dispose.flushOutcome).toBe('saved')
    expect(harness.panelOf(committed.panelInstanceKey)).toMatchObject({ open: true, mode: 'detached' })
  })

  it('app-exit：有界退出销毁派生窗、撤销 owner，之后 detachPanel 返回 main-window-closing 且不新建回停靠窗', async () => {
    const harness = createHarness()
    const committed = await commitDetach(harness)
    const dispose = await harness.composition.dispose()
    expect(dispose.status).toBe('ready')
    expect(['saved', 'failed', 'skipped', 'timeout']).toContain(dispose.flushOutcome)
    expect(harness.handles[0]?.destroyed).toBe(true)
    expect(harness.host.committedOwners()).toEqual([])
    expect(harness.host.pendingOperationIds()).toEqual([])
    // 冻结布局：不写 open=false、不新建回停靠窗口、模式不改写
    expect(harness.panelOf(committed.panelInstanceKey)).toMatchObject({ open: true, mode: 'detached' })
    expect(harness.transferOf(committed.panelInstanceKey)).toBeUndefined()
    const afterExit = await harness.detach('req-detach-after-exit', committed.panelInstanceKey)
    expect(afterExit).toMatchObject({ status: 'rejected', errorCode: 'main-window-closing' })
    expect(harness.handles).toHaveLength(1)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
  })

  it('app-exit 时在飞事务同样被清掉，退出后不再有截止时间残留', async () => {
    const harness = createHarness()
    const started = await detachOnce(harness)
    await harness.composition.dispose()
    expect(harness.transferOf(started.panelInstanceKey)).toBeUndefined()
    expect(harness.handles[0]?.destroyed).toBe(true)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.pendingTimerDelays()).toEqual([])
    const late = await harness.composition.handlers.hostLifecycle(targetEvent(harness), {
      operationId: started.operationId, phase: 'target-ready'
    })
    expect(late.accepted).toBe(false)
  })
})

describe('detach 编排：app-exit 期间窗口销毁回调', () => {
  it('app 同接线：app-exit 期间窗口销毁回调不得改写已冻结布局', async () => {
    const harness = createHarness({ wireWindowDestroyed: true })
    const committed = await commitDetach(harness)
    const before = harness.revision()
    await harness.composition.dispose()
    await harness.settle()
    // 退出路径 appExiting=true ⇒ 回停靠事务被 store 拒绝：布局保持冻结（不写 open=false、不改 mode）
    expect(harness.panelOf(committed.panelInstanceKey)).toMatchObject({ open: true, mode: 'detached' })
    expect(harness.revision()).toBe(before)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.committedOwners()).toEqual([])
    expect(harness.pendingTimerDelays()).toEqual([])
  })
})

describe('N6 (P1-06g)：失败路径走安全回退链，用户意图才走 lastValidDock', () => {
  /** 受限注册：不支持 docked-right ⇒ 安全链首变成 docked-bottom；lastValidDock 仍为 embedded（可区分）。 */
  const RESTRICTED = { panelSupportedModes: ['embedded', 'docked-bottom', 'detached'] as const }

  it('已提交窗口崩溃 ⇒ window-crashed 且回退到链首 docked-bottom（不是 lastValidDock embedded）', async () => {
    const harness = createHarness(RESTRICTED)
    const committed = await commitDetach(harness)
    const target = harness.windowRegistry.listDetachedHosts()[0]
    if (!target) throw new Error('no detached host')
    // 提交前后该面板的 lastValidDock 都是 embedded：若走 lastValidDock 就会得到 embedded
    expect(harness.panelOf(committed.panelInstanceKey)?.lastValidDock).toBe('embedded')

    harness.handles[0]!.destroyed = true
    await harness.composition.mainHostBridge?.windowDestroyed({ windowInstanceId: target.windowInstanceId })

    const panel = harness.panelOf(committed.panelInstanceKey)
    expect(panel).toMatchObject({
      open: true, mode: 'docked-bottom',
      windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId,
      hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch
    })
    const delivered = harness.sent.filter((entry) => entry.event.type === 'fallback')
    expect(delivered[0]?.webContentsId).toBe(MAIN_WEBCONTENTS)
    expect(delivered[0]?.event).toMatchObject({ fallbackReason: 'window-crashed', fallbackMode: 'docked-bottom' })
  })

  it('准备期目标渲染器崩溃（window-failure ACK）⇒ window-crashed 且回退事件带链首 docked-bottom', async () => {
    const harness = createHarness(RESTRICTED)
    const started = await detachOnce(harness)
    await harness.composition.handlers.hostLifecycle(targetEvent(harness), {
      operationId: started.operationId, phase: 'target-ready'
    })
    const failed = await harness.composition.handlers.hostLifecycle(targetEvent(harness), {
      operationId: started.operationId, phase: 'window-failure', kind: 'crash'
    })
    expect(failed).toEqual({ accepted: true })
    const fallbacks = harness.events.filter((entry) => entry.type === 'fallback')
    expect(fallbacks.map((entry) => entry.fallbackReason)).toEqual(['window-crashed'])
    expect(fallbacks.at(-1)?.fallbackMode).toBe('docked-bottom')
    expect(harness.handles[0]?.destroyed).toBe(true)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
  })

  it('同一受限注册下，提交后原生 X 仍优先 lastValidDock（embedded）——与失败路径明确可分', async () => {
    const harness = createHarness(RESTRICTED)
    const committed = await commitDetach(harness)
    const target = harness.windowRegistry.listDetachedHosts()[0]
    if (!target) throw new Error('no detached host')

    const redocked = await harness.composition.mainHostBridge?.nativeClose({
      windowInstanceId: target.windowInstanceId, hostEpoch: target.hostEpoch
    })
    expect(redocked).toBe(true)
    expect(harness.panelOf(committed.panelInstanceKey)).toMatchObject({
      open: true, mode: 'embedded',
      windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId
    })
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
  })
})

describe('detach 编排：未接线与边界', () => {
  it('只注入 ACK 端口子集（无 requestDetach）时不启用编排：detachPanel 与 source-prepared 一律 fail closed', async () => {
    const calls = { targetReady: 0 }
    // P1-06l 测试隔离：布局文档必须落在**本次运行唯一**的临时目录（`roots` 统一清理）。用具名固定路径时，
    // 一次成功运行写下的文档会被下一次运行的 `compose.start()` 恢复（restore:'restored'），revision 变成 2，
    // 用例写死的 `expectedRevision: 0` 随即 stale-revision ⇒ workspace key 为空 ⇒ panelInstanceKey 为空
    // ⇒ detachPanel 在 handler 先命中空 key 的 `invalid-request`，根本走不到本用例要验的 `unsupported`。
    const root = mkdtempSync(join(tmpdir(), 'p1-06d-no-orchestrator-'))
    roots.push(root)
    const composition = composePanelWorkspace({
      productManifests: [composeManifest],
      ipcMain: { handle: () => undefined },
      layoutFilePath: join(root, 'panel-layout.json'),
      sendToHost: () => true,
      preferences: { getLanguage: async () => 'zh-CN', getTheme: () => 'light' , getTimeZone: async () => 'UTC'},
      detachedHost: {
        confirmTargetReady: () => { calls.targetReady += 1; return { accepted: true as const } },
        confirmSourceReleased: (claim: { operationId: string; windowInstanceId: string; hostEpoch: number }) =>
          ({ accepted: true as const, outcome: { status: 'committed' as const, ...claim } }),
        confirmSourceInvalid: (claim: { operationId: string; windowInstanceId: string; hostEpoch: number }) =>
          ({ accepted: true as const, outcome: { status: 'committed' as const, ...claim } }),
        reportWindowFailure: () => ({ status: 'rolled-back' as const, operationId: 'op', fallbackReason: 'window-crashed' as const, fallbackMode: 'embedded' as const }),
        handleNativeClose: () => ({ status: 'redocked' as const, mode: 'docked-right' as const })
      }
    })
    if (composition.status !== 'ready') throw new Error('composition disabled')
    await composition.start()
    composition.registerMainWindow({ webContentsId: MAIN_WEBCONTENTS })
    const workspace = await composition.handlers.command({ senderFrame: { parent: null }, sender: { id: 1, isDestroyed: () => false } }, {
      method: 'openWorkspace', requestId: 'w', expectedRevision: 0, pageId: PAGE_ID
    })
    const panel = await composition.handlers.command({ senderFrame: { parent: null }, sender: { id: 1, isDestroyed: () => false } }, {
      method: 'openPanel', requestId: 'p', expectedRevision: composition.runtimeStore.getSnapshot().layoutRevision,
      workspaceInstanceKey: workspace.workspaceInstanceKey as string, panelId: PANEL_ID
    })
    const denied = await composition.handlers.command({ senderFrame: { parent: null }, sender: { id: 1, isDestroyed: () => false } }, {
      method: 'detachPanel', requestId: 'd', expectedRevision: composition.runtimeStore.getSnapshot().layoutRevision,
      panelInstanceKey: panel.panelInstanceKey as string
    })
    expect(denied).toMatchObject({ status: 'rejected', errorCode: 'unsupported' })
    expect(calls.targetReady).toBe(0)
  })

  it('detachPanel 只接受 panelInstanceKey，多余字段与未知面板一律 fail closed', async () => {
    const harness = createHarness()
    const keys = await harness.openInspector()
    const withUrl = await harness.composition.handlers.command(harness.event(MAIN_WEBCONTENTS), {
      method: 'detachPanel', requestId: 'req-1', expectedRevision: harness.revision(),
      panelInstanceKey: keys.panelInstanceKey, url: 'file:///etc/passwd'
    })
    expect(withUrl.errorCode).toBe('invalid-request')
    const missing = await harness.composition.handlers.command(harness.event(MAIN_WEBCONTENTS), {
      method: 'detachPanel', requestId: 'req-2', expectedRevision: harness.revision(), panelInstanceKey: 'panel-missing'
    })
    expect(missing.errorCode).toBe('registration-missing')
    const stale = await harness.composition.handlers.command(harness.event(MAIN_WEBCONTENTS), {
      method: 'detachPanel', requestId: 'req-3', expectedRevision: 0, panelInstanceKey: keys.panelInstanceKey
    })
    expect(stale.errorCode).toBe('stale-revision')
    // 独立窗自己不能发起 detach（源必须是当前承载者）
    expect(harness.handles).toHaveLength(0)
  })

  it('宿主事件路由：回退事件按 panel 定向投递给当前承载者', async () => {
    const harness = createHarness()
    const started = await detachOnce(harness)
    await harness.fireTimer(WorkspaceTransferPolicy.prepareTargetTimeoutMs)
    const fallback = harness.sent.filter((entry) => entry.event.type === 'fallback')
    expect(fallback.length).toBeGreaterThan(0)
    expect(fallback[0]?.webContentsId).toBe(MAIN_WEBCONTENTS)
    expect(fallback[0]?.event.fallbackReason).toBeDefined()
    expect(fallback[0]?.event.scope.panelInstanceKey).toBe(started.panelInstanceKey)
  })
})

describe('P1-06h：回滚 reason 如实映射（非崩溃绝不写成 window-crashed）', () => {
  it('源拒绝准备（content-error 回滚）⇒ 宿主按 content-error 如实发出，绝不是 window-crashed', async () => {
    const harness = createHarness()
    const started = await detachOnce(harness)
    const rejectedSource = await harness.composition.handlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), {
      operationId: started.operationId, phase: 'source-prepared', accepted: false
    })
    expect(rejectedSource).toMatchObject({ accepted: false })

    const fallbacks = harness.events.filter((entry) => entry.type === 'fallback').map((entry) => entry.fallbackReason)
    expect(fallbacks).toEqual(['content-error'])
    expect(fallbacks).not.toContain('window-crashed')
    // 收敛原因不等于放松回收：目标窗与预留仍然立即收回（零孤儿）
    expect(harness.handles[0]?.destroyed).toBe(true)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.pendingOperationIds()).toEqual([])
  })

  it('编排准备截止时间独自到达（window-load-failed 回滚）⇒ 词表里没有 window-crashed', async () => {
    const harness = createHarness()
    const started = await detachOnce(harness)
    expect(await harness.fireTimer(WorkspaceTransferPolicy.prepareTargetTimeoutMs)).toBe(1)

    const fallbacks = harness.events.filter((entry) => entry.type === 'fallback').map((entry) => entry.fallbackReason)
    expect(fallbacks).toEqual(['window-load-failed'])
    expect(fallbacks).not.toContain('window-crashed')
    expect(harness.transferOf(started.panelInstanceKey)).toBeUndefined()
    expect(harness.handles[0]?.destroyed).toBe(true)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.pendingOperationIds()).toEqual([])
  })

  it('真崩溃原因仍如实报 window-crashed（收敛不丢词表）', async () => {
    const harness = createHarness()
    await commitDetach(harness)
    const target = harness.windowRegistry.listDetachedHosts()[0]
    if (!target) throw new Error('no detached host')
    // 显式崩溃上报：kind=crash 且不带受控 reason ⇒ 维持既有词表（收敛不削弱真崩溃语义）
    const failed = await harness.composition.transferOrchestrator?.hostPort.reportWindowFailure({
      windowInstanceId: target.windowInstanceId, hostEpoch: target.hostEpoch, kind: 'crash'
    })
    expect(failed).toMatchObject({ status: 'rolled-back', fallbackReason: 'window-crashed' })
  })
})

describe('P1-06j：原生关闭（用户意图）与 closed→forgetHostWindow（外部销毁）互斥', () => {
  /**
   * P1-07R 真机缺陷（3/3 稳定复现）：已提交独立窗 `window.close()` 时，宿主 `handleNativeClose` 先算对
   * `lastValidDock` 再 `destroy()`；`destroy()` 同步触发工厂 `closed → onWindowDestroyed → forgetHostWindow`，
   * 此时该面板仍是 `mode:'detached'` 的孤儿、用户意图回停靠事务**还没开**，于是第二条「失败安全链」事务抢跑并把
   * 最终态改写成链首（真机：docked-right）、把用户关闭误报成 `window-crashed`。
   *
   * 真实顺序 = 「宿主同步销毁 ⇒ closed 同步派发（此处用 setTimeout(0) 保真）」，因此下面的用例全部用
   * `wireWindowDestroyed: true` 复现这条真实顺序；用户意图与失败链在同一受限注册下必须真正可分。
   */
  const fallbackEvents = (harness: Harness) => harness.sent
    .filter((entry) => entry.event.type === 'fallback')
    .map((entry) => {
      const event = entry.event as { fallbackReason?: string; fallbackMode?: string }
      return { fallbackReason: event.fallbackReason, fallbackMode: event.fallbackMode }
    })

  /** 真机顺序：原生关闭（用户 X）⇒ 宿主销毁 ⇒ closed 派发到 forgetHostWindow。 */
  async function nativeClose(harness: Harness, panelInstanceKey: string) {
    const target = harness.windowRegistry.listDetachedHosts()[0]
    if (!target) throw new Error('no detached host')
    const redocked = await harness.composition.mainHostBridge?.nativeClose({
      windowInstanceId: target.windowInstanceId, hostEpoch: target.hostEpoch
    })
    await harness.settle()
    return { target, redocked, panel: harness.panelOf(panelInstanceKey) }
  }

  it('① 已提交窗口原生关闭（closed 紧随）⇒ 最终 mode=lastValidDock、恰一次 redock、无失败回退事件', async () => {
    const harness = createHarness({ wireWindowDestroyed: true })
    const committed = await commitDetach(harness)
    const before = harness.revision()
    const closed = await nativeClose(harness, committed.panelInstanceKey)

    expect(closed.redocked).toBe(true)
    // 用户意图分支：lastValidDock（此面板 defaultMode=embedded），绝不是失败链首 docked-right
    expect(closed.panel).toMatchObject({ open: true, mode: 'embedded', windowInstanceId: 'main', hostEpoch: 1 })
    expect(closed.panel?.lastValidDock).toBe('embedded')
    // 单一事务：只有一次回停靠提交（begin + commit），第二条失败事务不得存在
    expect(harness.revision() - before).toBe(2)
    expect(harness.panelOf(committed.panelInstanceKey)?.transfer).toBeUndefined()
    expect(harness.composition.transferOrchestrator?.pendingCount()).toBe(0)
    // 健康回停靠不得带「失败」语义：没有 fallback 事件，更没有 window-crashed / window-load-failed
    expect(fallbackEvents(harness)).toEqual([])
    expect(harness.events.some((entry) => entry.fallbackReason !== undefined)).toBe(false)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.committedOwners()).toEqual([])
  })

  it('② 只有 closed（无原生关闭，外部销毁/崩溃）⇒ 仍 window-crashed + 链首 + 恰一条 fallback', async () => {
    const harness = createHarness({ wireWindowDestroyed: true })
    const committed = await commitDetach(harness)
    const target = harness.windowRegistry.listDetachedHosts()[0]
    if (!target) throw new Error('no detached host')
    const before = harness.revision()
    harness.handles[0]!.destroyed = true
    await harness.composition.mainHostBridge?.windowDestroyed({ windowInstanceId: target.windowInstanceId })
    await harness.settle()

    const panel = harness.panelOf(committed.panelInstanceKey)
    expect(panel).toMatchObject({ open: true, mode: 'docked-right', windowInstanceId: 'main', hostEpoch: 1 })
    expect(panel?.lastValidDock).toBe('docked-right')
    // 恰一条失败回退事务 + 恰一条 fallback
    expect(harness.revision() - before).toBe(2)
    expect(fallbackEvents(harness)).toEqual([{ fallbackReason: 'window-crashed', fallbackMode: 'docked-right' }])
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.committedOwners()).toEqual([])
  })

  it('③ in-flight 原生关闭 ⇒ 回 lastValidDock、状态与事件一致、无失败回退事件', async () => {
    const harness = createHarness({ wireWindowDestroyed: true })
    const started = await detachOnce(harness)
    const closed = await nativeClose(harness, started.panelInstanceKey)

    // 准备期用户关闭：最终必须真的停在 lastValidDock（embedded）且归属主窗，不留 orphan
    expect(closed.panel).toMatchObject({ open: true, mode: 'embedded', windowInstanceId: 'main', hostEpoch: 1 })
    expect(closed.panel?.lastValidDock).toBe('embedded')
    expect(closed.panel?.transfer).toBeUndefined()
    expect(harness.composition.transferOrchestrator?.pendingCount()).toBe(0)
    // 事件必须与最终状态一致：没有 fallback，也就没有「说完回 right 实际回 embedded」的矛盾事件
    expect(fallbackEvents(harness)).toEqual([])
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.handles.every((handle) => handle.destroyed)).toBe(true)
  })

  it('③b 在飞窗口已推进到 awaiting-source-release 时原生关闭 ⇒ 必须补做用户意图回停靠，绝不留「detached 且无窗口」', async () => {
    // 判别性构造：目标 ready 之后 store 相位已是 `awaiting-source-release`，`abortStoreTransfer` 不再走
    // `_sourcePrepared(accepted=false)`（那条路径才会把面板回落到原承载者），`_expireTransfer` 又未到期；
    // 结果是面板停在「mode:detached 且归属已销毁窗口、transfer 已清」——不补做就永久锁死。
    const harness = createHarness({ wireWindowDestroyed: true })
    const started = await detachOnce(harness)
    await harness.composition.handlers.hostLifecycle(targetEvent(harness), {
      operationId: started.operationId, phase: 'target-ready'
    })
    expect(harness.transferOf(started.panelInstanceKey)).toMatchObject({ phase: 'awaiting-source-release' })
    // 准备期 lastValidDock=embedded（openPanel 默认）；失败链首=docked-right ⇒ 三者可分
    expect(harness.panelOf(started.panelInstanceKey)?.lastValidDock).toBe('embedded')
    const target = harness.windowRegistry.listDetachedHosts()[0]
    if (!target) throw new Error('no detached host')

    const redocked = await harness.composition.mainHostBridge?.nativeClose({
      windowInstanceId: target.windowInstanceId, hostEpoch: target.hostEpoch
    })
    await harness.settle()
    expect(redocked).toBe(true)
    // 相位 ≥1 时中止只能等「有界到期重试」清掉 store 飞事务（此处驱动同一枚定时器）
    expect(await harness.fireTimer(WorkspaceTransferPolicy.releaseTimeoutMs)).toBeGreaterThanOrEqual(1)
    await harness.settle()
    // 补做必须落在事务 settled 之后：真正收敛到用户意图（embedded），既不是失败链首 docked-right，也不是「detached 且无窗口」
    expect(harness.panelOf(started.panelInstanceKey)).toMatchObject({
      open: true, mode: 'embedded', windowInstanceId: 'main', hostEpoch: 1
    })
    expect(harness.panelOf(started.panelInstanceKey)?.transfer).toBeUndefined()
    expect(fallbackEvents(harness)).toEqual([])
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.composition.transferOrchestrator?.pendingCount()).toBe(0)
    expect(harness.pendingTimerDelays()).toEqual([])
  })

  it('④ 受限注册（无 docked-right + lastValidDock=docked-bottom）下用户意图与失败链真正区分', async () => {
    const restricted = { panelSupportedModes: ['embedded', 'docked-bottom', 'detached'] as const, wireWindowDestroyed: true }
    /** 先把面板停在 docked-bottom（lastValidDock=docked-bottom），再走完整 ACK 链分离并提交。 */
    async function commitFromBottom(harness: Harness) {
      const keys = await harness.openInspector()
      const moved = await harness.composition.handlers.command(harness.event(MAIN_WEBCONTENTS), {
        method: 'switchContainer', requestId: 'req-bottom', expectedRevision: harness.revision(),
        panelInstanceKey: keys.panelInstanceKey, mode: 'docked-bottom'
      })
      expect(moved.status).toBe('applied')
      expect(harness.panelOf(keys.panelInstanceKey)?.lastValidDock).toBe('docked-bottom')
      const started = await harness.detach('req-detach', keys.panelInstanceKey)
      expect(started.status).toBe('applied')
      const transfer = harness.transferOf(keys.panelInstanceKey)
      if (!transfer) throw new Error('no in-flight transfer')
      await harness.composition.handlers.hostLifecycle(targetEvent(harness), {
        operationId: transfer.operationId, phase: 'target-ready'
      })
      await harness.composition.handlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), {
        operationId: transfer.operationId, phase: 'source-released'
      })
      expect(harness.panelOf(keys.panelInstanceKey)).toMatchObject({ mode: 'detached', lastValidDock: 'docked-bottom' })
      return keys
    }

    // 用户意图：原生关闭 ⇒ lastValidDock = docked-bottom（失败链首 docked-right 未注册 ⇒ 若走失败链会得到 embedded）
    const user = createHarness(restricted)
    const userKeys = await commitFromBottom(user)
    const userClosed = await nativeClose(user, userKeys.panelInstanceKey)
    expect(userClosed.panel).toMatchObject({ open: true, mode: 'docked-bottom', windowInstanceId: 'main' })
    expect(fallbackEvents(user)).toEqual([])

    // 失败链：同一受限注册、同一 lastValidDock=docked-bottom，外部销毁 ⇒ 走链首**可用**项
    // （链首 docked-right 未注册 ⇒ 落到 docked-bottom）
    const failure = createHarness(restricted)
    const failureKeys = await commitFromBottom(failure)
    const failureTarget = failure.windowRegistry.listDetachedHosts()[0]
    if (!failureTarget) throw new Error('no detached host')
    failure.handles[0]!.destroyed = true
    await failure.composition.mainHostBridge?.windowDestroyed({ windowInstanceId: failureTarget.windowInstanceId })
    await failure.settle()
    const failurePanel = failure.panelOf(failureKeys.panelInstanceKey)
    expect(failurePanel).toMatchObject({ open: true, mode: 'docked-bottom', windowInstanceId: 'main' })
    expect(fallbackEvents(failure)).toEqual([{ fallbackReason: 'window-crashed', fallbackMode: 'docked-bottom' }])

    // 此注册下 lastValidDock 与失败链同解 ⇒ 真正「可分」的对照放在 ⑤（lastValidDock=embedded）
    expect(userClosed.panel?.mode).toBe('docked-bottom')
    expect(failurePanel?.mode).toBe('docked-bottom')
  })

  it('⑤ 受限注册下 lastValidDock(embedded) ≠ 失败链首可用项(docked-bottom)：用户意图与失败链给出不同结论', async () => {
    const restricted = { panelSupportedModes: ['embedded', 'docked-bottom', 'detached'] as const, wireWindowDestroyed: true }
    // lastValidDock = embedded（默认），失败链首可用项 = docked-bottom ⇒ 两者真正可分
    const user = createHarness(restricted)
    const userKeys = await commitDetach(user)
    const userClosed = await nativeClose(user, userKeys.panelInstanceKey)
    expect(userClosed.panel).toMatchObject({ open: true, mode: 'embedded', windowInstanceId: 'main' })
    expect(fallbackEvents(user)).toEqual([])

    const failure = createHarness(restricted)
    const failureKeys = await commitDetach(failure)
    const failureTarget = failure.windowRegistry.listDetachedHosts()[0]
    if (!failureTarget) throw new Error('no detached host')
    failure.handles[0]!.destroyed = true
    await failure.composition.mainHostBridge?.windowDestroyed({ windowInstanceId: failureTarget.windowInstanceId })
    await failure.settle()
    const failurePanel = failure.panelOf(failureKeys.panelInstanceKey)
    expect(failurePanel).toMatchObject({ open: true, mode: 'docked-bottom', windowInstanceId: 'main' })
    expect(fallbackEvents(failure)).toEqual([{ fallbackReason: 'window-crashed', fallbackMode: 'docked-bottom' }])

    // 同一注册、同一面板规格：用户意图 embedded ≠ 失败链 docked-bottom
    expect(userClosed.panel?.mode).toBe('embedded')
    expect(failurePanel?.mode).toBe('docked-bottom')
    expect(userClosed.panel?.mode).not.toBe(failurePanel?.mode)
  })
})

/**
 * **PLAT-40**：分离面板窗的受控回停靠（复用既有原生关闭语义：记用户意图 → 销毁窗口 → 既有转移事务回主窗）。
 * 判据只来自 registry + 权威快照；目标停靠模式由 Main 按 `lastValidDock` 收敛；非该窗 sender 一律 not-owner。
 */
describe('PLAT-40 分离面板窗回停靠（redockPanel）', () => {
  it('已提交 detached 面板：redockPanel → 窗口销毁 + 面板回到 lastValidDock，零残留飞事务', async () => {
    const harness = createHarness({ wireWindowDestroyed: true })
    const committed = await commitDetach(harness)
    expect(harness.panelOf(committed.panelInstanceKey)).toMatchObject({ mode: 'detached' })
    const detachedWindowId = harness.windowRegistry.listDetachedHosts()[0]?.windowInstanceId
    expect(detachedWindowId).toBeDefined()

    const result = await harness.composition.handlers.command(targetEvent(harness), {
      method: 'redockPanel', requestId: 'req-redock', expectedRevision: harness.revision(),
      panelInstanceKey: committed.panelInstanceKey
    })
    await harness.settle()

    expect(result.status).toBe('applied')
    expect(result.panelInstanceKey).toBe(committed.panelInstanceKey)
    // 窗口真的被销毁（用户可见：面板窗消失）
    expect(harness.handles[0]?.destroyed).toBe(true)
    // 面板回到 lastValidDock（本 fixture 的 defaultMode = embedded），归属主窗，且没有残留 transfer
    expect(harness.panelOf(committed.panelInstanceKey)).toMatchObject({
      mode: 'embedded', windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId
    })
    expect(harness.transferOf(committed.panelInstanceKey)).toBeUndefined()
    expect(harness.windowRegistry.listDetachedHosts()).toEqual([])
  })

  it('非该面板窗的 sender / 未分离面板 / 陈旧 revision 一律 fail closed（零窗口触碰）', async () => {
    const harness = createHarness({ wireWindowDestroyed: true })
    const committed = await commitDetach(harness)

    // 主窗调用 ⇒ not-owner（回停靠只属于分离面板窗自己）
    const fromMain = await harness.composition.handlers.command(harness.event(MAIN_WEBCONTENTS), {
      method: 'redockPanel', requestId: 'req-main', expectedRevision: harness.revision(),
      panelInstanceKey: committed.panelInstanceKey
    })
    expect(fromMain).toMatchObject({ status: 'rejected', errorCode: 'not-owner' })

    // 陈旧 revision ⇒ stale-revision（在触碰窗口之前）
    const stale = await harness.composition.handlers.command(targetEvent(harness), {
      method: 'redockPanel', requestId: 'req-stale', expectedRevision: harness.revision() - 1,
      panelInstanceKey: committed.panelInstanceKey
    })
    expect(stale).toMatchObject({ status: 'rejected', errorCode: 'stale-revision' })
    expect(harness.handles[0]?.destroyed).toBe(false)
    expect(harness.panelOf(committed.panelInstanceKey)).toMatchObject({ mode: 'detached' })
  })
})
