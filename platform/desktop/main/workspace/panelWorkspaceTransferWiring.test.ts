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
 * Owner: platform/desktop/main/workspace。P1-06f focused 端到端（不启动 Electron）：真 compose + 真 P1-04 宿主 +
 * 真 store/handlers，只把窗口工厂与定时器换成注入 fake。证明 D1 的完整链可走通，且每一跳都只用受控 IPC：
 * detachPanel →（目标窗只从受控待接管视图拿到 operationId）→ 源 source-prepared → 目标 target-ready →
 * 源 source-released → 提交（mode:'detached' 且归属目标窗）→ 目标 mounts 非空 → 原生 X ⇒ 回停靠可用。
 */

const PRELOAD = '/app/preload/index.js'
const APP_ROOT = 'file:///app/renderer'
const ENTRY = 'file:///app/renderer/index.html'
const PAGE_ID = 'sample.overview'
const PANEL_ID = 'sample.inspector'
const MAIN_WEBCONTENTS = 1
const TARGET_WEBCONTENTS = 100

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
})

type FakeWindow = DetachedWindowHandle & {
  destroyed: boolean
  loadedUrls: string[]
  /** P1-06l：渲染器进程崩溃态（生产＝工厂的 `render-process-gone` 主信号 + `isCrashed()` 兜底）。 */
  rendererCrashed: boolean
  crashListeners: Set<() => void>
}
type Timer = { delayMs: number; run: () => void; cancelled: boolean }
type SentEvent = { webContentsId: number; event: WorkspaceEvent }

export function createHarness(options: {
  /** P1-06g：受限注册（例如不支持 docked-right）用同一份清单改写面板贡献，其余逐字不变。 */
  panelSupportedModes?: readonly string[]
  panelDefaultMode?: string
  /** P1-06j：与 app.ts 一致把工厂 `closed` 接到 mainHostBridge.windowDestroyed（真机必经路径）。 */
  wireWindowDestroyed?: boolean
  /**
   * P1-06l：复现真机「加载期 Page.crash」——`loadURL` 立即拒绝，而 `render-process-gone`
   * **晚一轮原生任务**才可见（真机 7D/7E/7F：词表被写成 window-load-failed）。
   */
  crashOnLoad?: boolean
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'p1-06f-wiring-'))
  roots.push(root)
  let sequence = 0
  const windowRegistry: WorkspaceWindowRegistry = createWorkspaceWindowRegistry({ createOpaqueId: (prefix) => `${prefix}-${++sequence}` })
  const handles: FakeWindow[] = []
  const timers: Timer[] = []
  const sent: SentEvent[] = []
  let workspaceRef: {
    publishHostEvent: (event: DetachedHostEvent) => boolean
    mainHostBridge: ReturnType<typeof composePanelWorkspace>['mainHostBridge']
  } | null = null

  const createWindow: DetachedWindowFactory = (input) => {
    const handle: FakeWindow = {
      webContentsId: TARGET_WEBCONTENTS + handles.length, destroyed: false, loadedUrls: [],
      rendererCrashed: false, crashListeners: new Set<() => void>(),
      loadURL: (url) => {
        if (handle.destroyed) return Promise.reject(new Error('window-destroyed'))
        handle.loadedUrls.push(url)
        if (options.crashOnLoad === true) {
          // 真机时序：崩溃信号（render-process-gone）与加载失败不在同一 tick，晚一轮事件循环才可见
          setTimeout(() => { crashRenderer(handle) }, 0)
          return Promise.reject(new Error('ERR_FAILED'))
        }
        return Promise.resolve()
      },
      isDestroyed: () => handle.destroyed,
      // 真实工厂语义：窗口销毁后一律 false（已销毁窗口绝不被报成崩溃）
      isCrashed: () => !handle.destroyed && handle.rendererCrashed,
      onRendererGone: (listener) => {
        handle.crashListeners.add(listener)
        return () => { handle.crashListeners.delete(listener) }
      },
      // P1-07R 真机顺序（P1-06j）：真实工厂 `created.on('closed')` 在 `destroy()` 内**同步**派发；
      // 异步派发会掩盖「用户关闭意图与外部销毁收敛抢跑」的真实竞争。
      destroy: () => {
        handle.destroyed = true
        handle.crashListeners.clear()
        if (options.wireWindowDestroyed === true) {
          void workspaceRef?.mainHostBridge?.windowDestroyed({ windowInstanceId: input.windowInstanceId })
        }
      },
      focus: () => undefined, setWindowOpenHandler: () => undefined
    }
    handles.push(handle)
    return handle
  }

  /** P1-06l：渲染器崩溃（真机 `Page.crash`）：置位崩溃态并通知全部在册订阅者。 */
  const crashRenderer = (handle: FakeWindow = handles[handles.length - 1] as FakeWindow): void => {
    if (handle === undefined || handle.destroyed || handle.rendererCrashed) return
    handle.rendererCrashed = true
    for (const listener of [...handle.crashListeners]) {
      try { listener() } catch { /* 订阅者异常不得影响窗口/其它订阅者 */ }
    }
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
    timers: timerPort(),
    targetReadyTimeoutMs: 5_000,
    releaseTimeoutMs: 1_000,
    onEvent: (event: DetachedHostEvent) => { workspaceRef?.publishHostEvent(event) }
  })
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
    transferTimers: timerPort()
  })
  if (composition.status !== 'ready') throw new Error(`composition disabled: ${composition.reason}`)
  workspaceRef = { publishHostEvent: composition.publishHostEvent, mainHostBridge: composition.mainHostBridge }

  const event = (webContentsId: number) => ({ senderFrame: { parent: null }, sender: { id: webContentsId, isDestroyed: () => false } })
  const revision = () => composition.runtimeStore.getSnapshot().layoutRevision
  const panelOf = (panelInstanceKey: string) =>
    composition.runtimeStore.getSnapshot().panels.find((panel) => panel.panelInstanceKey === panelInstanceKey)
  const pendingTimerDelays = () => [...new Set(timers.filter((timer) => !timer.cancelled).map((timer) => timer.delayMs))]

  /** 真实命令打开 workspace + panel（不伪造 store 状态）。 */
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
    return { panelInstanceKey: panel.panelInstanceKey as string, workspaceInstanceKey: workspace.workspaceInstanceKey as string }
  }
  const targetEvent = () => event(handles[handles.length - 1]?.webContentsId ?? TARGET_WEBCONTENTS)
  const contextOf = async (sender: ReturnType<typeof event>) => {
    const outcome = await composition.handlers.getHostContext(sender)
    if (outcome.status !== 'ok') throw new Error(`context rejected: ${JSON.stringify(outcome)}`)
    return outcome.context
  }
  const detach = (panelInstanceKey: string, requestId = 'req-detach') => composition.handlers.command(
    event(MAIN_WEBCONTENTS), { method: 'detachPanel', requestId, expectedRevision: revision(), panelInstanceKey }
  )

  /**
   * 排空异步收敛链：宿主 `destroy()` 内同步派发的 `closed` 走的是 app.ts 的 fire-and-forget 桥
   * （`void mainHostBridge.windowDestroyed(...)`），回停靠事务在微任务里继续推进。
   */
  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
  }

  return {
    composition, host, handles, sent, windowRegistry, event, targetEvent,
    revision, panelOf, pendingTimerDelays, openInspector, contextOf, detach, crashRenderer, settle
  }
}

