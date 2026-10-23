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
import { WorkspaceOwnershipPolicy } from '@platform/workspace/policies'
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
 * Owner: platform/desktop/main/workspace（**PLAT-28** focused）。回归：本文件。
 *
 * 但**面板窗**（`kind:'detached-panel'`）显式排除：它既不订阅受控事件，也只在角色解析那一次读
 * `context.preferences`，于是主窗切语言/主题后已打开的面板窗恒为旧值（P2-04 集成项、plan 记「面板窗主题需重载」）。
 *
 * 本文件的判据（Main 侧那一半，不启动 Electron；真 compose + 真 P1-04 宿主 + 真 store/handlers）：
 *  ① 主窗切**语言** ⇒ 已提交面板窗恰 1 条**既有** `snapshot` 定向通知（面板级 scope）。PLAT-32/S1 之后
 *     对账点是**显式通知** `notifyPreferencesChanged()`（真机由 `app.ts` 的 settingsUpdate 调用一行），
 *     面板窗随后自己重取受控 `getHostContext` 就拿到新语言；**主窗 0 条**（同一份归属判定，绝不放宽 epoch）；
 *  ② 主窗切**主题** ⇒ 同一条通知链（主题与语言同源同一次对账，绝不两条事件）；
 *  ③ **有界**：一次切换恰 1 条；面板窗/主窗随后任意次重取/重复通知 0 增量；两次切换恰 2 条
 *     （绝不按读取/通知次数放大）；**无关面板窗 0 条**（另一个工作区的独立面板窗绝不代收）；
 *  ④ **面板链相位不受影响**：事务进行中插入偏好切换 ⇒ 面板链相位序列逐字不变、提交走到位、ACK 仍恰一次
 *     （同相位重复 ACK 被拒）、无额外快照风暴；回停靠仍可用；
 *  ⑤ 面板窗与页窗**同时存在**：两者都跟随、各自恰 1 条、互不干扰（页窗仍走 PLAT-10 的工作区级 scope）。
 *
 * 真机口径（本包不跑 Electron）：跨进程的可见文案/根属性跟随由 renderer focused 用例
 * （`workspacePanelWindowPreferenceFollow.test.tsx`）取证；本文件只固定 Main 的受众、投递语义与有界性。
 */

const PRELOAD = '/app/preload/index.js'
const APP_ROOT = 'file:///app/renderer'
const ENTRY = 'file:///app/renderer/index.html'
const PAGE_ID = 'sample.overview'
const PANEL_ID = 'sample.inspector'
const MAIN_WEBCONTENTS = 1
const TARGET_WEBCONTENTS_BASE = 100
/** 页窗（`detached-tab`）在本文件只消费受控归属链，因此用一个不与宿主窗冲突的 webContents。 */
const PAGE_WEBCONTENTS = 900
const PAGE_WINDOW_INSTANCE_ID = 'window-page-1'
const PAGE_HOST_EPOCH = 2

const composeManifest = {
  id: 'sample', name: 'Sample', version: '1.0.0',
  shellContributions: {
    menuPages: [{
      id: 'overview', title: { 'zh-CN': '总览', 'en-US': 'Overview' }, icon: 'home', order: 1,
      module: './desktop/pages/overview'
    }],
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
})

type FakeWindow = DetachedWindowHandle & { destroyed: boolean }
type Timer = { delayMs: number; run: () => void; cancelled: boolean }
type SentEvent = { webContentsId: number; event: WorkspaceEvent }

