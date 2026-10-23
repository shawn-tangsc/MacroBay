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
  createPanelWorkspaceTransferAckPort,
  type TransferAckPending,
  type TransferAckPortDeps
} from './panelWorkspaceTransferAckPort'
import {
  createPanelDetachedWindowHost,
  type DetachedHostEvent,
  type DetachedWindowFactory,
  type DetachedWindowHandle
} from './panelDetachedWindowHost'
import { createWorkspaceWindowRegistry, type WorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace。P1-06e focused 回归：**宿主端口 + ACK 链 + claim 身份校验**。
 *
 * 本文件是 `panelWorkspaceTransferOrchestrator.ts` 拆分后的落点测试：
 * 1) 直接构造 ACK 端口（受控 fake 宿主 + 真 registry）：claim 身份校验、source-prepared 准入、
 *    native-close 驱动、以及「宿主是否确实投递过回退事件」的补发判据；
 * 2) 迁移自编排回归的 ACK 链用例（乱序/迟到 ACK、源拒绝准备、源确认失效、伪造 source claim、native-X 回停靠）：
 *    断言逐字保留，只换落点；仍走真实 P1-04 宿主 + 真实 P1-05 store + 真实 compose，只把窗口工厂与定时器换成注入 fake；
 * 3) P1-06e 修好的补发收窄：宿主已先行回滚（宿主持有并投递过 fallback）后窗口才 `closed` ⇒ 恰好 1 条 fallback；
 *    宿主确实没提供事件时仍必须补发（不得漏报）。
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
    // Electron 的 closed 是异步事件：这里同样异步派发，避免宿主事务内重入
    destroy: () => { handle.destroyed = true; if (onDestroyed) setTimeout(onDestroyed, 0) },
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
  /** 与 app.ts 一致：把工厂 `closed` 接到 mainHostBridge.windowDestroyed（默认关，避免影响其它用例时序）。 */
  wireWindowDestroyed?: boolean
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'p1-06e-transfer-'))
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

  const composition = composePanelWorkspace({
    productManifests: [composeManifest],
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

/**
 * ACK 端口直连夹具：真 registry（主窗 + 一条预留的独立宿主记录）+ 受控 fake 宿主 + 受控 fake store。
 * 用于验证本模块自己的职责（claim 身份校验、准入、回退事件判据），不经 compose/Electron。
 */
type AckHost = TransferAckPortDeps['host']

function createAckPortFixture(overrides: { withPending?: boolean } = {}) {
  let sequence = 0
  const windowRegistry = createWorkspaceWindowRegistry({ createOpaqueId: (prefix) => `${prefix}-${++sequence}` })
  const main = windowRegistry.registerMainWindow({ webContentsId: 1 })
  const reserved = windowRegistry.reserveDetachedWindow({
    hostEpoch: main.hostEpoch + 1, panelInstanceKey: 'panel-1', workspaceInstanceKey: 'workspace-1'
  })
  if (reserved.status !== 'reserved') throw new Error('reserve failed')
  const target = reserved.record
  const pending: TransferAckPending = {
    panelInstanceKey: 'panel-1', storeOperationId: 'store-op', hostOperationId: 'host-op',
    source: { windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId, hostEpoch: main.hostEpoch },
    target: { windowInstanceId: target.windowInstanceId, hostEpoch: target.hostEpoch },
    targetWindowInstanceId: target.windowInstanceId, targetHostEpoch: target.hostEpoch,
    phase: 'releasing', cancelDeadline: null
  }
  let phase: string | undefined = 'awaiting-source-release'
  const cleared: TransferAckPending[] = []
  const aborted: TransferAckPending[] = []
  const rolledBack: string[] = []
  const redocked: Array<[string, number, string]> = []
  const published: DetachedHostEvent[] = []
  const storeCalls: string[] = []
  const runtimeStore = {
    _sourcePrepared: async () => { storeCalls.push('sourcePrepared'); return { accepted: true } },
    _sourceReleased: async () => { storeCalls.push('sourceReleased'); return { accepted: true } },
    _commitTransfer: async () => { storeCalls.push('commitTransfer'); return { accepted: true } }
  }
  // 受控 fake 宿主：显式标注真实宿主端口签名，便于逐用例 mockReturnValueOnce 覆盖任一结论分支
  const host = {
    confirmTargetReady: vi.fn<AckHost['confirmTargetReady']>(() => ({ accepted: true as const })),
    confirmSourceReleased: vi.fn<AckHost['confirmSourceReleased']>((claim) => ({
      accepted: true as const, outcome: { status: 'committed' as const, ...claim }
    })),
    confirmSourceInvalid: vi.fn<AckHost['confirmSourceInvalid']>((claim) => ({
      accepted: true as const, outcome: { status: 'committed' as const, ...claim }
    })),
    reportWindowFailure: vi.fn<AckHost['reportWindowFailure']>(() => ({
      status: 'rejected' as const, operationId: '', errorCode: 'invalid-request' as const
    })),
    handleNativeClose: vi.fn<AckHost['handleNativeClose']>(() => ({
      status: 'ignored' as const, reason: 'unsupported' as const
    }))
  }
  const port = createPanelWorkspaceTransferAckPort({
    host: host as unknown as TransferAckPortDeps['host'],
    runtimeStore: runtimeStore as unknown as TransferAckPortDeps['runtimeStore'],
    windowRegistry,
    findByOperation: (operationId) => (operationId === pending.storeOperationId ? pending : undefined),
    findByTargetWindow: (windowInstanceId) => (overrides.withPending === false
      ? undefined
      : windowInstanceId === pending.targetWindowInstanceId ? pending : undefined),
    transferPhaseOf: (operationId) => (operationId === pending.storeOperationId ? phase : undefined),
    clearPending: (entry) => { cleared.push(entry) },
    armDeadline: () => undefined,
    rollbackPending: async (entry) => { rolledBack.push(entry.panelInstanceKey) },
    abortStoreTransfer: async (entry) => { aborted.push(entry) },
    redockCommittedWindow: async (windowInstanceId, hostEpoch, mode) => { redocked.push([windowInstanceId, hostEpoch, mode]) },
    publishHostEvent: (event) => { published.push(event); return true }
  })
  return {
    port, host, pending, target, main, cleared, aborted, rolledBack, redocked, published, storeCalls, windowRegistry,
    setPhase: (next: string | undefined) => { phase = next },
    setPendingPhase: (next: 'prepared' | 'releasing') => { pending.phase = next }
  }
}

describe('ACK 端口（直连）：claim 身份校验与准入', () => {
  it('伪造 source claim（未知窗口 / 错 epoch / 目标冒名 / store 哨兵）一律 not-owner，且不驱动宿主与 store', async () => {
    const fixture = createAckPortFixture()
    const forgeries = [
      { operationId: 'store-op', windowInstanceId: 'window-does-not-exist', hostEpoch: 4242 },
      { operationId: 'store-op', windowInstanceId: fixture.main.windowInstanceId, hostEpoch: 4242 },
      { operationId: 'store-op', windowInstanceId: fixture.target.windowInstanceId, hostEpoch: fixture.target.hostEpoch },
      { operationId: 'store-op', windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId, hostEpoch: 1 }
    ]
    for (const claim of forgeries) {
      expect(await fixture.port.hostPort.confirmSourceReleased(claim)).toMatchObject({ accepted: false, reason: 'not-owner' })
      expect(await fixture.port.hostPort.confirmSourceInvalid(claim)).toMatchObject({ accepted: false, reason: 'not-owner' })
    }
    expect(fixture.host.confirmSourceReleased).not.toHaveBeenCalled()
    expect(fixture.host.confirmSourceInvalid).not.toHaveBeenCalled()
    expect(fixture.storeCalls).toEqual([])
    expect(fixture.cleared).toEqual([])
  })

  it('真源 claim：宿主 commit + store released/commit 两侧成立才算完成，并清理编排登记', async () => {
    const fixture = createAckPortFixture()
    const outcome = await fixture.port.hostPort.confirmSourceReleased({
      operationId: 'store-op', windowInstanceId: fixture.main.windowInstanceId, hostEpoch: fixture.main.hostEpoch
    })
    expect(outcome).toMatchObject({ accepted: true, outcome: { status: 'committed' } })
    expect(fixture.storeCalls).toEqual(['sourceReleased', 'commitTransfer'])
    expect(fixture.cleared).toHaveLength(1)
  })

  it('端口相位未进入 releasing 时 source ACK 一律 invalid-phase，绝不提前 commit', async () => {
    const fixture = createAckPortFixture()
    fixture.setPendingPhase('prepared')
    expect(await fixture.port.hostPort.confirmSourceReleased({
      operationId: 'store-op', windowInstanceId: fixture.main.windowInstanceId, hostEpoch: fixture.main.hostEpoch
    })).toMatchObject({ accepted: false, reason: 'invalid-phase' })
    expect(fixture.storeCalls).toEqual([])
    expect(fixture.host.confirmSourceReleased).not.toHaveBeenCalled()
  })

  it('noteSourcePrepared：身份由编排侧推导（目标冒名拒绝）；源拒绝即中止事务', async () => {
    const fixture = createAckPortFixture()
    fixture.setPhase('awaiting-source-prepared')
    expect(await fixture.port.noteSourcePrepared({
      operationId: 'store-op', source: fixture.pending.target, accepted: true
    })).toEqual({ accepted: false })
    expect(fixture.storeCalls).toEqual([])
    expect(await fixture.port.noteSourcePrepared({
      operationId: 'store-op', source: fixture.pending.source, accepted: true
    })).toEqual({ accepted: true })
    expect(fixture.storeCalls).toEqual(['sourcePrepared'])
    expect(await fixture.port.noteSourcePrepared({
      operationId: 'store-op', source: fixture.pending.source, accepted: false
    })).toEqual({ accepted: false })
    expect(fixture.rolledBack).toEqual(['panel-1'])
  })

  it('native-close：在飞事务被中止（不重复发起回停靠）；已提交窗口才按宿主 redocked 结论走回停靠链', async () => {
    const inflight = createAckPortFixture()
    inflight.host.handleNativeClose.mockReturnValueOnce({ status: 'ignored' as const, reason: 'unsupported' as const })
    expect(await inflight.port.hostPort.handleNativeClose({
      windowInstanceId: inflight.target.windowInstanceId, hostEpoch: inflight.target.hostEpoch,
      lastValidDock: 'embedded', supportedModes: ['embedded', 'detached']
    })).toMatchObject({ status: 'ignored' })
    expect(inflight.aborted).toHaveLength(1)
    expect(inflight.redocked).toEqual([])

    const committed = createAckPortFixture({ withPending: false })
    committed.host.handleNativeClose.mockReturnValueOnce({ status: 'redocked' as const, mode: 'docked-right' as const })
    expect(await committed.port.hostPort.handleNativeClose({
      windowInstanceId: committed.target.windowInstanceId, hostEpoch: committed.target.hostEpoch,
      lastValidDock: 'docked-right', supportedModes: ['embedded', 'docked-right', 'detached']
    })).toEqual({ status: 'redocked', mode: 'docked-right' })
    expect(committed.redocked).toEqual([[committed.target.windowInstanceId, committed.target.hostEpoch, 'docked-right']])
    expect(committed.aborted).toEqual([])
    // store 哨兵/未知窗口的 native-close 声明不得命中任何飞事务（宿主结论原样返回，编排不猜身份）
    expect(await committed.port.hostPort.handleNativeClose({
      windowInstanceId: 'window-does-not-exist', hostEpoch: 1, lastValidDock: 'embedded', supportedModes: ['embedded']
    })).toMatchObject({ status: 'ignored' })
    expect(committed.aborted).toEqual([])
    expect(committed.redocked).toHaveLength(1)
  })

  it('宿主回退「已提供」判据：只有 rolled-back 且带 fallbackMode 才算宿主确实投递了回退事件', async () => {
    const fixture = createAckPortFixture()
    // 无 operation 的静默回滚（fallbackMode undefined）：宿主销毁了窗口但没有投递事件 ⇒ 允许编排补发
    fixture.host.reportWindowFailure.mockReturnValueOnce({
      status: 'rolled-back' as const, operationId: '', fallbackReason: 'window-crashed' as const, fallbackMode: undefined
    })
    expect(await fixture.port.reportHostWindowFailure({ windowInstanceId: 'window-x', hostEpoch: 2, kind: 'crash' }))
      .toMatchObject({ hostProvidedFallback: false })
    expect(fixture.port.hostProvidedFallback('window-x')).toBe(false)
    // 宿主拒绝（身份不可用）：同样没有提供事件
    expect(await fixture.port.reportHostWindowFailure({ windowInstanceId: 'window-x', hostEpoch: 2, kind: 'crash' }))
      .toMatchObject({ hostProvidedFallback: false })
    // 宿主真实回滚并投递 fallback：记录在案，此后同一窗口再被驱动（closed）也不得再补发
    fixture.host.reportWindowFailure.mockReturnValueOnce({
      status: 'rolled-back' as const, operationId: 'host-op', fallbackReason: 'window-crashed' as const, fallbackMode: 'docked-right' as const
    })
    expect(await fixture.port.reportHostWindowFailure({ windowInstanceId: 'window-y', hostEpoch: 3, kind: 'crash' }))
      .toMatchObject({ hostProvidedFallback: true })
    expect(fixture.port.hostProvidedFallback('window-y')).toBe(true)
    expect(await fixture.port.reportHostWindowFailure({ windowInstanceId: 'window-y', hostEpoch: 3, kind: 'crash' }))
      .toMatchObject({ hostProvidedFallback: true })
    // 记录是「按窗口」的：不污染其它窗口；收敛完成后可释放
    expect(fixture.port.hostProvidedFallback('window-z')).toBe(false)
    fixture.port.forgetHostFallback('window-y')
    expect(fixture.port.hostProvidedFallback('window-y')).toBe(false)
  })
})

describe('detach 编排：ACK 链准入（P1-06e 由编排回归迁入）', () => {
  it('迟到 ACK：回滚后 target-ready / source-released 一律拒绝且不改布局、不再建窗', async () => {
    const harness = createHarness()
    const started = await detachOnce(harness)
    const before = harness.revision()
    await harness.fireTimer(WorkspaceTransferPolicy.prepareTargetTimeoutMs)
    const afterRollback = harness.revision()
    const late = await harness.composition.handlers.hostLifecycle(targetEvent(harness), {
      operationId: started.operationId, phase: 'target-ready'
    })
    expect(late.accepted).toBe(false)
    const lateRelease = await harness.composition.handlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), {
      operationId: started.operationId, phase: 'source-released'
    })
    expect(lateRelease.accepted).toBe(false)
    expect(harness.handles).toHaveLength(1)
    expect(harness.revision()).toBe(afterRollback)
    expect(afterRollback).toBeGreaterThan(before)
    expect(harness.panelOf(started.panelInstanceKey)).toMatchObject({ mode: 'embedded' })
    expect(harness.transferOf(started.panelInstanceKey)).toBeUndefined()
  })

  it('乱序 ACK：目标未 ready 时 source-released 必须被拒，绝不提前提交', async () => {
    const harness = createHarness()
    const started = await detachOnce(harness)
    const early = await harness.composition.handlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), {
      operationId: started.operationId, phase: 'source-released'
    })
    expect(early.accepted).toBe(false)
    expect(harness.host.committedOwners()).toEqual([])
    expect(harness.transferOf(started.panelInstanceKey)).toMatchObject({ phase: 'awaiting-source-prepared' })
    expect(harness.handles[0]?.destroyed).toBe(false)
  })

  it('源拒绝准备（source-prepared accepted=false）：中止事务、销毁目标壳窗、预算立即归还', async () => {
    const harness = createHarness()
    const started = await detachOnce(harness)
    const refused = await harness.composition.handlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), {
      operationId: started.operationId, phase: 'source-prepared', accepted: false
    })
    expect(refused).toEqual({ accepted: false, reason: 'source-rejected' })
    expect(harness.transferOf(started.panelInstanceKey)).toBeUndefined()
    expect(harness.handles[0]?.destroyed).toBe(true)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.pendingOperationIds()).toEqual([])
    expect(harness.panelOf(started.panelInstanceKey)).toMatchObject({
      open: true, mode: 'embedded', windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId
    })
    expect(harness.events.some((entry) => entry.type === 'fallback' && entry.fallbackReason !== undefined)).toBe(true)
  })

  it('源确认失效（source-invalid）：仍按 commit 链把挂载权交给目标宿主', async () => {
    const harness = createHarness()
    const started = await detachOnce(harness)
    await harness.composition.handlers.hostLifecycle(targetEvent(harness), {
      operationId: started.operationId, phase: 'target-ready'
    })
    const invalid = await harness.composition.handlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), {
      operationId: started.operationId, phase: 'source-invalid'
    })
    expect(invalid).toMatchObject({ accepted: true, outcome: { status: 'committed' } })
    const target = harness.windowRegistry.listDetachedHosts()[0]
    expect(harness.transferOf(started.panelInstanceKey)).toBeUndefined()
    expect(harness.panelOf(started.panelInstanceKey)).toMatchObject({
      mode: 'detached', windowInstanceId: target?.windowInstanceId, hostEpoch: target?.hostEpoch
    })
    expect(harness.host.committedOwners()).toEqual([started.panelInstanceKey])
  })

  it('N5：伪造 source claim（未知窗口/错 epoch/拿目标身份冒名）一律 not-owner，不 commit 不改 revision', async () => {
    const harness = createHarness()
    const started = await detachOnce(harness)
    await harness.composition.handlers.hostLifecycle(targetEvent(harness), {
      operationId: started.operationId, phase: 'target-ready'
    })
    const orchestrator = harness.composition.transferOrchestrator
    if (!orchestrator) throw new Error('no orchestrator')
    const before = harness.revision()
    const mainRecord = harness.windowRegistry.listWindows().find((entry) => entry.kind === 'main')
    const target = harness.windowRegistry.listDetachedHosts()[0]
    if (!mainRecord || !target) throw new Error('missing registry records')
    const forgeries = [
      // 完全不存在的窗口
      { operationId: started.operationId, windowInstanceId: 'window-does-not-exist', hostEpoch: 4242 },
      // 已知窗口但 epoch 伪造
      { operationId: started.operationId, windowInstanceId: mainRecord.windowInstanceId, hostEpoch: 4242 },
      // 拿目标窗口身份冒名顶替源（身份交叉）
      { operationId: started.operationId, windowInstanceId: target.windowInstanceId, hostEpoch: target.hostEpoch },
      // 直接塞 store 哨兵身份（端口只认 registry 身份，不接受绕过 sender 层的 store 身份）
      { operationId: started.operationId, windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId, hostEpoch: 1 }
    ]
    for (const claim of forgeries) {
      expect(await orchestrator.hostPort.confirmSourceReleased(claim)).toMatchObject({ accepted: false })
      expect(await orchestrator.hostPort.confirmSourceInvalid(claim)).toMatchObject({ accepted: false })
    }
    expect(harness.host.committedOwners()).toEqual([])
    expect(harness.revision()).toBe(before)
    expect(harness.transferOf(started.panelInstanceKey)).toMatchObject({ phase: 'awaiting-source-release' })
    // 真源身份仍可正常提交（拒绝的是伪造，不是拒绝 source 相位本身）
    const ok = await harness.composition.handlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), {
      operationId: started.operationId, phase: 'source-released'
    })
    expect(ok).toMatchObject({ accepted: true, outcome: { status: 'committed' } })
  })
})