type Harness = ReturnType<typeof createHarness>

describe('P1-06f 端到端：受控待接管视图驱动的完整 ACK 链', () => {
  it('detachPanel → 目标受控视图 → 三段 ACK → 提交 → 目标 mounts 非空 → 原生 X 回停靠', async () => {
    const harness = createHarness()
    const keys = await harness.openInspector()
    const detached = await harness.detach(keys.panelInstanceKey)
    expect(detached.status).toBe('applied')
    // 目标窗真实创建并只加载受控空壳 entry
    expect(harness.handles).toHaveLength(1)
    expect(harness.handles[0]?.loadedUrls).toEqual([ENTRY])
    expect(harness.panelOf(keys.panelInstanceKey)).toMatchObject({
      mode: 'embedded', windowInstanceId: 'main', transfer: { phase: 'awaiting-source-prepared' }
    })

    // 目标窗**只**从受控 getHostContext 得知「我是待接管目标」，并据此拿到 operationId（不读 URL/localStorage）
    const targetContext = await harness.contextOf(harness.targetEvent())
    expect(targetContext).toMatchObject({
      role: 'panel', mounts: [],
      pendingTransfer: {
        status: 'in-flight', panelInstanceKey: keys.panelInstanceKey, panelId: PANEL_ID,
        workspaceInstanceKey: keys.workspaceInstanceKey, phase: 'awaiting-source-prepared'
      }
    })
    const operationId = targetContext.pendingTransfer?.status === 'in-flight' ? targetContext.pendingTransfer.operationId : null
    if (operationId === null) throw new Error('target did not receive a controlled pending-transfer view')
    expect(operationId).toBe(harness.panelOf(keys.panelInstanceKey)?.transfer?.operationId)

    // 源 prepared（源身份与 epoch 由 Main 从 registry 推导）
    await expect(harness.composition.handlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), {
      operationId, phase: 'source-prepared', accepted: true
    })).resolves.toEqual({ accepted: true })
    expect(harness.panelOf(keys.panelInstanceKey)?.transfer).toMatchObject({ phase: 'awaiting-target-ready' })

    // 目标 ready：视图相位必须跟着推进，源收到 container-changing（源据此进入 release）
    await expect(harness.composition.handlers.hostLifecycle(harness.targetEvent(), { operationId, phase: 'target-ready' }))
      .resolves.toEqual({ accepted: true })
    expect(harness.panelOf(keys.panelInstanceKey)?.transfer).toMatchObject({ phase: 'awaiting-source-release' })
    const releasing = await harness.contextOf(harness.targetEvent())
    expect(releasing.pendingTransfer).toMatchObject({ status: 'in-flight', operationId, phase: 'awaiting-source-release' })
    expect(harness.sent.some((entry) => entry.webContentsId === MAIN_WEBCONTENTS && entry.event.type === 'container-changing')).toBe(true)

    // 源 released ⇒ 提交：面板 mode:'detached' 且归属目标窗
    await expect(harness.composition.handlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), { operationId, phase: 'source-released' }))
      .resolves.toMatchObject({ accepted: true, outcome: { status: 'committed' } })
    const target = harness.windowRegistry.listDetachedHosts()[0]
    expect(harness.panelOf(keys.panelInstanceKey)).toMatchObject({
      mode: 'detached', windowInstanceId: target?.windowInstanceId, hostEpoch: target?.hostEpoch
    })
    expect(harness.panelOf(keys.panelInstanceKey)?.transfer).toBeUndefined()
    expect(harness.host.committedOwners()).toEqual([keys.panelInstanceKey])
    expect(harness.pendingTimerDelays()).toEqual([])

    // 提交后：目标 mounts 非空（同一份作用域投影，未放宽）且受控视图消失；目标快照真的能看到面板
    const committedContext = await harness.contextOf(harness.targetEvent())
    expect(committedContext.pendingTransfer).toBeNull()
    expect(committedContext.mounts).toEqual([{
      workspaceInstanceKey: keys.workspaceInstanceKey, panelInstanceKey: keys.panelInstanceKey,
      panelId: PANEL_ID, open: true, mode: 'detached', bindingState: 'unavailable'
    }])
    const committedSnapshot = await harness.composition.handlers.getSnapshot(harness.targetEvent())
    if (committedSnapshot.status !== 'ok') throw new Error('target snapshot rejected')
    expect(committedSnapshot.snapshot.panels.map((panel) => panel.panelInstanceKey)).toEqual([keys.panelInstanceKey])
    expect(committedSnapshot.snapshot.pageLayouts).toHaveLength(1)

    // 已提交窗口的原生 X ⇒ 回停靠（此前在真机不可达）
    if (!target) throw new Error('no detached host')
    await expect(harness.composition.mainHostBridge?.nativeClose({
      windowInstanceId: target.windowInstanceId, hostEpoch: target.hostEpoch
    })).resolves.toBe(true)
    expect(harness.handles[0]?.destroyed).toBe(true)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.committedOwners()).toEqual([])
    expect(harness.host.pendingOperationIds()).toEqual([])
    // 原生 X 走「用户回停靠」：优先 lastValidDock（此面板 defaultMode = embedded），绝不写 open=false
    expect(harness.panelOf(keys.panelInstanceKey)).toMatchObject({
      open: true, mode: 'embedded', windowInstanceId: 'main', hostEpoch: 1
    })
    expect(harness.panelOf(keys.panelInstanceKey)?.transfer).toBeUndefined()
    // 回停靠事件按面板定向投递给仍存活的主窗
    expect(harness.sent.some((entry) => entry.webContentsId === MAIN_WEBCONTENTS
      && entry.event.scope.panelInstanceKey === keys.panelInstanceKey)).toBe(true)
    expect(harness.pendingTimerDelays()).toEqual([])
  })

  it('回停靠后同一面板仍可再次分离（受控视图再次出现，零孤儿）', async () => {
    const harness = createHarness()
    const keys = await harness.openInspector()
    await harness.detach(keys.panelInstanceKey)
    const first = await harness.contextOf(harness.targetEvent())
    if (first.pendingTransfer?.status !== 'in-flight') throw new Error('no controlled view')
    const operationId = first.pendingTransfer.operationId
    await harness.composition.handlers.hostLifecycle(harness.targetEvent(), { operationId, phase: 'target-ready' })
    // Main 代源确认（P1-04 无 prepared 端口时仍可用）：目标 ready 一条 ACK 即可推进
    expect(harness.panelOf(keys.panelInstanceKey)?.transfer).toMatchObject({ phase: 'awaiting-source-release' })
    await harness.composition.handlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), { operationId, phase: 'source-released' })
    expect(harness.panelOf(keys.panelInstanceKey)).toMatchObject({ mode: 'detached' })

    // 原生 X 回停靠后再分离：必须新建窗口、重新给出受控视图
    const target = harness.windowRegistry.listDetachedHosts()[0]
    if (!target) throw new Error('no detached host')
    await harness.composition.mainHostBridge?.nativeClose({ windowInstanceId: target.windowInstanceId, hostEpoch: target.hostEpoch })
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    const again = await harness.composition.handlers.command(harness.event(MAIN_WEBCONTENTS), {
      method: 'detachPanel', requestId: 'req-detach-again', expectedRevision: harness.revision(), panelInstanceKey: keys.panelInstanceKey
    })
    expect(again.status).toBe('applied')
    expect(harness.handles).toHaveLength(2)
    expect(harness.windowRegistry.detachedHostCount()).toBe(1)
    const second = await harness.contextOf(harness.targetEvent())
    expect(second.pendingTransfer).toMatchObject({ status: 'in-flight', panelInstanceKey: keys.panelInstanceKey })
    expect(harness.composition.transferOrchestrator?.pendingCount()).toBe(1)
  })

  it('身份校验不放宽：别的窗口不能用自己的身份替目标报 ready，也不能替源 release', async () => {
    const harness = createHarness()
    const keys = await harness.openInspector()
    await harness.detach(keys.panelInstanceKey)
    const view = await harness.contextOf(harness.targetEvent())
    if (view.pendingTransfer?.status !== 'in-flight') throw new Error('no controlled view')
    const operationId = view.pendingTransfer.operationId

    // 源窗冒名报 target-ready / 目标窗冒名替源 release：身份或相位不对，一律拒绝且不改布局
    await expect(harness.composition.handlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), { operationId, phase: 'target-ready' }))
      .resolves.toMatchObject({ accepted: false })
    await expect(harness.composition.handlers.hostLifecycle(harness.targetEvent(), { operationId, phase: 'source-released' }))
      .resolves.toMatchObject({ accepted: false })
    expect(harness.panelOf(keys.panelInstanceKey)).toMatchObject({
      mode: 'embedded', windowInstanceId: 'main', transfer: { phase: 'awaiting-source-prepared' }
    })
    expect(harness.host.pendingOperationIds()).toHaveLength(1)
    expect(harness.windowRegistry.detachedHostCount()).toBe(1)
  })
})