async function createHarness() {
  const root = mkdtempSync(join(tmpdir(), 'plat-28-panel-preference-'))
  roots.push(root)
  let sequence = 0
  let language = 'en-US'
  let theme = 'light'
  const handles: FakeWindow[] = []
  const timers: Timer[] = []
  const sent: SentEvent[] = []
  const windowRegistry: WorkspaceWindowRegistry = createWorkspaceWindowRegistry({
    createOpaqueId: (prefix) => `${prefix}-${++sequence}`
  })
  let workspaceRef: { publishHostEvent: (event: DetachedHostEvent) => boolean } | null = null

  const createWindow: DetachedWindowFactory = () => {
    const handle: FakeWindow = {
      webContentsId: TARGET_WEBCONTENTS_BASE + handles.length, destroyed: false,
      loadURL: () => Promise.resolve(),
      isDestroyed: () => handle.destroyed,
      isCrashed: () => false,
      destroy: () => { handle.destroyed = true },
      focus: () => undefined,
      setWindowOpenHandler: () => undefined
    }
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
    timers: timerPort(),
    targetReadyTimeoutMs: 5_000,
    releaseTimeoutMs: 1_000,
    onEvent: (event) => { workspaceRef?.publishHostEvent(event) }
  })
  const composition = composePanelWorkspace({
    productManifests: [composeManifest],
    ipcMain: { handle: () => undefined },
    layoutFilePath: join(root, 'workspace', 'panel-layout.json'),
    sendToHost: (webContentsId, event) => { sent.push({ webContentsId, event }); return true },
    preferences: { getLanguage: async () => language, getTheme: async () => theme , getTimeZone: async () => 'UTC'},
    windowRegistry,
    detachedHost: host,
    transferTimers: timerPort()
  })
  if (composition.status !== 'ready') throw new Error(`composition disabled: ${composition.reason}`)
  workspaceRef = { publishHostEvent: composition.publishHostEvent }

  const event = (webContentsId: number) => ({
    senderFrame: { parent: null }, sender: { id: webContentsId, isDestroyed: () => false }
  })
  const revision = () => composition.runtimeStore.getSnapshot().layoutRevision
  const panelOf = (panelInstanceKey: string) =>
    composition.runtimeStore.getSnapshot().panels.find((panel) => panel.panelInstanceKey === panelInstanceKey)
  const pendingTimerDelays = () => [...new Set(timers.filter((timer) => !timer.cancelled).map((timer) => timer.delayMs))]
  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
  }

  /** 真机 boot：start → 主窗登记（早于 renderer 加载）→ 受控挂载。 */
  await composition.start()
  composition.registerMainWindow({ webContentsId: MAIN_WEBCONTENTS })
  if (!composition.attachMainWindow({ webContentsId: MAIN_WEBCONTENTS }).attached) {
    throw new Error('main window not attached')
  }

  const contextOf = async (webContentsId: number) => {
    const outcome = await composition.handlers.getHostContext(event(webContentsId))
    await settle()
    return outcome
  }
  const readContext = async (webContentsId: number) => {
    const outcome = await contextOf(webContentsId)
    if (outcome.status !== 'ok') throw new Error(`context rejected for ${webContentsId}`)
    return outcome.context
  }
  /**
   * 真机窗口 boot 顺序（`WorkspaceWindowRoot` 的角色解析）：先受控 `getHostContext`，再受控 `getSnapshot`。
   * 后者是面板宿主窗在既有链路里的**受控挂载点**（`.tabs.getSnapshot` 对页窗是同一姿态）。
   */
  const bootWindow = async (webContentsId: number) => {
    const outcome = await contextOf(webContentsId)
    if (outcome.status !== 'ok') throw new Error(`context rejected for ${webContentsId}`)
    await composition.handlers.getSnapshot(event(webContentsId))
    await settle()
    return outcome
  }
  const command = (webContentsId: number, payload: Record<string, unknown>) =>
    composition.handlers.command(event(webContentsId), payload)

  /** 真命令打开工作区 + 面板（不伪造 store 状态）。 */
  const openPanel = async (
    requestId: string, workspaceInstanceKey?: string, newInstance = false
  ): Promise<{ panelInstanceKey: string; workspaceInstanceKey: string }> => {
    const workspace = workspaceInstanceKey === undefined
      ? (await command(MAIN_WEBCONTENTS, {
          method: 'openWorkspace', requestId: `${requestId}-ws`, expectedRevision: revision(), pageId: PAGE_ID
        })).workspaceInstanceKey as string
      : workspaceInstanceKey
    const panel = await command(MAIN_WEBCONTENTS, {
      method: 'openPanel', requestId, expectedRevision: revision(),
      workspaceInstanceKey: workspace, panelId: PANEL_ID, newInstance
    })
    if (panel.status !== 'applied' || panel.panelInstanceKey === undefined) {
      throw new Error(`openPanel failed: ${JSON.stringify(panel)}`)
    }
    return { panelInstanceKey: panel.panelInstanceKey, workspaceInstanceKey: workspace }
  }

  /** 打开一个一级菜单页 Tab（真 `.tabs.openTab`；PLAT-10 的页窗受众由此工作区解析）。 */
  const openTab = async (): Promise<string> => {
    const result = await composition.tabStore.openTab({
      requestId: 'req-open-tab',
      expectedRevision: composition.tabStore.getSnapshot().layoutRevision,
      hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch,
      pageId: PAGE_ID
    })
    if (result.status !== 'applied' || result.workspaceInstanceKey === undefined) {
      throw new Error(`openTab failed: ${JSON.stringify(result)}`)
    }
    return result.workspaceInstanceKey
  }

  /** 采纳一条页窗身份并受控挂载（与 PLAT-10 逐字同一套受控归属链）。 */
  const openPageWindow = async (workspaceInstanceKey: string): Promise<void> => {
    const reserved = windowRegistry.reserveDetachedTabWindow({
      windowInstanceId: PAGE_WINDOW_INSTANCE_ID, hostEpoch: PAGE_HOST_EPOCH, workspaceInstanceKey
    })
    if (reserved.status !== 'reserved') throw new Error(`page reserve failed: ${reserved.errorCode}`)
    const attached = windowRegistry.attachWebContents({
      windowInstanceId: PAGE_WINDOW_INSTANCE_ID, webContentsId: PAGE_WEBCONTENTS
    })
    if (attached.status !== 'attached') throw new Error(`page attach failed: ${attached.errorCode}`)
    if (!composition.attachHostWindow({ webContentsId: PAGE_WEBCONTENTS }).subscribed) {
      throw new Error('page window not subscribed')
    }
    await readContext(PAGE_WEBCONTENTS)
  }

  const detachedHostRecord = (panelInstanceKey: string) =>
    windowRegistry.listDetachedHosts().find((record) => record.panelInstanceKey === panelInstanceKey)

  /** 走完整 ACK 链把面板分离提交到独立窗（真 P1-04 宿主建窗；本文件只驱动受控 ACK）。 */
  const detachToCommit = async (panelInstanceKey: string, requestId: string) => {
    const detached = await command(MAIN_WEBCONTENTS, {
      method: 'detachPanel', requestId, expectedRevision: revision(), panelInstanceKey
    })
    if (detached.status !== 'applied') throw new Error(`detach failed: ${JSON.stringify(detached)}`)
    const record = detachedHostRecord(panelInstanceKey)
    if (!record || record.webContentsId === null) throw new Error('no detached host')
    const view = (await bootWindow(record.webContentsId)).context
    if (view.pendingTransfer?.status !== 'in-flight') throw new Error('no controlled pending-transfer view')
    const operationId = view.pendingTransfer.operationId
    await composition.handlers.hostLifecycle(event(MAIN_WEBCONTENTS), { operationId, phase: 'source-prepared', accepted: true })
    await composition.handlers.hostLifecycle(event(record.webContentsId), { operationId, phase: 'target-ready' })
    await composition.handlers.hostLifecycle(event(MAIN_WEBCONTENTS), { operationId, phase: 'source-released' })
    await settle()
    return { record, operationId, targetWebContents: record.webContentsId }
  }

  return {
    composition, handles, windowRegistry, sent, event, revision, panelOf, pendingTimerDelays, settle,
    contextOf, readContext, bootWindow, command, openPanel, openTab, openPageWindow, detachToCommit, detachedHostRecord,
    setPreferences: (next: { language?: string; theme?: string }) => {
      if (next.language !== undefined) language = next.language
      if (next.theme !== undefined) theme = next.theme
    },
    snapshotsTo: (webContentsId: number) => sent.filter((entry) => entry.webContentsId === webContentsId
      && entry.event.type === 'snapshot'),
    /** PLAT-32/S1：偏好的唯一对账入口（真机由 `app.ts` 的 settingsUpdate 成功路径调用一行）。 */
    notify: () => composition.notifyPreferencesChanged(),
    resetSent: () => { sent.length = 0 }
  }
}