describe('detach 编排：native-X 回停靠（P1-06e 由编排回归迁入）', () => {
  it('已提交的独立窗原生关闭 = 回停靠：窗口销毁、预留释放、store 归还主窗且 open 不变', async () => {
    const harness = createHarness()
    const committed = await commitDetach(harness)
    const target = harness.windowRegistry.listDetachedHosts()[0]
    // 已提交后 store 里没有飞事务，IPC 生命周期阶段没有 operationId 可认领：
    // 原生 X 由 app 侧桥（窗口工厂 close → mainHostBridge.nativeClose）驱动
    expect(harness.composition.mainHostBridge).not.toBeNull()
    const closed = await harness.composition.mainHostBridge?.nativeClose({
      windowInstanceId: target?.windowInstanceId ?? '', hostEpoch: target?.hostEpoch ?? 0
    })
    expect(closed).toBe(true)
    expect(target).toBeDefined()
    expect(harness.handles[0]?.destroyed).toBe(true)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.committedOwners()).toEqual([])
    // 回停靠（lastValidDock → 安全链）而不是逻辑关闭：open 仍为 true、归属主窗
    expect(harness.panelOf(committed.panelInstanceKey)).toMatchObject({
      open: true, mode: 'embedded', windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId,
      hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch
    })
    expect(harness.transferOf(committed.panelInstanceKey)).toBeUndefined()
    expect(harness.panelOf(committed.panelInstanceKey)?.lastValidDock).toBe('embedded')
    expect(target).toBeDefined()
    // 原生关闭必须通知消费者回停靠模式，而不是按逻辑关闭处理
    expect(harness.events.some((entry) => entry.type === 'container-change-requested' && entry.fallbackMode === 'embedded'))
      .toBe(true)
    // 且该次回停靠事件必须真的投递给仍存活的主窗（承载者已销毁时不得静默丢弃）
    const redockSent = harness.sent.filter((entry) =>
      entry.event.type === 'container-change-requested' && entry.event.fallbackMode === 'embedded')
    expect(redockSent).toHaveLength(1)
    expect(redockSent[0]?.webContentsId).toBe(MAIN_WEBCONTENTS)
  })

  it('app 同接线（工厂 closed → windowDestroyed）：native-X 仍只发生一次回停靠，不被二次事务改写', async () => {
    const harness = createHarness({ wireWindowDestroyed: true })
    const committed = await commitDetach(harness)
    const target = harness.windowRegistry.listDetachedHosts()[0]
    if (!target) throw new Error('no detached host')
    const before = harness.revision()
    await harness.composition.mainHostBridge?.nativeClose({
      windowInstanceId: target.windowInstanceId, hostEpoch: target.hostEpoch
    })
    await harness.settle()
    expect(harness.panelOf(committed.panelInstanceKey)).toMatchObject({
      open: true, mode: 'embedded', windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId
    })
    // 回停靠事务恰好 +2 revision（_beginTransfer + _commitTransfer）：closed 回调没有发起第二条事务
    expect(harness.revision() - before).toBe(2)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.committedOwners()).toEqual([])
    expect(harness.composition.transferOrchestrator?.pendingCount()).toBe(0)
  })

  it('在飞事务中原生关闭：中止转移即回停靠，面板留在源宿主，零孤儿', async () => {
    const harness = createHarness()
    const started = await detachOnce(harness)
    await harness.composition.handlers.hostLifecycle(targetEvent(harness), {
      operationId: started.operationId, phase: 'target-ready'
    })
    const closed = await harness.composition.handlers.hostLifecycle(targetEvent(harness), {
      operationId: started.operationId, phase: 'native-close'
    })
    expect(closed).toEqual({ accepted: true })
    expect(harness.panelOf(started.panelInstanceKey)).toMatchObject({
      mode: 'embedded', windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId, open: true
    })
    expect(harness.handles[0]?.destroyed).toBe(true)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.pendingOperationIds()).toEqual([])
    // store 只允许「到期清除」：编排按相位上界有界重试，绝不留下永久飞事务
    expect(await harness.fireTimer(WorkspaceTransferPolicy.releaseTimeoutMs)).toBe(1)
    expect(harness.transferOf(started.panelInstanceKey)).toBeUndefined()
  })
})