describe('P1-06g 端到端：崩溃词表与「安全回退链 vs lastValidDock」对照', () => {
  const fallbackEvents = (harness: Harness) => harness.sent.filter((entry) => entry.event.type === 'fallback')

  /** 走完整链提交（source-prepared 由 Main 代确认），返回提交后的目标窗口身份。 */
  async function commitDetach(harness: Harness) {
    const keys = await harness.openInspector()
    const detached = await harness.detach(keys.panelInstanceKey)
    expect(detached.status).toBe('applied')
    const view = await harness.contextOf(harness.targetEvent())
    if (view.pendingTransfer?.status !== 'in-flight') throw new Error('no controlled view')
    const operationId = view.pendingTransfer.operationId
    await harness.composition.handlers.hostLifecycle(harness.targetEvent(), { operationId, phase: 'target-ready' })
    await harness.composition.handlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), { operationId, phase: 'source-released' })
    const target = harness.windowRegistry.listDetachedHosts()[0]
    if (!target) throw new Error('no detached host')
    expect(harness.panelOf(keys.panelInstanceKey)?.mode).toBe('detached')
    expect(harness.panelOf(keys.panelInstanceKey)?.transfer).toBeUndefined()
    return { ...keys, target }
  }

  it('已提交窗口崩溃（外部销毁）⇒ window-crashed 且回退到链首 docked-right，零孤儿', async () => {
    const harness = createHarness()
    const committed = await commitDetach(harness)
    harness.handles[0]!.destroyed = true
    await harness.composition.mainHostBridge?.windowDestroyed({ windowInstanceId: committed.target.windowInstanceId })

    // 错误路径走安全回退链（docked-right 是链首，绝不是 lastValidDock）：面板回停靠态、归属主窗
    expect(harness.panelOf(committed.panelInstanceKey)).toMatchObject({
      open: true, mode: 'docked-right', windowInstanceId: 'main', hostEpoch: 1
    })
    const delivered = fallbackEvents(harness)
    expect(delivered[0]?.webContentsId).toBe(MAIN_WEBCONTENTS)
    expect(delivered[0]?.event).toMatchObject({ fallbackReason: 'window-crashed', fallbackMode: 'docked-right' })
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.committedOwners()).toEqual([])
    expect(harness.pendingTimerDelays()).toEqual([])
  })

  it('准备期目标崩溃（window-failure ACK）⇒ window-crashed，回退事件带链首 docked-right', async () => {
    const harness = createHarness()
    const keys = await harness.openInspector()
    await harness.detach(keys.panelInstanceKey)
    const view = await harness.contextOf(harness.targetEvent())
    if (view.pendingTransfer?.status !== 'in-flight') throw new Error('no controlled view')

    await expect(harness.composition.handlers.hostLifecycle(harness.targetEvent(), {
      operationId: view.pendingTransfer.operationId, phase: 'window-failure', kind: 'crash'
    })).resolves.toEqual({ accepted: true })

    const delivered = fallbackEvents(harness)
    expect(delivered.map((entry) => entry.event.fallbackReason)).toEqual(['window-crashed'])
    expect(delivered[0]?.event.fallbackMode).toBe('docked-right')
    expect(harness.handles[0]?.destroyed).toBe(true)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
  })

  it('对照（不支持 docked-right 的注册）：错误走链 ⇒ docked-bottom；用户原生 X ⇒ lastValidDock embedded', async () => {
    const restricted = { panelSupportedModes: ['embedded', 'docked-bottom', 'detached'] as const }

    // 错误路径：链首 docked-right 未注册 ⇒ docked-bottom；lastValidDock 恒为 embedded（若走 lastValidDock 就会得到 embedded）
    const failure = createHarness(restricted)
    const failedCommit = await commitDetach(failure)
    expect(failure.panelOf(failedCommit.panelInstanceKey)?.lastValidDock).toBe('embedded')
    failure.handles[0]!.destroyed = true
    await failure.composition.mainHostBridge?.windowDestroyed({ windowInstanceId: failedCommit.target.windowInstanceId })
    const failedPanel = failure.panelOf(failedCommit.panelInstanceKey)
    expect(failedPanel).toMatchObject({ open: true, mode: 'docked-bottom', windowInstanceId: 'main' })
    expect(fallbackEvents(failure)[0]?.event).toMatchObject({
      fallbackReason: 'window-crashed', fallbackMode: 'docked-bottom'
    })

    // 用户意图：同一受限注册 + 同一 lastValidDock，原生 X 必须优先 lastValidDock
    const user = createHarness(restricted)
    const userCommit = await commitDetach(user)
    await expect(user.composition.mainHostBridge?.nativeClose({
      windowInstanceId: userCommit.target.windowInstanceId, hostEpoch: userCommit.target.hostEpoch
    })).resolves.toBe(true)
    const userPanel = user.panelOf(userCommit.panelInstanceKey)
    expect(userPanel).toMatchObject({ open: true, mode: 'embedded', windowInstanceId: 'main' })
    expect(user.windowRegistry.detachedHostCount()).toBe(0)

    // 同一注册、同一 lastValidDock 下的两张对照：错误 = 链（docked-bottom），用户 = lastValidDock（embedded）
    expect(failedPanel?.mode).toBe('docked-bottom')
    expect(userPanel?.mode).toBe('embedded')
    expect(failedPanel?.mode).not.toBe(userPanel?.mode)
  })
})