type Harness = Awaited<ReturnType<typeof createHarness>>

/** 真机基线：主窗加载后先读一次受控上下文（角色解析）。S1 之后基线在注册通道时建立，读取本身只拿值。 */
async function boot(harness: Harness): Promise<void> {
  await harness.readContext(MAIN_WEBCONTENTS)
}

describe('PLAT-28 ①：主窗切语言 ⇒ 已打开面板窗跟随（复用既有 snapshot 词汇 + 一次受控重取）', () => {
  it('恰 1 条面板级定向通知投给该面板窗，其受控重读取到新语言；主窗 0 条', async () => {
    const harness = await createHarness()
    await boot(harness)
    const keys = await harness.openPanel('req-panel-lang')
    const { targetWebContents } = await harness.detachToCommit(keys.panelInstanceKey, 'req-detach-lang')
    harness.resetSent()

    harness.setPreferences({ language: 'zh-CN' })
    await harness.notify()

    const toPanel = harness.snapshotsTo(targetWebContents)
    expect(toPanel).toHaveLength(1)
    expect(toPanel[0]?.event.scope).toEqual({
      workspaceInstanceKey: keys.workspaceInstanceKey, panelInstanceKey: keys.panelInstanceKey
    })
    expect(toPanel[0]?.event.layoutRevision).toBe(harness.revision())
    // 同一份归属判定：主窗不是该面板的承载者，绝不代收（与 PLAT-10 页窗口径逐字一致）
    expect(harness.snapshotsTo(MAIN_WEBCONTENTS)).toEqual([])

    const after = await harness.readContext(targetWebContents)
    expect(after.preferences).toEqual({ language: 'zh-CN', theme: 'light', timeZone: 'UTC' })
    expect(after.role).toBe('panel')
    expect(after.windowInstanceId).toBe(harness.windowRegistry.listDetachedHosts()[0]?.windowInstanceId)
  })
})