describe('detach 编排：宿主已投递回退事件时的补发收窄（P1-06e）', () => {
  it('宿主已先行回滚（已自行投递 fallback）后窗口才 closed ⇒ 同一崩溃只投递 1 条 fallback', async () => {
    const harness = createHarness({ wireWindowDestroyed: true })
    const committed = await commitDetach(harness)
    const target = harness.windowRegistry.listDetachedHosts()[0]
    if (!target) throw new Error('no detached host')
    const orchestrator = harness.composition.transferOrchestrator
    if (!orchestrator) throw new Error('no orchestrator')
    // 宿主先行回滚：宿主自己投递一条 fallback（窗口销毁 → 工厂 closed 稍后异步到达）
    const failed = await orchestrator.hostPort.reportWindowFailure({
      windowInstanceId: target.windowInstanceId, hostEpoch: target.hostEpoch, kind: 'crash'
    })
    expect(failed).toMatchObject({ status: 'rolled-back', fallbackReason: 'window-crashed' })
    await harness.settle()
    const fallbacks = harness.sent.filter((entry) => entry.event.type === 'fallback')
    expect(fallbacks).toHaveLength(1)
    expect(fallbacks[0]?.webContentsId).toBe(MAIN_WEBCONTENTS)
    // 收敛不变：回停靠、零孤儿、预算归还
    expect(harness.panelOf(committed.panelInstanceKey)).toMatchObject({
      open: true, mode: 'docked-right', windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId
    })
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.composition.transferOrchestrator?.pendingCount()).toBe(0)
  })

  it('宿主未提供回退事件（登记被外部回收）时，closed 仍必须补发恰好 1 条 fallback', async () => {
    const harness = createHarness()
    const committed = await commitDetach(harness)
    const target = harness.windowRegistry.listDetachedHosts()[0]
    if (!target) throw new Error('no detached host')
    harness.handles[0]!.destroyed = true
    harness.windowRegistry.markDestroyed({ windowInstanceId: target.windowInstanceId })
    await harness.composition.mainHostBridge?.windowDestroyed({ windowInstanceId: target.windowInstanceId })
    const fallbacks = harness.sent.filter((entry) => entry.event.type === 'fallback')
    expect(fallbacks).toHaveLength(1)
    expect(fallbacks[0]?.webContentsId).toBe(MAIN_WEBCONTENTS)
    expect(fallbacks[0]?.event.fallbackMode).toBe('docked-right')
    expect(harness.panelOf(committed.panelInstanceKey)).toMatchObject({
      open: true, mode: 'docked-right', windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId
    })
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
  })
})