describe('P1-06j 端到端：已提交独立窗「原生关闭」只收敛一次、按用户意图回停靠', () => {
  /**
   * P1-07R 真机 3/3 复现路径（不启动 Electron）：真 compose + 真 P1-04 宿主 + 真 store/handlers，
   * 只有窗口工厂与定时器是注入 fake；`wireWindowDestroyed` 复现真机顺序「宿主 destroy ⇒ 工厂 closed ⇒
   * mainHostBridge.windowDestroyed」。修复前：最终态被第二条失败链事务改写成 docked-right、并入一条
   * `window-crashed` fallback；修复后：恰一条用户意图回停靠（lastValidDock）、零失败回退事件。
   */
  const fallbackEvents = (harness: Harness) => harness.sent.filter((entry) => entry.event.type === 'fallback')

  it('watchlist 形态（先停 docked-bottom 再分离提交）：最终 mode=lastValidDock、无 fallback、零孤儿', async () => {
    const harness = createHarness({ wireWindowDestroyed: true })
    const keys = await harness.openInspector()
    // 用户先把面板停在 docked-bottom（与安全链链首 docked-right 明确区分）
    const moved = await harness.composition.handlers.command(harness.event(MAIN_WEBCONTENTS), {
      method: 'switchContainer', requestId: 'req-bottom', expectedRevision: harness.revision(),
      panelInstanceKey: keys.panelInstanceKey, mode: 'docked-bottom'
    })
    expect(moved.status).toBe('applied')
    expect(harness.panelOf(keys.panelInstanceKey)).toMatchObject({ mode: 'docked-bottom', lastValidDock: 'docked-bottom' })
    const revisionBeforeClose = harness.revision()

    // 分离并走完整 ACK 链提交
    const detached = await harness.detach(keys.panelInstanceKey)
    expect(detached.status).toBe('applied')
    const view = await harness.contextOf(harness.targetEvent())
    if (view.pendingTransfer?.status !== 'in-flight') throw new Error('no controlled view')
    const operationId = view.pendingTransfer.operationId
    await harness.composition.handlers.hostLifecycle(harness.targetEvent(), { operationId, phase: 'target-ready' })
    await harness.composition.handlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), { operationId, phase: 'source-released' })
    const target = harness.windowRegistry.listDetachedHosts()[0]
    if (!target) throw new Error('no detached host')
    expect(harness.panelOf(keys.panelInstanceKey)).toMatchObject({ mode: 'detached', lastValidDock: 'docked-bottom' })
    const revisionBeforeRedock = harness.revision()

    // 渲染器 window.close() ⇒ 工厂 close（preventDefault）⇒ 宿主 destroy ⇒ 工厂 closed ⇒ windowDestroyed
    await expect(harness.composition.mainHostBridge?.nativeClose({
      windowInstanceId: target.windowInstanceId, hostEpoch: target.hostEpoch
    })).resolves.toBe(true)

    const panel = harness.panelOf(keys.panelInstanceKey)
    // 断言 1：最终态按用户意图 lastValidDock（docked-bottom），绝不被失败链首 docked-right 覆盖
    expect(panel).toMatchObject({ open: true, mode: 'docked-bottom', windowInstanceId: 'main', hostEpoch: 1 })
    expect(panel?.lastValidDock).toBe('docked-bottom')
    expect(panel?.transfer).toBeUndefined()
    // 断言 2：恰一条 redock 事务（begin + commit 两次 revision），第二条失败事务不得存在
    expect(harness.revision() - revisionBeforeRedock).toBe(2)
    expect(revisionBeforeClose).toBeLessThan(revisionBeforeRedock)
    // 断言 3：健康回停靠没有失败语义，也没有与最终状态矛盾的事件
    expect(fallbackEvents(harness)).toEqual([])
    expect(harness.composition.transferOrchestrator?.pendingCount()).toBe(0)
    // 断言 4：零孤儿 + 预算不泄漏 + 宿主 owner 收敛
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.windowRegistry.describeWindow(target.windowInstanceId)).toBeUndefined()
    expect(harness.host.committedOwners()).toEqual([])
    expect(harness.host.pendingOperationIds()).toEqual([])
    expect(harness.pendingTimerDelays()).toEqual([])
    // 报错原因词表：用户主动关闭绝不被写成 window-crashed / window-load-failed
    const reasons = harness.sent
      .map((entry) => (entry.event as { fallbackReason?: string }).fallbackReason)
      .filter((reason): reason is string => reason !== undefined)
    expect(reasons).not.toContain('window-crashed')
    expect(reasons).not.toContain('window-load-failed')
    // 用户意图事件确实按面板定向投递给仍存活的主窗
    expect(harness.sent.some((entry) => entry.webContentsId === MAIN_WEBCONTENTS
      && entry.event.type === 'container-change-requested'
      && (entry.event as { fallbackMode?: string }).fallbackMode === 'docked-bottom')).toBe(true)
  })

  it('对照（同一接线 + 仅 windowDestroyed，无原生关闭）⇒ 仍 window-crashed + 链首 docked-right，恰一条 fallback', async () => {
    const harness = createHarness({ wireWindowDestroyed: true })
    const keys = await harness.openInspector()
    await harness.composition.handlers.command(harness.event(MAIN_WEBCONTENTS), {
      method: 'switchContainer', requestId: 'req-bottom', expectedRevision: harness.revision(),
      panelInstanceKey: keys.panelInstanceKey, mode: 'docked-bottom'
    })
    const detached = await harness.detach(keys.panelInstanceKey)
    expect(detached.status).toBe('applied')
    const view = await harness.contextOf(harness.targetEvent())
    if (view.pendingTransfer?.status !== 'in-flight') throw new Error('no controlled view')
    const operationId = view.pendingTransfer.operationId
    await harness.composition.handlers.hostLifecycle(harness.targetEvent(), { operationId, phase: 'target-ready' })
    await harness.composition.handlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), { operationId, phase: 'source-released' })
    const target = harness.windowRegistry.listDetachedHosts()[0]
    if (!target) throw new Error('no detached host')

    // 外部销毁（崩溃）只有 closed：没有原生关闭意图 ⇒ 必须走失败安全链（链首 docked-right ≠ lastValidDock docked-bottom）
    const revisionBefore = harness.revision()
    harness.handles[0]!.destroyed = true
    await harness.composition.mainHostBridge?.windowDestroyed({ windowInstanceId: target.windowInstanceId })

    const panel = harness.panelOf(keys.panelInstanceKey)
    expect(panel).toMatchObject({ open: true, mode: 'docked-right', windowInstanceId: 'main', hostEpoch: 1 })
    expect(panel?.lastValidDock).toBe('docked-right')
    expect(harness.revision() - revisionBefore).toBe(2)
    const fallbacks = fallbackEvents(harness)
    expect(fallbacks).toHaveLength(1)
    expect(fallbacks[0]?.event).toMatchObject({ fallbackReason: 'window-crashed', fallbackMode: 'docked-right' })
    expect(fallbacks[0]?.webContentsId).toBe(MAIN_WEBCONTENTS)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
  })
})