describe('PLAT-28 ②：主窗切主题 ⇒ 面板窗根主题属性跟随（同一份受控上下文，绝不由事件承载值）', () => {
  it('切主题恰 1 条通知，受控重取的 theme 变成已解析 dark', async () => {
    const harness = await createHarness()
    await boot(harness)
    const keys = await harness.openPanel('req-panel-theme')
    const { targetWebContents } = await harness.detachToCommit(keys.panelInstanceKey, 'req-detach-theme')
    harness.resetSent()

    harness.setPreferences({ theme: 'dark' })
    await harness.notify()

    expect(harness.snapshotsTo(targetWebContents)).toHaveLength(1)
    expect(harness.snapshotsTo(MAIN_WEBCONTENTS)).toEqual([])
    const after = await harness.readContext(targetWebContents)
    expect(after.preferences).toEqual({ language: 'en-US', theme: 'dark', timeZone: 'UTC' })
  })
})

describe('PLAT-28 ③：一次切换的投递次数有上界，且无关窗 0 条', () => {
  it('一次切换恰 1 条；随后任意次重取 0 增量；两次切换恰 2 条', async () => {
    const harness = await createHarness()
    await boot(harness)
    const keys = await harness.openPanel('req-panel-bounded')
    const { targetWebContents } = await harness.detachToCommit(keys.panelInstanceKey, 'req-detach-bounded')
    harness.resetSent()

    harness.setPreferences({ language: 'zh-CN' })
    await harness.notify()
    expect(harness.snapshotsTo(targetWebContents)).toHaveLength(1)

    // 面板窗收到通知后的真实反应：重取一次受控上下文（并重取一次快照），绝不回声
    // S1：读取是纯读 ⇒ 主窗这次重取同样 0 投递
    await harness.readContext(targetWebContents)
    await harness.readContext(targetWebContents)
    await harness.readContext(MAIN_WEBCONTENTS)
    await harness.settle()
    expect(harness.snapshotsTo(targetWebContents)).toHaveLength(1)
    expect(harness.sent).toHaveLength(1)

    harness.setPreferences({ theme: 'dark' })
    await harness.notify()
    expect(harness.snapshotsTo(targetWebContents)).toHaveLength(2)

    // 同一份偏好再读 5 次、再通知 5 次：0 增量（有界性不随读取/通知次数增长）
    for (let turn = 0; turn < 5; turn += 1) await harness.readContext(MAIN_WEBCONTENTS)
    for (let turn = 0; turn < 5; turn += 1) await expect(harness.notify()).resolves.toBe(false)
    expect(harness.snapshotsTo(targetWebContents)).toHaveLength(2)
  })

  it('两个工作区的面板窗各自恰 1 条、作用域各归各的：受众逐窗定向，绝不工作区级广播', async () => {
    const harness = await createHarness()
    await boot(harness)
    const first = await harness.openPanel('req-panel-a')
    const secondWorkspace = (await harness.command(MAIN_WEBCONTENTS, {
      method: 'openWorkspace', requestId: 'req-ws-b', expectedRevision: harness.revision(), pageId: PAGE_ID
    })).workspaceInstanceKey as string
    const second = await harness.openPanel('req-panel-b', secondWorkspace, true)
    expect(second.panelInstanceKey).not.toBe(first.panelInstanceKey)

    const recordA = (await harness.detachToCommit(first.panelInstanceKey, 'req-detach-a')).record
    const recordB = (await harness.detachToCommit(second.panelInstanceKey, 'req-detach-b')).record
    harness.resetSent()

    harness.setPreferences({ language: 'zh-CN' })
    await harness.notify()

    // 偏好是 app 级的 ⇒ 两个面板窗**都**要跟随，但每个窗恰 1 条、且作用域逐窗定向（不是工作区级广播）
    const toA = harness.snapshotsTo(recordA.webContentsId as number)
    const toB = harness.snapshotsTo(recordB.webContentsId as number)
    expect(toA).toHaveLength(1)
    expect(toB).toHaveLength(1)
    expect(toA[0]?.event.scope).toEqual({
      workspaceInstanceKey: first.workspaceInstanceKey, panelInstanceKey: first.panelInstanceKey
    })
    expect(toB[0]?.event.scope).toEqual({
      workspaceInstanceKey: second.workspaceInstanceKey, panelInstanceKey: second.panelInstanceKey
    })
    // 主窗仍 0 条，且总投递数 = 受影响面板窗数（绝不放大）
    expect(harness.snapshotsTo(MAIN_WEBCONTENTS)).toEqual([])
    expect(harness.sent).toHaveLength(2)
  })
})