describe('P1-06l 端到端：加载期崩溃词表与已提交窗崩溃的主动收敛', () => {
  const fallbackEvents = (harness: Harness) => harness.sent.filter((entry) => entry.event.type === 'fallback')
  const fallbackReasons = (harness: Harness) =>
    fallbackEvents(harness).map((entry) => (entry.event as { fallbackReason?: string }).fallbackReason)

  /** 走完整 ACK 链把面板提交到独立窗（source-prepared 由 Main 代确认），返回目标窗口身份。 */
  async function commitDetach(harness: Harness) {
    const keys = await harness.openInspector()
    const detached = await harness.detach(keys.panelInstanceKey)
    expect(detached.status).toBe('applied')
    const view = await harness.contextOf(harness.targetEvent())
    if (view.pendingTransfer?.status !== 'in-flight') throw new Error('no controlled view')
    const operationId = view.pendingTransfer.operationId
    await harness.composition.handlers.hostLifecycle(harness.targetEvent(), { operationId, phase: 'target-ready' })
    await harness.composition.handlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), { operationId, phase: 'source-released' })
    const target = harness.windowRegistry.listDetachedHosts()[0]
    if (!target) throw new Error('no detached host')
    expect(harness.panelOf(keys.panelInstanceKey)?.mode).toBe('detached')
    return { ...keys, operationId, target }
  }

  it('① 加载期渲染器崩溃（loadURL 拒绝 + 崩溃晚一轮到达）⇒ window-crashed、回滚到原承载者、零孤儿', async () => {
    const harness = createHarness({ crashOnLoad: true })
    const keys = await harness.openInspector()
    const revisionBefore = harness.revision()

    // 修复前：loadURL 拒绝与崩溃信号不在同一 tick ⇒ 词表被写成 window-load-failed（真机 7D/7E/7F 3/3）
    const outcome = await harness.detach(keys.panelInstanceKey)
    expect(outcome.status).toBe('rejected')

    expect(fallbackReasons(harness)).toEqual(['window-crashed'])
    expect(fallbackEvents(harness)[0]?.webContentsId).toBe(MAIN_WEBCONTENTS)
    expect(fallbackEvents(harness)[0]?.event).toMatchObject({ fallbackReason: 'window-crashed', fallbackMode: 'docked-right' })
    // 回滚：面板从未离开原承载者，无飞事务、无独立窗、无残留截止时间
    expect(harness.panelOf(keys.panelInstanceKey)).toMatchObject({
      open: true, mode: 'embedded', windowInstanceId: 'main', hostEpoch: 1
    })
    expect(harness.panelOf(keys.panelInstanceKey)?.transfer).toBeUndefined()
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.pendingOperationIds()).toEqual([])
    expect(harness.composition.transferOrchestrator?.pendingCount()).toBe(0)
    expect(harness.pendingTimerDelays()).toEqual([])
    expect(harness.handles[0]?.destroyed).toBe(true)
    // 词表正确的加载失败仍然是 window-load-failed：这里只证明崩溃态被先确认，不放宽其它词
    expect(harness.revision()).toBeGreaterThanOrEqual(revisionBefore)
  })

  it('①b 准备期（awaiting-ready）崩溃信号 ⇒ window-crashed、store 飞事务被中止、零孤儿、无残留定时器', async () => {
    const harness = createHarness({ wireWindowDestroyed: true })
    const keys = await harness.openInspector()
    const detached = await harness.detach(keys.panelInstanceKey)
    expect(detached.status).toBe('applied')
    expect(harness.panelOf(keys.panelInstanceKey)?.transfer).toBeDefined()

    harness.crashRenderer()
    await harness.settle()

    expect(fallbackReasons(harness)).toEqual(['window-crashed'])
    expect(fallbackEvents(harness)[0]?.webContentsId).toBe(MAIN_WEBCONTENTS)
    expect(harness.panelOf(keys.panelInstanceKey)).toMatchObject({
      open: true, mode: 'embedded', windowInstanceId: 'main', hostEpoch: 1
    })
    expect(harness.panelOf(keys.panelInstanceKey)?.transfer).toBeUndefined()
    expect(harness.handles[0]?.destroyed).toBe(true)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.pendingOperationIds()).toEqual([])
    expect(harness.composition.transferOrchestrator?.pendingCount()).toBe(0)
    expect(harness.pendingTimerDelays()).toEqual([])
  })

  it('② 已提交独立窗渲染器崩溃 ⇒ 主动回收 + 错误回退链回停靠 + 恰一条 window-crashed 投主窗、零孤儿、无残留定时器', async () => {
    const harness = createHarness({ wireWindowDestroyed: true })
    const committed = await commitDetach(harness)
    const revisionBefore = harness.revision()

    // 真机 67-a-p05-crash.json：窗口存活、渲染器已死、store 仍 mode:'detached'、无任何 fallback（僵尸窗）
    harness.crashRenderer()
    await harness.settle()

    // 收敛：面板按**错误回退链**（链首 docked-right，不是 lastValidDock）回停靠到主窗
    expect(harness.panelOf(committed.panelInstanceKey)).toMatchObject({
      open: true, mode: 'docked-right', windowInstanceId: 'main', hostEpoch: 1
    })
    expect(harness.panelOf(committed.panelInstanceKey)?.transfer).toBeUndefined()
    // 恰一条失败回退，且定向投递给仍存活的主窗（承载者已死，绝不能静默丢弃）
    expect(fallbackEvents(harness)).toHaveLength(1)
    expect(fallbackEvents(harness)[0]?.webContentsId).toBe(MAIN_WEBCONTENTS)
    expect(fallbackEvents(harness)[0]?.event).toMatchObject({ fallbackReason: 'window-crashed', fallbackMode: 'docked-right' })
    expect(harness.revision() - revisionBefore).toBe(2)
    // 零孤儿 + 无残留定时器/监听器
    expect(harness.handles[0]?.destroyed).toBe(true)
    expect(harness.handles[0]?.crashListeners.size).toBe(0)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.windowRegistry.describeWindow(committed.target.windowInstanceId)).toBeUndefined()
    expect(harness.host.committedOwners()).toEqual([])
    expect(harness.host.pendingOperationIds()).toEqual([])
    expect(harness.pendingTimerDelays()).toEqual([])
  })

  it('②b 受限注册（无 docked-right）下已提交窗崩溃 ⇒ 错误回退链给 docked-bottom（不是 lastValidDock embedded）', async () => {
    const harness = createHarness({ wireWindowDestroyed: true, panelSupportedModes: ['embedded', 'docked-bottom', 'detached'] })
    const committed = await commitDetach(harness)
    expect(harness.panelOf(committed.panelInstanceKey)?.lastValidDock).toBe('embedded')

    harness.crashRenderer()
    await harness.settle()

    const panel = harness.panelOf(committed.panelInstanceKey)
    expect(panel).toMatchObject({ open: true, mode: 'docked-bottom', windowInstanceId: 'main', hostEpoch: 1 })
    expect(panel?.lastValidDock).toBe('docked-bottom')
    expect(fallbackEvents(harness)).toHaveLength(1)
    expect(fallbackEvents(harness)[0]?.event).toMatchObject({ fallbackReason: 'window-crashed', fallbackMode: 'docked-bottom' })
    expect(fallbackEvents(harness)[0]?.webContentsId).toBe(MAIN_WEBCONTENTS)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.pendingTimerDelays()).toEqual([])
  })

  it('③ 原生关闭（P1-06j 场景）仍恰一条 redock、零 fallback；崩溃监测不得事后补一刀', async () => {
    const harness = createHarness({ wireWindowDestroyed: true })
    const committed = await commitDetach(harness)
    const revisionBefore = harness.revision()

    await expect(harness.composition.mainHostBridge?.nativeClose({
      windowInstanceId: committed.target.windowInstanceId, hostEpoch: committed.target.hostEpoch
    })).resolves.toBe(true)
    await harness.settle()

    expect(harness.panelOf(committed.panelInstanceKey)).toMatchObject({
      open: true, mode: 'embedded', windowInstanceId: 'main', hostEpoch: 1
    })
    expect(harness.revision() - revisionBefore).toBe(2)
    expect(fallbackEvents(harness)).toEqual([])
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.committedOwners()).toEqual([])
    expect(harness.handles[0]?.crashListeners.size).toBe(0)
    expect(harness.pendingTimerDelays()).toEqual([])

    // 窗口已收敛：迟到的崩溃信号（真实崩溃通知可能晚于用户关闭到达）不得再开第二条收敛路径
    const revisionAfterClose = harness.revision()
    harness.crashRenderer()
    await harness.settle()
    expect(fallbackEvents(harness)).toEqual([])
    expect(harness.revision()).toBe(revisionAfterClose)
    expect(harness.panelOf(committed.panelInstanceKey)).toMatchObject({ mode: 'embedded', windowInstanceId: 'main' })
  })

  it('④ 只有外部销毁（无原生关闭意图、无崩溃订阅信号）⇒ 仍恰一条 window-crashed 失败回退投主窗', async () => {
    const harness = createHarness({ wireWindowDestroyed: true })
    const committed = await commitDetach(harness)
    const revisionBefore = harness.revision()

    harness.handles[0]!.destroyed = true
    await harness.composition.mainHostBridge?.windowDestroyed({ windowInstanceId: committed.target.windowInstanceId })
    await harness.settle()

    expect(harness.panelOf(committed.panelInstanceKey)).toMatchObject({
      open: true, mode: 'docked-right', windowInstanceId: 'main', hostEpoch: 1
    })
    expect(harness.revision() - revisionBefore).toBe(2)
    expect(fallbackEvents(harness)).toHaveLength(1)
    expect(fallbackEvents(harness)[0]?.webContentsId).toBe(MAIN_WEBCONTENTS)
    expect(fallbackEvents(harness)[0]?.event).toMatchObject({ fallbackReason: 'window-crashed', fallbackMode: 'docked-right' })
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.host.committedOwners()).toEqual([])
    expect(harness.pendingTimerDelays()).toEqual([])
  })
})