describe('PLAT-28 ④：面板链相位不受影响（提交走到位、ACK 恰一次、无快照风暴）', () => {
  it('事务中插入偏好切换 ⇒ 相位序列不变、提交到位、ACK 幂等，且不重开窗口', async () => {
    const harness = await createHarness()
    await boot(harness)
    const keys = await harness.openPanel('req-panel-phase')
    const phases: (string | null | undefined)[] = []

    const detached = await harness.command(MAIN_WEBCONTENTS, {
      method: 'detachPanel', requestId: 'req-detach-phase', expectedRevision: harness.revision(),
      panelInstanceKey: keys.panelInstanceKey
    })
    expect(detached.status).toBe('applied')
    const record = harness.detachedHostRecord(keys.panelInstanceKey)
    if (!record || record.webContentsId === null) throw new Error('no detached host')
    const targetWebContents = record.webContentsId
    const windowsAfterDetach = harness.handles.length
    phases.push(harness.panelOf(keys.panelInstanceKey)?.transfer?.phase)

    const view = (await harness.bootWindow(targetWebContents)).context
    if (view.pendingTransfer?.status !== 'in-flight') throw new Error('no controlled pending-transfer view')
    const operationId = view.pendingTransfer.operationId

    // 事务进行中：主窗切语言 ⇒ **PLAT-31** 按 registry 定向投递，准备期目标窗恰收 1 条面板级快照。
    // 理由：准备期目标窗是这份内容的**未来 owner**，偏好应在准备期即生效；主窗与无关窗绝不收。
    harness.resetSent()
    harness.setPreferences({ language: 'zh-CN' })
    await harness.notify()
    const toPendingTarget = harness.snapshotsTo(targetWebContents)
    expect(toPendingTarget).toHaveLength(1)
    expect(toPendingTarget[0]?.event.scope).toEqual({
      workspaceInstanceKey: keys.workspaceInstanceKey, panelInstanceKey: keys.panelInstanceKey
    })
    // 受众唯一且可证：主窗 0 条 + 总投递恰 1 条（只有 registry 指认的准备期目标窗）
    expect(harness.snapshotsTo(MAIN_WEBCONTENTS)).toEqual([])
    expect(harness.sent).toHaveLength(1)
    // 相位不被偏好通知推进（P1 语义逐字不变）
    expect(harness.panelOf(keys.panelInstanceKey)?.transfer?.phase).toBe('awaiting-source-prepared')

    await harness.composition.handlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), {
      operationId, phase: 'source-prepared', accepted: true
    })
    phases.push(harness.panelOf(keys.panelInstanceKey)?.transfer?.phase)

    await expect(harness.composition.handlers.hostLifecycle(harness.event(targetWebContents), {
      operationId, phase: 'target-ready'
    })).resolves.toEqual({ accepted: true })
    phases.push(harness.panelOf(keys.panelInstanceKey)?.transfer?.phase)

    // ACK 恰一次：同相位重复 ACK 被拒（绝不重复推进）
    await expect(harness.composition.handlers.hostLifecycle(harness.event(targetWebContents), {
      operationId, phase: 'target-ready'
    })).resolves.toMatchObject({ accepted: false })

    await expect(harness.composition.handlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), {
      operationId, phase: 'source-released'
    })).resolves.toMatchObject({ accepted: true, outcome: { status: 'committed' } })

    // 提交到位：mode/归属/事务清理逐字不变；零残留定时器；不重开窗口（窗口数不变）
    expect(harness.panelOf(keys.panelInstanceKey)).toMatchObject({
      mode: 'detached', windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch
    })
    expect(harness.panelOf(keys.panelInstanceKey)?.transfer).toBeUndefined()
    expect(phases).toEqual(['awaiting-source-prepared', 'awaiting-target-ready', 'awaiting-source-release'])
    expect(harness.handles.length).toBe(windowsAfterDetach)
    expect(harness.pendingTimerDelays()).toEqual([])

    // 提交后的再切换：恰 1 条（既有的直发快照都在事务之前，绝无额外风暴）
    harness.resetSent()
    harness.setPreferences({ theme: 'dark' })
    await harness.notify()
    expect(harness.snapshotsTo(targetWebContents)).toHaveLength(1)
    expect(harness.sent).toHaveLength(1)

    // 回停靠仍可用：原生 X ⇒ 回 lastValidDock（embedded），登记回收、零孤儿
    await expect(harness.composition.mainHostBridge?.nativeClose({
      windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch
    })).resolves.toBe(true)
    expect(harness.handles[0]?.destroyed).toBe(true)
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    expect(harness.panelOf(keys.panelInstanceKey)).toMatchObject({ open: true, mode: 'embedded' })
    expect(harness.pendingTimerDelays()).toEqual([])

    // 面板已回主窗 ⇒ 偏好切换不再有任何面板窗通知；主窗自身 0 条
    harness.resetSent()
    harness.setPreferences({ theme: 'dark' })
    await harness.notify()
    expect(harness.sent).toEqual([])
  })

  it('PLAT-31：事务中止后不再补投偏好快照（受众随 transfer 消失，主窗仍 0 条）', async () => {
    const harness = await createHarness()
    await boot(harness)
    const keys = await harness.openPanel('req-panel-abort')
    const detached = await harness.command(MAIN_WEBCONTENTS, {
      method: 'detachPanel', requestId: 'req-detach-abort', expectedRevision: harness.revision(),
      panelInstanceKey: keys.panelInstanceKey
    })
    expect(detached.status).toBe('applied')
    const record = harness.detachedHostRecord(keys.panelInstanceKey)
    if (!record || record.webContentsId === null) throw new Error('no detached host')
    const targetWebContents = record.webContentsId
    const view = (await harness.bootWindow(targetWebContents)).context
    if (view.pendingTransfer?.status !== 'in-flight') throw new Error('no controlled pending-transfer view')
    const operationId = view.pendingTransfer.operationId

    harness.resetSent()
    harness.setPreferences({ language: 'zh-CN' })
    await harness.notify()
    expect(harness.snapshotsTo(targetWebContents)).toHaveLength(1)

    // 中止：目标窗崩溃 ⇒ 回滚清掉飞事务（受众随之消失）
    await harness.composition.handlers.hostLifecycle(harness.event(targetWebContents), {
      operationId, phase: 'window-failure', kind: 'crash'
    })
    expect(harness.panelOf(keys.panelInstanceKey)?.transfer).toBeUndefined()

    // 中止后再切偏好：**绝不补投**（计数不再增长），主窗仍 0 条
    const before = harness.sent.length
    harness.setPreferences({ theme: 'dark' })
    await harness.notify()
    expect(harness.sent.length).toBe(before)
    expect(harness.snapshotsTo(MAIN_WEBCONTENTS)).toEqual([])
  })
})

describe('PLAT-28 ⑤：面板窗与页窗同时存在时两者都跟随且互不干扰', () => {
  it('一次切换 ⇒ 面板窗 1 条（面板级 scope）、页窗 1 条（PLAT-10 工作区级 scope），各自读到自己那份', async () => {
    const harness = await createHarness()
    await boot(harness)
    const keys = await harness.openPanel('req-panel-mixed')
    const { record: panelRecord, targetWebContents } = await harness.detachToCommit(keys.panelInstanceKey, 'req-detach-mixed')
    // 页窗属于 Tab runtime 自己的工作区（两级 store 的 workspace 键空间不同，绝不共用身份）
    const pageWorkspaceKey = await harness.openTab()
    await harness.openPageWindow(pageWorkspaceKey)
    harness.resetSent()

    harness.setPreferences({ language: 'zh-CN', theme: 'dark' })
    await harness.notify()

    const toPanel = harness.snapshotsTo(targetWebContents)
    const toPage = harness.snapshotsTo(PAGE_WEBCONTENTS)
    // PLAT-10 页窗路径不回退：工作区级 scope 仍恰 1 条
    expect(toPage).toHaveLength(1)
    expect(toPanel).toHaveLength(1)
    // 互不干扰：面板窗只拿面板级作用域，页窗只拿页窗那一条（同一工作区也不串投）
    expect(toPanel[0]?.event.scope).toEqual({
      workspaceInstanceKey: keys.workspaceInstanceKey, panelInstanceKey: keys.panelInstanceKey
    })
    expect(toPage[0]?.event.scope).toEqual({ workspaceInstanceKey: pageWorkspaceKey })
    expect(harness.snapshotsTo(MAIN_WEBCONTENTS)).toEqual([])

    // 两者都跟随：各自受控重取都拿到新偏好，身份各自不变
    const panelAfter = await harness.readContext(targetWebContents)
    const pageAfter = await harness.readContext(PAGE_WEBCONTENTS)
    expect(panelAfter.preferences).toEqual({ language: 'zh-CN', theme: 'dark', timeZone: 'UTC' })
    expect(pageAfter.preferences).toEqual({ language: 'zh-CN', theme: 'dark', timeZone: 'UTC' })
    expect(panelAfter.windowInstanceId).toBe(panelRecord.windowInstanceId)
    expect(pageAfter.windowInstanceId).toBe(PAGE_WINDOW_INSTANCE_ID)

    // 有界：随后任意次重取 0 增量
    await harness.readContext(targetWebContents)
    await harness.readContext(PAGE_WEBCONTENTS)
    await harness.readContext(MAIN_WEBCONTENTS)
    expect(harness.sent).toHaveLength(2)
  })
})