describe('P2-01 端到端：applied 布局命令的受控增量事件', () => {
  /**
   * P1-07S 遗留：`workspaceEventRouter.publish` 全仓没有生产调用点 ⇒ 普通容器命令不产生增量事件，
   * 其它窗口只能重取快照。本组用例证明 composer 现在按既有授权/作用域规则发布受控增量事件：
   * layoutRevision 来自真实 store、scope 定向到受影响的面板/工作区、一次命令不产生同类事件风暴。
   *
   * 授权边界保持不变（技术设计 §4）：detached 面板的 `activatePanel` 仍只有其承载宿主能发；
   * 主窗对同一实例的合法命令是「重复 open ⇒ 聚焦既有独立实例」（主窗持有布局管理权）。
   */
  const eventsTo = (harness: Harness, webContentsId: number) =>
    harness.sent.filter((entry) => entry.webContentsId === webContentsId)

  /** 走完整 ACK 链把已打开面板分离提交到独立窗，返回提交后的目标窗口登记记录。 */
  async function detachToWindow(harness: Harness, panelInstanceKey: string, requestId: string) {
    const detached = await harness.detach(panelInstanceKey, requestId)
    expect(detached.status).toBe('applied')
    const target = harness.targetEvent()
    const view = await harness.contextOf(target)
    if (view.pendingTransfer?.status !== 'in-flight') throw new Error('no controlled view')
    const operationId = view.pendingTransfer.operationId
    await harness.composition.handlers.hostLifecycle(target, { operationId, phase: 'target-ready' })
    await harness.composition.handlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), { operationId, phase: 'source-released' })
    const record = harness.windowRegistry.listDetachedHosts().find((entry) => entry.panelInstanceKey === panelInstanceKey)
    if (!record || record.webContentsId === null) throw new Error('no detached host')
    return record
  }

  it('面板 A 的独立窗收到增量事件、无关面板窗为 0 条，且 revision 来自真实 store', async () => {
    const harness = createHarness()
    const first = await harness.openInspector()
    // 第二个工作区 + 同一面板注册的第二个实例（能力声明允许多实例）
    const secondWorkspace = await harness.composition.handlers.command(harness.event(MAIN_WEBCONTENTS), {
      method: 'openWorkspace', requestId: 'req-w2', expectedRevision: harness.revision(), pageId: PAGE_ID
    })
    const secondPanel = await harness.composition.handlers.command(harness.event(MAIN_WEBCONTENTS), {
      method: 'openPanel', requestId: 'req-panel-b', expectedRevision: harness.revision(),
      workspaceInstanceKey: secondWorkspace.workspaceInstanceKey as string, panelId: PANEL_ID, newInstance: true
    })
    expect(secondPanel.status).toBe('applied')
    expect(secondPanel.panelInstanceKey).not.toBe(first.panelInstanceKey)

    const recordA = await detachToWindow(harness, first.panelInstanceKey, 'req-detach-a')
    const recordB = await detachToWindow(harness, secondPanel.panelInstanceKey as string, 'req-detach-b')

    // 三个宿主都按既有订阅入口登记（主窗走生产 attach，独立宿主用 router.subscribe）
    harness.composition.attachMainWindow({ webContentsId: MAIN_WEBCONTENTS })
    expect(harness.composition.router.subscribe({ windowInstanceId: recordA.windowInstanceId, hostEpoch: recordA.hostEpoch })).toBe(true)
    expect(harness.composition.router.subscribe({ windowInstanceId: recordB.windowInstanceId, hostEpoch: recordB.hostEpoch })).toBe(true)
    harness.sent.length = 0

    // 主窗的合法布局管理动作：重复 open ⇒ 聚焦面板 A 既有的独立实例
    const focused = await harness.composition.handlers.command(harness.event(MAIN_WEBCONTENTS), {
      method: 'openPanel', requestId: 'req-focus-a', expectedRevision: harness.revision(),
      workspaceInstanceKey: first.workspaceInstanceKey, panelId: PANEL_ID
    })
    expect(focused.status).toBe('applied')
    expect(focused.panelInstanceKey).toBe(first.panelInstanceKey)

    const revision = harness.revision()
    const toA = eventsTo(harness, recordA.webContentsId as number)
    const toB = eventsTo(harness, recordB.webContentsId as number)
    expect(toA).toHaveLength(1)
    expect(toA[0]?.event).toMatchObject({
      type: 'open',
      layoutRevision: revision,
      scope: { workspaceInstanceKey: first.workspaceInstanceKey, panelInstanceKey: first.panelInstanceKey }
    })
    // revision 逐字来自真实 runtime store（不是自造值）
    expect(toA[0]?.event.layoutRevision).toBe(harness.composition.runtimeStore.getSnapshot().layoutRevision)
    expect(toA[0]?.event.layoutRevision).toBe(focused.snapshot.layoutRevision)
    // 无关面板窗（另一个工作区）收到 0 条
    expect(toB).toEqual([])

    // 授权未被放宽：主窗不是 detached 面板的承载者，activatePanel 仍被拒绝且不发布任何事件
    harness.sent.length = 0
    const denied = await harness.composition.handlers.command(harness.event(MAIN_WEBCONTENTS), {
      method: 'activatePanel', requestId: 'req-activate-a', expectedRevision: harness.revision(),
      panelInstanceKey: first.panelInstanceKey
    })
    expect(denied.status).toBe('rejected')
    expect(denied.errorCode).toBe('not-owner')
    expect(harness.sent).toEqual([])

    // 承载宿主自己的 activatePanel 生效，并只投递给该面板的独立窗
    const activated = await harness.composition.handlers.command(harness.event(recordA.webContentsId as number), {
      method: 'activatePanel', requestId: 'req-activate-a-own', expectedRevision: harness.revision(),
      panelInstanceKey: first.panelInstanceKey
    })
    expect(activated.status).toBe('applied')
    expect(eventsTo(harness, recordA.webContentsId as number)).toHaveLength(1)
    expect(eventsTo(harness, recordB.webContentsId as number)).toEqual([])
  })

  it('一次命令的同类增量事件合并为一条，单面板变化按面板定向', async () => {
    const harness = createHarness()
    const keys = await harness.openInspector()
    harness.composition.attachMainWindow({ webContentsId: MAIN_WEBCONTENTS })
    const second = await harness.composition.handlers.command(harness.event(MAIN_WEBCONTENTS), {
      method: 'openPanel', requestId: 'req-panel-2', expectedRevision: harness.revision(),
      workspaceInstanceKey: keys.workspaceInstanceKey, panelId: PANEL_ID, newInstance: true
    })
    expect(second.status).toBe('applied')
    harness.sent.length = 0

    // 切容器同时改变目标面板与同区域内 active 归属（两个面板受影响）⇒ 合并成一条工作区级事件
    const switched = await harness.composition.handlers.command(harness.event(MAIN_WEBCONTENTS), {
      method: 'switchContainer', requestId: 'req-switch', expectedRevision: harness.revision(),
      panelInstanceKey: second.panelInstanceKey as string, mode: 'docked-right'
    })
    expect(switched.status).toBe('applied')
    const merged = eventsTo(harness, MAIN_WEBCONTENTS)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.event).toMatchObject({
      type: 'container-changed', layoutRevision: harness.revision(),
      scope: { workspaceInstanceKey: keys.workspaceInstanceKey }
    })
    expect(merged[0]?.event.scope).not.toHaveProperty('panelInstanceKey')

    // 只有目标面板真的变化 ⇒ 面板定向事件（恰一条）
    harness.sent.length = 0
    const closed = await harness.composition.handlers.command(harness.event(MAIN_WEBCONTENTS), {
      method: 'closePanel', requestId: 'req-close-2', expectedRevision: harness.revision(),
      panelInstanceKey: second.panelInstanceKey as string
    })
    expect(closed.status).toBe('applied')
    const scoped = eventsTo(harness, MAIN_WEBCONTENTS)
    expect(scoped).toHaveLength(1)
    expect(scoped[0]?.event).toMatchObject({
      type: 'close',
      layoutRevision: harness.revision(),
      scope: { workspaceInstanceKey: keys.workspaceInstanceKey, panelInstanceKey: second.panelInstanceKey }
    })

    // 未被命令触及的工作区不产生任何事件
    expect(eventsTo(harness, MAIN_WEBCONTENTS).filter((entry) => entry.event.scope.workspaceInstanceKey !== keys.workspaceInstanceKey)).toEqual([])
  })
})