describe('PLAT-28 ⑥：订阅记账有界（销毁即归还额度，绝不静默降级、绝不无界增长）', () => {
  it('面板窗销毁/回停靠后 router target 归还，同一面板再次分离仍能订上并收到偏好通知', async () => {
    const harness = await createHarness()
    await boot(harness)
    const baseline = harness.composition.router.capacity().targetCount
    const keys = await harness.openPanel('req-panel-quota')
    const first = await harness.detachToCommit(keys.panelInstanceKey, 'req-detach-quota')
    // 已提交面板宿主窗确实订上了（否则「跟随」在真机上无从送达）
    expect(harness.composition.router.capacity().targets).toContain(first.record.windowInstanceId)

    await expect(harness.composition.mainHostBridge?.nativeClose({
      windowInstanceId: first.record.windowInstanceId, hostEpoch: first.record.hostEpoch
    })).resolves.toBe(true)
    await harness.settle()
    expect(harness.windowRegistry.detachedHostCount()).toBe(0)
    // PLAT-01/PLAT-10 的额度归还对面板宿主同样生效（既有回收通知链不按 kind 过滤）⇒ 绝不占满 maxTargets
    expect(harness.composition.router.capacity().targetCount).toBe(baseline)

    // 额度可复用：同一面板再次分离 ⇒ 新身份重新订上，且偏好通知照常送达
    const again = await harness.detachToCommit(keys.panelInstanceKey, 'req-detach-quota-2')
    expect(again.record.windowInstanceId).not.toBe(first.record.windowInstanceId)
    expect(harness.composition.router.capacity().targets).toContain(again.record.windowInstanceId)
    harness.resetSent()
    harness.setPreferences({ language: 'zh-CN' })
    await harness.notify()
    expect(harness.snapshotsTo(again.targetWebContents)).toHaveLength(1)
    expect(harness.snapshotsTo(MAIN_WEBCONTENTS)).toEqual([])
  })

  it('未登记/已销毁 webContents 的受控读一律被拒，绝不据此挂载（fail closed）', async () => {
    const harness = await createHarness()
    await boot(harness)
    const keys = await harness.openPanel('req-panel-unregistered')
    const { record } = await harness.detachToCommit(keys.panelInstanceKey, 'req-detach-unregistered')
    harness.windowRegistry.markDestroyed({ windowInstanceId: record.windowInstanceId })
    const rejected = await harness.contextOf(record.webContentsId as number)
    expect(rejected.status).toBe('rejected')
    expect(harness.composition.router.capacity().targets).not.toContain(record.windowInstanceId)
  })
})
