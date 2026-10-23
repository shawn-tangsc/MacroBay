import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IpcChannels } from '../../ipc/channels'
import type { ProductManifest } from '@platform/product-manifest'
import { createPanelLayoutStore } from '@platform/workspace/persistence/panelLayoutStore'
import type { DockMode, PanelLayoutDocumentV1 } from '@platform/workspace/persistence/panelLayoutDocument'
import { createPanelRegistry } from '@platform/workspace/registry/panelRegistry'
import { createPanelWorkspaceStore } from '@platform/workspace/runtime/panelWorkspaceStore'
import { WorkspaceOwnershipPolicy, WorkspaceRegistrationPolicy } from '@platform/workspace/policies'
import type { WorkspaceEvent, WorkspaceSnapshot } from '@platform/workspace/contracts'
import { composePanelWorkspace } from './composePanelWorkspace'
import {
  createPanelWorkspaceIpcHandlers,
  type PanelWorkspaceIpcDependencies,
  type WorkspaceIpcSenderEvent
} from './panelWorkspaceIpcHandlers'
import { createWorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace。回归 P1-06a Main 侧安全核心（P1-06c 拆分后本文件只留集成断言，
 * payload 守卫矩阵见 panelWorkspacePayloadGuard.test.ts，宿主侧投影矩阵见 panelWorkspaceScopeProjection.test.ts）：
 * 5 条通道 surface、sender 主 frame/登记/epoch 归属、host context 作用域与敏感字段、严格方法与字段白名单、
 * stale revision、resize/reset/reopen 真实命令、host lifecycle 来源校验，
 * 以及 composePanelWorkspace 的恢复/降级/persistenceState/迟到 CAS/有界退出。
 */

const PAGE_ID = 'sample.page'
const PANEL_ID = 'sample.inspector'
const DETACHED_WEBCONTENTS = 7

const panelRegistration = {
  panelId: PANEL_ID,
  title: { 'zh-CN': '检查器', 'en-US': 'Inspector' },
  icon: 'file-text',
  module: PANEL_ID,
  pageIds: [PAGE_ID],
  supportedModes: ['embedded', 'docked-right', 'docked-bottom', 'detached'] as const,
  defaultMode: 'embedded' as const,
  allowMultipleInstances: true,
  minSize: { width: 320, height: 240 },
  preferredSize: { width: 480, height: 360 },
  binding: { persistence: 'session' as const, maxKeyBytes: WorkspaceRegistrationPolicy.maxBindingKeyBytes },
  lifecycleEvents: ['open', 'close'] as const
}

type DetachedHostPort = NonNullable<PanelWorkspaceIpcDependencies['detachedHost']>
/** P1-04 confirmTargetReady 自己会返回的失败词表（'already-committed' 只属于 commit 阶段）。 */
type HostTargetReadyRejection = 'invalid-phase' | 'timer-unavailable'

function createFakeDetachedHost(reply?: { targetReady?: HostTargetReadyRejection }) {
  const calls = {
    targetReady: [] as unknown[], sourceReleased: [] as unknown[], sourceInvalid: [] as unknown[],
    windowFailure: [] as unknown[], nativeClose: [] as unknown[]
  }
  const committed = (claim: { operationId: string; windowInstanceId: string; hostEpoch: number }) =>
    ({ accepted: true as const, outcome: { status: 'committed' as const, ...claim } })
  const port: DetachedHostPort = {
    confirmTargetReady: (claim) => {
      calls.targetReady.push(claim)
      return reply?.targetReady ? { accepted: false as const, reason: reply.targetReady } : { accepted: true as const }
    },
    confirmSourceReleased: (claim) => { calls.sourceReleased.push(claim); return committed(claim) },
    confirmSourceInvalid: (claim) => { calls.sourceInvalid.push(claim); return committed(claim) },
    reportWindowFailure: (input) => {
      calls.windowFailure.push(input)
      return { status: 'rolled-back', operationId: 'op', fallbackReason: 'window-crashed', fallbackMode: 'embedded' }
    },
    handleNativeClose: (input) => { calls.nativeClose.push(input); return { status: 'redocked', mode: 'docked-right' } }
  }
  return { port, calls }
}

/** 共享底座：真实 sealed registry + runtime store + 窗口 registry（序列 id 便于断言身份）。 */
function createBase() {
  let sequence = 0
  const panelRegistry = createPanelRegistry({ pageIds: [PAGE_ID], moduleIds: [PANEL_ID] })
  panelRegistry.register({ ...panelRegistration })
  panelRegistry.seal()
  const runtimeStore = createPanelWorkspaceStore({
    panelRegistry, pageIds: [PAGE_ID], createOpaqueId: (prefix) => `${prefix}-${++sequence}`
  })
  const windowRegistry = createWorkspaceWindowRegistry({ createOpaqueId: (prefix) => `${prefix}-${++sequence}` })
  return { panelRegistry, runtimeStore, windowRegistry }
}

function createHarness(options: {
  detachedHost?: DetachedHostPort
  readPersistenceState?: () => 'saved' | 'pending' | 'failed'
  /** 受控偏好来源的时区覆盖：用于固定「已解析时区必须进上下文、非法值必须回落」这条 seam 语义。 */
  timeZone?: () => string | Promise<string>
} = {}) {
  const { panelRegistry, runtimeStore, windowRegistry } = createBase()
  const main = windowRegistry.registerMainWindow({ webContentsId: 1 })
  const onApplied = vi.fn()
  const handlers = createPanelWorkspaceIpcHandlers({
    panelRegistry, pageIds: [PAGE_ID], runtimeStore, windowRegistry,
    preferences: { getLanguage: async () => 'zh-CN', getTheme: () => 'dark', getTimeZone: options.timeZone ?? (async () => 'UTC') },
    readPersistenceState: options.readPersistenceState,
    onApplied,
    detachedHost: options.detachedHost
  })
  return { panelRegistry, runtimeStore, windowRegistry, main, handlers, onApplied }
}

type Harness = ReturnType<typeof createHarness>

function eventFor(webContentsId: number, overrides: { parent?: unknown; destroyed?: boolean } = {}): WorkspaceIpcSenderEvent {
  return {
    senderFrame: { parent: overrides.parent ?? null },
    sender: { id: webContentsId, isDestroyed: () => overrides.destroyed ?? false }
  }
}
const mainEvent = (harness: Harness) => eventFor(1)
const revision = (harness: Harness) => harness.runtimeStore.getSnapshot().layoutRevision

async function openInspector(harness: Harness) {
  const workspace = await harness.handlers.command(mainEvent(harness), {
    method: 'openWorkspace', requestId: 'req-workspace', expectedRevision: revision(harness), pageId: PAGE_ID
  })
  const panel = await harness.handlers.command(mainEvent(harness), {
    method: 'openPanel', requestId: 'req-panel', expectedRevision: revision(harness),
    workspaceInstanceKey: workspace.workspaceInstanceKey, panelId: PANEL_ID
  })
  return { workspaceInstanceKey: workspace.workspaceInstanceKey as string, panelInstanceKey: panel.panelInstanceKey as string }
}

/** 造出一个真实在飞事务：源是主窗（store 身份 main/1），目标是 P1-04 registry 里预留并 attach 的 detached 窗。 */
async function startTransfer(harness: Harness) {
  const keys = await openInspector(harness)
  const transfer = await harness.runtimeStore._beginTransfer({
    requestId: 'req-transfer', expectedRevision: revision(harness), hostEpoch: 1, windowInstanceId: 'main',
    panelInstanceKey: keys.panelInstanceKey, targetMode: 'detached'
  })
  if (transfer.status !== 'preparing') throw new Error(`transfer not prepared: ${JSON.stringify(transfer)}`)
  const reserved = harness.windowRegistry.reserveDetachedWindow({
    hostEpoch: 2, panelInstanceKey: keys.panelInstanceKey, workspaceInstanceKey: keys.workspaceInstanceKey
  })
  if (reserved.status !== 'reserved') throw new Error(`reservation rejected: ${reserved.errorCode}`)
  harness.windowRegistry.attachWebContents({ windowInstanceId: reserved.record.windowInstanceId, webContentsId: DETACHED_WEBCONTENTS })
  return { ...keys, operationId: transfer.operation.operationId, target: reserved.record }
}

/** F1 接线夹具：受控快照（主窗 p-main / 独立宿主 panel-detached / 别人 p-other），只验证 handlers 把投影接上了。 */
function createScopingHarness() {
  const { panelRegistry, runtimeStore: realStore, windowRegistry } = createBase()
  windowRegistry.registerMainWindow({ webContentsId: 1 })
  const reserved = windowRegistry.reserveDetachedWindow({
    hostEpoch: 2, panelInstanceKey: 'panel-detached', workspaceInstanceKey: 'workspace-1'
  })
  if (reserved.status !== 'reserved') throw new Error('reservation rejected')
  windowRegistry.attachWebContents({ windowInstanceId: reserved.record.windowInstanceId, webContentsId: DETACHED_WEBCONTENTS })

  const panel = (panelInstanceKey: string, workspaceInstanceKey: string, windowInstanceId: string, hostEpoch: number) => ({
    panelInstanceKey, workspaceInstanceKey, panelId: PANEL_ID, open: true,
    mode: 'docked-right' as const, presentation: 'normal' as const, bindingState: 'bound' as const,
    windowInstanceId, hostEpoch, lastValidDock: 'docked-right' as const
  })
  const snapshot: WorkspaceSnapshot = {
    layoutRevision: 77,
    activeWorkspaceInstanceKey: 'workspace-1',
    panels: [
      panel('p-main', 'workspace-1', WorkspaceOwnershipPolicy.initialWindowInstanceId, 1),
      panel('panel-detached', 'workspace-1', reserved.record.windowInstanceId, 2),
      panel('p-other', 'workspace-2', 'window-other', 3)
    ],
    pageLayouts: [
      { workspaceInstanceKey: 'workspace-1', panelOrder: ['p-main', 'panel-detached'], activePanels: { 'docked-right': 'p-main' } },
      { workspaceInstanceKey: 'workspace-2', panelOrder: ['p-other'], activePanels: { embedded: 'p-other' } }
    ],
    tabs: [] as readonly [],
    persistenceState: 'saved' as const
  }
  // 只替换 getSnapshot 与一个命令：读路径与命令响应共用同一份受控快照，其余 store 行为保持真实
  const runtimeStore = {
    ...realStore,
    getSnapshot: () => snapshot,
    closePanel: async (input: { panelInstanceKey: string }) => ({
      status: 'rejected' as const, snapshot, errorCode: 'not-owner' as const, panelInstanceKey: input.panelInstanceKey
    })
  }
  const handlers = createPanelWorkspaceIpcHandlers({
    panelRegistry, pageIds: [PAGE_ID], runtimeStore, windowRegistry,
    preferences: { getLanguage: async () => 'zh-CN', getTheme: () => 'dark' , getTimeZone: async () => 'UTC'},
    readPersistenceState: () => 'pending'
  })
  return { handlers, snapshot }
}

describe('panel workspace IPC handlers', () => {
  it('exposes exactly five named channels bound to the workspace IpcChannels constants', () => {
    const { handlers } = createHarness()
    expect(handlers.channels).toEqual({
      workspaceGetHostContext: 'platform:workspace-get-host-context',
      workspaceGetSnapshot: 'platform:workspace-get-snapshot',
      workspaceCommand: 'platform:workspace-command',
      workspaceHostLifecycle: 'platform:workspace-host-lifecycle',
      workspaceEvent: 'platform:workspace-event'
    })
    expect(handlers.channels.workspaceGetHostContext).toBe(IpcChannels.workspaceGetHostContext)
    expect(handlers.channels.workspaceEvent).toBe(IpcChannels.workspaceEvent)
    expect(Object.keys(handlers.channels)).toHaveLength(5)
  })

  it('rejects child frames, missing frames, unregistered and destroyed webContents on every entry', async () => {
    const harness = createHarness()
    const { handlers, runtimeStore } = harness
    const child = eventFor(1, { parent: { id: 1 } })
    const missingFrame: WorkspaceIpcSenderEvent = { senderFrame: null, sender: { id: 1, isDestroyed: () => false } }
    const unregistered = eventFor(999)
    const destroyed = eventFor(1, { destroyed: true })

    for (const event of [child, missingFrame, unregistered, destroyed]) {
      await expect(handlers.getHostContext(event)).resolves.toMatchObject({ status: 'rejected' })
      await expect(handlers.getSnapshot(event)).resolves.toMatchObject({ status: 'rejected' })
      await expect(handlers.command(event, { method: 'openWorkspace', requestId: 'r', expectedRevision: 0, pageId: PAGE_ID }))
        .resolves.toMatchObject({ status: 'rejected' })
      await expect(handlers.hostLifecycle(event, { operationId: 'op', phase: 'target-ready' }))
        .resolves.toMatchObject({ accepted: false })
    }
    // 被拒的 sender 不得抬 revision，也不得触发持久化
    expect(runtimeStore.getSnapshot().layoutRevision).toBe(0)
    expect(harness.onApplied).not.toHaveBeenCalled()
  })

  it('publishes the resolved display time zone and falls back for an illegal one', async () => {
    // 受保护 seam 回归：显示时区只在 Main 解析一次，渲染层拿到的必须是可直接格式化的 id。
    const resolved = createHarness({ timeZone: () => 'Asia/Shanghai' })
    const context = await resolved.handlers.getHostContext(mainEvent(resolved))
    if (context.status !== 'ok') throw new Error('host context rejected')
    expect(context.context.preferences.timeZone).toBe('Asia/Shanghai')

    const illegal = createHarness({ timeZone: () => 'Asia/Shanghai;rm -rf' })
    const fallback = await illegal.handlers.getHostContext(mainEvent(illegal))
    if (fallback.status !== 'ok') throw new Error('host context rejected')
    expect(fallback.context.preferences.timeZone).toBe('UTC')
  })

  it('scopes host context to the sender host and never serializes secrets, home paths or file URLs', async () => {
    const harness = createHarness()
    const empty = await harness.handlers.getHostContext(mainEvent(harness))
    expect(empty).toMatchObject({
      status: 'ok',
      context: {
        windowInstanceId: harness.main.windowInstanceId, hostEpoch: 1, role: 'main', mounts: [],
        layoutRevision: 0, pageIds: [PAGE_ID], preferences: { language: 'zh-CN', theme: 'dark', timeZone: 'UTC' }
      }
    })

    const keys = await openInspector(harness)
    const scoped = await harness.handlers.getHostContext(mainEvent(harness))
    if (scoped.status !== 'ok') throw new Error('host context rejected')
    expect(scoped.context.mounts).toEqual([{
      workspaceInstanceKey: keys.workspaceInstanceKey, panelInstanceKey: keys.panelInstanceKey,
      panelId: PANEL_ID, open: true, mode: 'embedded', bindingState: 'unavailable'
    }])
    const serialized = JSON.stringify(scoped.context)
    expect(serialized).not.toMatch(/token|apikey|api_key|secret|password|credential/i)
    expect(serialized).not.toContain(homedir())
    expect(serialized).not.toContain('file:')
    expect(serialized).not.toContain('/Users/')

    // 另一个宿主（独立窗口）看不到主窗挂载，也不接受任何额外字段
    const detached = harness.windowRegistry.reserveDetachedWindow({ hostEpoch: 2, panelInstanceKey: keys.panelInstanceKey, workspaceInstanceKey: keys.workspaceInstanceKey })
    if (detached.status !== 'reserved') throw new Error('reservation rejected')
    harness.windowRegistry.attachWebContents({ windowInstanceId: detached.record.windowInstanceId, webContentsId: DETACHED_WEBCONTENTS })
    const other = await harness.handlers.getHostContext(eventFor(DETACHED_WEBCONTENTS))
    expect(other).toMatchObject({ status: 'ok', context: { role: 'panel', mounts: [], windowInstanceId: detached.record.windowInstanceId } })
    await expect(harness.handlers.getHostContext(mainEvent(harness), { url: 'file:///etc/passwd' }))
      .resolves.toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })
  })

  it('getHostContext 只向被预留的待接管目标暴露受控待接管视图（reserved → in-flight），提交后视图消失且挂载出现', async () => {
    const harness = createHarness()
    const keys = await openInspector(harness)
    const reserved = harness.windowRegistry.reserveDetachedWindow({
      hostEpoch: 2, panelInstanceKey: keys.panelInstanceKey, workspaceInstanceKey: keys.workspaceInstanceKey
    })
    if (reserved.status !== 'reserved') throw new Error('reservation rejected')
    harness.windowRegistry.attachWebContents({
      windowInstanceId: reserved.record.windowInstanceId, webContentsId: DETACHED_WEBCONTENTS
    })
    const target = { windowInstanceId: reserved.record.windowInstanceId, hostEpoch: 2 }

    // 预留中（飞事务尚未建立）：目标能看到「待接管」，但此时还没有 operationId —— 这正是它无法从 mounts 推断身份的原因
    await expect(harness.handlers.getHostContext(eventFor(DETACHED_WEBCONTENTS))).resolves.toMatchObject({
      status: 'ok',
      context: {
        role: 'panel', mounts: [],
        pendingTransfer: {
          status: 'reserved', panelInstanceKey: keys.panelInstanceKey, panelId: PANEL_ID,
          workspaceInstanceKey: keys.workspaceInstanceKey
        }
      }
    })

    const begun = await harness.runtimeStore._beginTransfer({
      requestId: 'req-transfer', expectedRevision: revision(harness), hostEpoch: 1, windowInstanceId: 'main',
      panelInstanceKey: keys.panelInstanceKey, targetMode: 'detached', targetHost: target
    })
    if (begun.status !== 'preparing') throw new Error(`transfer not prepared: ${JSON.stringify(begun)}`)
    const operationId = begun.operation.operationId

    // 飞事务建立后视图推进到 in-flight：operationId 逐字来自权威 store，绝不是 renderer 自造
    await expect(harness.handlers.getHostContext(eventFor(DETACHED_WEBCONTENTS))).resolves.toMatchObject({
      status: 'ok',
      context: {
        mounts: [],
        pendingTransfer: { status: 'in-flight', operationId, phase: 'awaiting-source-prepared' }
      }
    })
    expect(harness.runtimeStore.getSnapshot().panels.find((panel) => panel.panelInstanceKey === keys.panelInstanceKey)?.transfer?.operationId)
      .toBe(operationId)

    // 未参与转移的宿主（主窗）看不到该视图
    const main = await harness.handlers.getHostContext(mainEvent(harness))
    if (main.status !== 'ok') throw new Error('main context rejected')
    expect(main.context.pendingTransfer).toBeNull()
    // 非目标宿主的独立窗（预留给别的面板）同样看不到
    const otherReserved = harness.windowRegistry.reserveDetachedWindow({
      hostEpoch: 3, panelInstanceKey: 'panel-other', workspaceInstanceKey: keys.workspaceInstanceKey
    })
    if (otherReserved.status !== 'reserved') throw new Error('reservation rejected')
    harness.windowRegistry.attachWebContents({ windowInstanceId: otherReserved.record.windowInstanceId, webContentsId: DETACHED_WEBCONTENTS + 1 })
    const other = await harness.handlers.getHostContext(eventFor(DETACHED_WEBCONTENTS + 1))
    if (other.status !== 'ok') throw new Error('other context rejected')
    expect(other.context.pendingTransfer).toBeNull()

    // 提交：目标取得归属后视图消失、挂载出现（同一份受控投影，权限未放宽）
    await harness.runtimeStore._sourcePrepared(operationId, { windowInstanceId: 'main', hostEpoch: 1 })
    await harness.runtimeStore._targetReady(operationId, target)
    await harness.runtimeStore._sourceReleased(operationId, { windowInstanceId: 'main', hostEpoch: 1 })
    await harness.runtimeStore._commitTransfer(operationId)
    const after = await harness.handlers.getHostContext(eventFor(DETACHED_WEBCONTENTS))
    if (after.status !== 'ok') throw new Error('target context rejected')
    expect(after.context.pendingTransfer).toBeNull()
    expect(after.context.mounts).toEqual([{
      workspaceInstanceKey: keys.workspaceInstanceKey, panelInstanceKey: keys.panelInstanceKey,
      panelId: PANEL_ID, open: true, mode: 'detached', bindingState: 'unavailable'
    }])
  })

  it('returns the real persistence state on every snapshot instead of the store hardcoded value', async () => {
    const harness = createHarness({ readPersistenceState: () => 'pending' })
    const snapshot = await harness.handlers.getSnapshot(mainEvent(harness))
    expect(snapshot).toMatchObject({ status: 'ok', snapshot: { persistenceState: 'pending' } })
    const applied = await harness.handlers.command(mainEvent(harness), {
      method: 'openWorkspace', requestId: 'req-workspace', expectedRevision: 0, pageId: PAGE_ID
    })
    expect(applied.snapshot.persistenceState).toBe('pending')
  })

  it('scopes snapshots, mounts and command responses to the sender host so no host sees unrelated layout (F1)', async () => {
    const harness = createScopingHarness()
    const mainSnapshot = await harness.handlers.getSnapshot(eventFor(1))
    if (mainSnapshot.status !== 'ok') throw new Error('main snapshot rejected')
    // 主窗拿全量（逐条投影细节见 panelWorkspaceScopeProjection.test.ts）
    expect(mainSnapshot.snapshot.panels.map((panel) => panel.panelInstanceKey)).toEqual(['p-main', 'panel-detached', 'p-other'])
    expect(mainSnapshot.snapshot).toMatchObject({ layoutRevision: 77, persistenceState: 'pending', activeWorkspaceInstanceKey: 'workspace-1' })

    const detachedSnapshot = await harness.handlers.getSnapshot(eventFor(DETACHED_WEBCONTENTS))
    if (detachedSnapshot.status !== 'ok') throw new Error('detached snapshot rejected')
    expect(detachedSnapshot.snapshot.panels.map((panel) => panel.panelInstanceKey)).toEqual(['panel-detached'])
    expect(detachedSnapshot.snapshot.pageLayouts).toEqual([{
      workspaceInstanceKey: 'workspace-1', panelOrder: ['panel-detached'], activePanels: {}
    }])

    // host context 与快照共用同一所有权判定：承载者能看到自己的挂载
    const context = await harness.handlers.getHostContext(eventFor(DETACHED_WEBCONTENTS))
    expect(context).toMatchObject({ status: 'ok', context: { mounts: [{ panelInstanceKey: 'panel-detached' }] } })

    // 命令响应同样按宿主投影；未授权 sender 得到的是全空投影（不是全量泄露）
    const rejected = await harness.handlers.command(eventFor(DETACHED_WEBCONTENTS), {
      method: 'closePanel', requestId: 'req-close', expectedRevision: 77, panelInstanceKey: 'p-other'
    })
    expect(rejected.status).toBe('rejected')
    expect(rejected.snapshot.panels.map((panel) => panel.panelInstanceKey)).toEqual(['panel-detached'])
    const unauthorized = await harness.handlers.command(eventFor(999), {
      method: 'closePanel', requestId: 'req-close', expectedRevision: 77, panelInstanceKey: 'p-main'
    })
    expect(unauthorized.status).toBe('rejected')
    expect(unauthorized.snapshot.panels).toEqual([])
    expect(unauthorized.snapshot.pageLayouts).toEqual([])
    expect(unauthorized.snapshot.activeWorkspaceInstanceKey).toBeNull()
  })

  it('enforces the exact method and field whitelist and lets the runtime store judge revisions', async () => {
    const harness = createHarness()
    const rejectedCodes = async (payload: unknown) => (await harness.handlers.command(mainEvent(harness), payload)).errorCode
    const cases: Array<[unknown, string]> = [
      [{ method: 'openUrl', requestId: 'r', expectedRevision: 0 }, 'invalid-request'],
      [{ method: 'openWorkspace', requestId: 'r', expectedRevision: 0, pageId: PAGE_ID, url: 'file:///etc/passwd' }, 'invalid-request'],
      [{ method: 'openWorkspace', requestId: 'r', expectedRevision: 0, pageId: PAGE_ID, path: '/Users/someone/secret' }, 'invalid-request'],
      [{ method: 'openWorkspace', requestId: 'r', expectedRevision: 0, pageId: PAGE_ID, requestScope: 'forged' }, 'invalid-request'],
      [{ method: 'openWorkspace', requestId: '', expectedRevision: 0, pageId: PAGE_ID }, 'invalid-request'],
      [{ method: 'openWorkspace', requestId: 'x'.repeat(300), expectedRevision: 0, pageId: PAGE_ID }, 'invalid-request'],
      [{ method: 'openWorkspace', requestId: 'r', expectedRevision: '0', pageId: PAGE_ID }, 'invalid-request'],
      // 原型链方法名不得被当成合法命令（否则白名单会抛异常而不是 fail closed）
      [{ method: 'toString', requestId: 'r', expectedRevision: 0 }, 'invalid-request'],
      [{ method: 'openWorkspace', requestId: 'r', expectedRevision: 0, pageId: 'other.page' }, 'registration-missing'],
      [null, 'invalid-request'],
      [{ method: 'openWorkspace', requestId: 'r', expectedRevision: 0, pageId: PAGE_ID, windowInstanceId: 'forged' }, 'not-owner'],
      [{ method: 'openWorkspace', requestId: 'r', expectedRevision: 0, pageId: PAGE_ID, hostEpoch: 99 }, 'not-owner'],
      // stale revision 由 runtime store 判定，IPC 层不得自造 revision
      [{ method: 'openWorkspace', requestId: 'r', expectedRevision: 7, pageId: PAGE_ID }, 'stale-revision']
    ]
    for (const [payload, errorCode] of cases) expect(await rejectedCodes(payload)).toBe(errorCode)

    // 访问器属性与自定义原型一律拒绝（不得让 getter 穿透校验）
    const accessorPayload: Record<string, unknown> = { method: 'openWorkspace', requestId: 'r', expectedRevision: 0 }
    Object.defineProperty(accessorPayload, 'pageId', { get: () => PAGE_ID, enumerable: true })
    expect(await rejectedCodes(accessorPayload)).toBe('invalid-request')
    const prototypePayload = Object.assign(Object.create({ method: 'openWorkspace' }), { requestId: 'r', expectedRevision: 0, pageId: PAGE_ID })
    expect(await rejectedCodes(prototypePayload)).toBe('invalid-request')

    expect(revision(harness)).toBe(0)
    expect(harness.onApplied).not.toHaveBeenCalled()
  })

  it('routes resize/reset/reopen/close through the verified P1-05 commands and reports revision and dockSize', async () => {
    const harness = createHarness()
    const { panelInstanceKey } = await openInspector(harness)
    const before = revision(harness)

    const resized = await harness.handlers.command(mainEvent(harness), {
      method: 'resizePanel', requestId: 'req-resize', expectedRevision: before, panelInstanceKey, dockSize: { width: 420, height: 320 }
    })
    expect(resized.status).toBe('applied')
    expect(resized.snapshot.layoutRevision).toBe(before + 1)
    expect(resized.snapshot.panels[0]?.dockSize).toEqual({ width: 420, height: 320 })

    const reset = await harness.handlers.command(mainEvent(harness), {
      method: 'resetPanelSize', requestId: 'req-reset', expectedRevision: revision(harness), panelInstanceKey
    })
    expect(reset.status).toBe('applied')
    expect(reset.snapshot.layoutRevision).toBe(before + 2)
    expect(reset.snapshot.panels[0]?.dockSize).toBeUndefined()

    const closed = await harness.handlers.command(mainEvent(harness), {
      method: 'closePanel', requestId: 'req-close', expectedRevision: revision(harness), panelInstanceKey
    })
    expect(closed.snapshot.panels[0]?.open).toBe(false)

    const reopened = await harness.handlers.command(mainEvent(harness), {
      method: 'reopenPanel', requestId: 'req-reopen', expectedRevision: revision(harness), panelInstanceKey
    })
    expect(reopened.status).toBe('applied')
    expect(reopened.snapshot.panels[0]?.open).toBe(true)
    expect(harness.onApplied).toHaveBeenCalled()

    // 尺寸非法/带多余字段同样拒绝
    const bad = await harness.handlers.command(mainEvent(harness), {
      method: 'resizePanel', requestId: 'req-bad', expectedRevision: revision(harness), panelInstanceKey, dockSize: { width: -1, height: 0 }
    })
    expect(bad.errorCode).toBe('invalid-request')
  })

  it('admits host lifecycle only for the in-flight target host and delegates to the P1-04 port', async () => {
    const fake = createFakeDetachedHost()
    const harness = createHarness({ detachedHost: fake.port })
    const transfer = await startTransfer(harness)
    const targetEvent = eventFor(DETACHED_WEBCONTENTS)

    await expect(harness.handlers.hostLifecycle(targetEvent, { operationId: transfer.operationId, phase: 'target-ready' }))
      .resolves.toEqual({ accepted: true })
    expect(fake.calls.targetReady).toEqual([{ operationId: transfer.operationId, windowInstanceId: transfer.target.windowInstanceId, hostEpoch: 2 }])

    // 非目标 sender（主窗冒充目标）、错 epoch、未知 operationId、非法 phase 一律 fail closed
    await expect(harness.handlers.hostLifecycle(mainEvent(harness), { operationId: transfer.operationId, phase: 'target-ready' }))
      .resolves.toEqual({ accepted: false, reason: 'not-owner' })
    await expect(harness.handlers.hostLifecycle(targetEvent, { operationId: transfer.operationId, phase: 'target-ready', hostEpoch: 99 }))
      .resolves.toEqual({ accepted: false, reason: 'not-owner' })
    await expect(harness.handlers.hostLifecycle(mainEvent(harness), { operationId: 'op-unknown', phase: 'source-released' }))
      .resolves.toEqual({ accepted: false, reason: 'unknown-operation' })
    await expect(harness.handlers.hostLifecycle(targetEvent, { operationId: transfer.operationId, phase: 'prepare' }))
      .resolves.toEqual({ accepted: false, reason: 'invalid-request' })
    await expect(harness.handlers.hostLifecycle(eventFor(1, { parent: {} }), { operationId: transfer.operationId, phase: 'target-ready' }))
      .resolves.toEqual({ accepted: false, reason: 'not-owner' })
    expect(fake.calls.targetReady).toHaveLength(1)

    // 源宿主 ACK：source-released 走 P1-04 confirmSourceReleased，source-prepared 由本层如实上报未支持
    await expect(harness.handlers.hostLifecycle(mainEvent(harness), { operationId: transfer.operationId, phase: 'source-released' }))
      .resolves.toMatchObject({ accepted: true, outcome: { status: 'committed' } })
    expect(fake.calls.sourceReleased).toEqual([{ operationId: transfer.operationId, windowInstanceId: harness.main.windowInstanceId, hostEpoch: 1 }])
    await expect(harness.handlers.hostLifecycle(mainEvent(harness), { operationId: transfer.operationId, phase: 'source-prepared', accepted: true }))
      .resolves.toEqual({ accepted: false, reason: 'unsupported' })

    // 故障与原生关闭由 Main 从快照/注册表补齐参数，不接受 renderer 传 lastValidDock
    await expect(harness.handlers.hostLifecycle(targetEvent, { operationId: transfer.operationId, phase: 'window-failure', kind: 'crash' }))
      .resolves.toEqual({ accepted: true })
    expect(fake.calls.windowFailure).toEqual([{ windowInstanceId: transfer.target.windowInstanceId, hostEpoch: 2, kind: 'crash' }])
    await expect(harness.handlers.hostLifecycle(targetEvent, { operationId: transfer.operationId, phase: 'native-close', lastValidDock: 'docked-bottom' }))
      .resolves.toEqual({ accepted: false, reason: 'invalid-request' })
    await expect(harness.handlers.hostLifecycle(targetEvent, { operationId: transfer.operationId, phase: 'native-close' }))
      .resolves.toEqual({ accepted: true })
    expect(fake.calls.nativeClose).toEqual([{
      windowInstanceId: transfer.target.windowInstanceId, hostEpoch: 2, lastValidDock: 'embedded',
      supportedModes: panelRegistration.supportedModes
    }])
  })

  it('fails closed when no detached host is wired or the host rejects the claim', async () => {
    const withoutHost = createHarness()
    const transfer = await startTransfer(withoutHost)
    await expect(withoutHost.handlers.hostLifecycle(eventFor(DETACHED_WEBCONTENTS), { operationId: transfer.operationId, phase: 'target-ready' }))
      .resolves.toEqual({ accepted: false, reason: 'unsupported' })

    const rejecting = createFakeDetachedHost({ targetReady: 'invalid-phase' })
    const harness = createHarness({ detachedHost: rejecting.port })
    const second = await startTransfer(harness)
    await expect(harness.handlers.hostLifecycle(eventFor(DETACHED_WEBCONTENTS), { operationId: second.operationId, phase: 'target-ready' }))
      .resolves.toEqual({ accepted: false, reason: 'invalid-phase' })
  })
})

// ---------------------------------------------------------------------------
// compose：registry + 持久化 + runtime + IPC + 事件路由的组合
// ---------------------------------------------------------------------------

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

const COMPOSE_PAGE = 'sample.overview'
const COMPOSE_PANEL = 'sample.inspector'
const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

function tempLayoutPath(): string {
  const root = mkdtempSync(join(tmpdir(), 'p1-06a-compose-'))
  roots.push(root)
  return join(root, 'workspace', 'panel-layout.json')
}

function storedDocument(input: {
  layoutRevision?: number
  mode?: 'embedded' | 'detached'
  lastValidDock?: DockMode
} = {}): PanelLayoutDocumentV1 {
  return {
    schemaVersion: 1, savedAt: new Date(0).toISOString(), layoutRevision: input.layoutRevision ?? 0,
    workspaces: [{
      workspaceInstanceKey: 'workspace-restored', pageId: COMPOSE_PAGE,
      panelOrder: input.mode ? ['panel-restored'] : [], activePanels: {}
    }],
    panels: input.mode ? [{
      panelInstanceKey: 'panel-restored', workspaceInstanceKey: 'workspace-restored', panelId: COMPOSE_PANEL,
      open: true, mode: input.mode, lastValidDock: input.lastValidDock ?? 'docked-right'
    }] : []
  }
}

function createIpcRecorder() {
  const calls: Array<[string, unknown]> = []
  return { calls, ipcMain: { handle: (channel: string, listener: unknown) => { calls.push([channel, listener]) } } }
}

function createComposition(overrides: {
  layoutFilePath?: string
  panelLayoutStore?: ReturnType<typeof createPanelLayoutStore>
  ipcMain?: { handle: (channel: string, listener: unknown) => void }
} = {}) {
  const recorder = createIpcRecorder()
  const delivered: Array<{ webContentsId: number; event: WorkspaceEvent }> = []
  const composition = composePanelWorkspace({
    productManifests: [composeManifest],
    ipcMain: overrides.ipcMain ?? recorder.ipcMain,
    layoutFilePath: overrides.layoutFilePath ?? tempLayoutPath(),
    panelLayoutStore: overrides.panelLayoutStore,
    sendToHost: (webContentsId, event) => { delivered.push({ webContentsId, event }); return true },
    preferences: { getLanguage: async () => 'zh-CN', getTheme: () => 'light' , getTimeZone: async () => 'UTC'},
    disposeTimeoutMs: 30
  })
  if (composition.status !== 'ready') throw new Error(`composition disabled: ${composition.reason}`)
  return { composition, ipcMain: recorder, delivered }
}

function writeStoredDocument(layoutFilePath: string, document: unknown): void {
  mkdirSync(join(layoutFilePath, '..'), { recursive: true })
  writeFileSync(layoutFilePath, `${JSON.stringify(document, null, 2)}\n`)
}

describe('composePanelWorkspace', () => {
  it('composes a sealed registry and registers the four workspace invoke handlers only after start', async () => {
    const { composition, ipcMain } = createComposition()
    expect(composition.status).toBe('ready')
    expect(ipcMain.calls).toHaveLength(0)
    expect(composition.panelRegistry.list()).toEqual([expect.objectContaining({ id: COMPOSE_PANEL, kind: 'panel' })])
    expect(composition.pageIds).toEqual([COMPOSE_PAGE])
    expect(composition.channels).toEqual(composition.handlers.channels)

    const report = await composition.start()
    expect(report).toMatchObject({ status: 'ready', restore: 'empty', downgradedDetached: [] })
    expect(ipcMain.calls.map(([channel]) => channel).sort()).toEqual([
      IpcChannels.workspaceCommand, IpcChannels.workspaceGetHostContext,
      IpcChannels.workspaceGetSnapshot, IpcChannels.workspaceHostLifecycle
    ])
    expect(ipcMain.calls.every(([, listener]) => typeof listener === 'function')).toBe(true)
  })

  it('bridges the main window to the store identity so layout events actually reach it', async () => {
    const { composition, delivered } = createComposition()
    await composition.start()
    composition.registerMainWindow({ webContentsId: 21 })
    const event: WorkspaceIpcSenderEvent = { senderFrame: { parent: null }, sender: { id: 21, isDestroyed: () => false } }
    const workspace = await composition.handlers.command(event, {
      method: 'openWorkspace', requestId: 'req-workspace', expectedRevision: 0, pageId: COMPOSE_PAGE
    })
    const panel = await composition.handlers.command(event, {
      method: 'openPanel', requestId: 'req-panel', expectedRevision: composition.runtimeStore.getSnapshot().layoutRevision,
      workspaceInstanceKey: workspace.workspaceInstanceKey, panelId: COMPOSE_PANEL
    })
    expect(panel.status).toBe('applied')

    // attachHost：先直发 current snapshot，再建立订阅
    expect(composition.attachMainWindow({ webContentsId: 21 })).toEqual({ attached: true, subscribed: true })
    expect(delivered[0]).toMatchObject({ webContentsId: 21, event: { type: 'snapshot' } })
    delivered.length = 0

    // 主窗是唯一承载者且已订阅：内容事件必须命中（目标身份必须与快照的 main 哨兵一致）
    composition.router.publish({ type: 'container-changed', scope: { workspaceInstanceKey: workspace.workspaceInstanceKey as string } })
    expect(delivered).toEqual([{ webContentsId: 21, event: expect.objectContaining({ type: 'container-changed' }) }])
    // 非承载 scope 不得投递
    delivered.length = 0
    composition.router.publish({ type: 'container-changed', scope: { workspaceInstanceKey: 'workspace-elsewhere' } })
    expect(delivered).toEqual([])
  })

  it('keeps the whole workspace seam disabled and fail closed when no product page is contributed', async () => {
    const recorder = createIpcRecorder()
    const composition = composePanelWorkspace({
      productManifests: [{
        ...composeManifest, shellContributions: { menuPages: [], settingsSections: [] }
      } as unknown as ProductManifest],
      ipcMain: recorder.ipcMain,
      layoutFilePath: tempLayoutPath(),
      sendToHost: () => true,
      preferences: { getLanguage: async () => 'zh-CN', getTheme: () => 'light' , getTimeZone: async () => 'UTC'}
    })
    expect(composition.status).toBe('disabled')
    expect(composition.channels).toBeNull()
    await expect(composition.start()).resolves.toMatchObject({ status: 'disabled', reason: 'no-pages', restore: 'disabled' })
    expect(recorder.calls).toHaveLength(0)
    expect(composition.registerMainWindow({ webContentsId: 1 })).toBeUndefined()
    expect(composition.attachMainWindow({ webContentsId: 1 })).toEqual({ attached: false, subscribed: false })
    await expect(composition.dispose()).resolves.toEqual({ status: 'disabled', flushOutcome: 'skipped' })
  })

  it('downgrades a restored detached panel to its lastValidDock instead of leaving it without a window', async () => {
    const layoutFilePath = tempLayoutPath()
    writeStoredDocument(layoutFilePath, storedDocument({ mode: 'detached', lastValidDock: 'docked-right' }))

    const { composition } = createComposition({ layoutFilePath })
    const report = await composition.start()
    expect(report).toMatchObject({ status: 'ready', restore: 'restored', restoredPanels: 1 })
    expect(report.downgradedDetached).toEqual([{
      panelInstanceKey: 'panel-restored', from: 'detached', to: 'docked-right', reason: 'restore-invalid'
    }])
    const snapshot = composition.runtimeStore.getSnapshot()
    expect(snapshot.panels).toHaveLength(1)
    expect(snapshot.panels[0]).toMatchObject({ mode: 'docked-right', lastValidDock: 'docked-right' })
    expect(snapshot.panels.some((panel) => panel.mode === 'detached')).toBe(false)
  })

  it('projects the persisted pending state into snapshots and flushes boundedly on exit', async () => {
    const { composition } = createComposition()
    await composition.start()
    const record = composition.registerMainWindow({ webContentsId: 11 })
    const event: WorkspaceIpcSenderEvent = { senderFrame: { parent: null }, sender: { id: 11, isDestroyed: () => false } }

    const applied = await composition.handlers.command(event, {
      method: 'openWorkspace', requestId: 'req-workspace', expectedRevision: 0, pageId: COMPOSE_PAGE
    })
    expect(applied.status).toBe('applied')
    expect(applied.snapshot.persistenceState).toBe('pending')

    await composition.flushLayout()
    expect(composition.layoutStore.persistenceState()).toBe('saved')
    const snapshot = await composition.handlers.getSnapshot(event)
    expect(snapshot).toMatchObject({ status: 'ok', snapshot: { persistenceState: 'saved' } })

    const attached = composition.attachMainWindow({ webContentsId: 11 })
    expect(attached).toEqual({ attached: true, subscribed: true })
    expect(composition.router.targetCount()).toBe(1)
    const disposeReport = await composition.dispose()
    expect(disposeReport).toMatchObject({ status: 'ready', flushOutcome: 'saved' })
    expect(composition.router.targetCount()).toBe(0)
    expect(record?.kind).toBe('main')
  })

  it('refuses a late restore that lost the CAS race against a user command', async () => {
    const layoutFilePath = tempLayoutPath()
    const document = storedDocument()
    writeStoredDocument(layoutFilePath, document)

    let releaseRead: (value: PanelLayoutDocumentV1) => void = () => undefined
    const layoutStore = createPanelLayoutStore({
      filePath: layoutFilePath,
      storage: {
        read: () => new Promise<PanelLayoutDocumentV1>((resolve) => { releaseRead = resolve }),
        write: async () => undefined
      },
      timers: { schedule: () => () => undefined },
      readBudgetMs: 60_000
    })
    const { composition } = createComposition({ layoutFilePath, panelLayoutStore: layoutStore })
    const started = composition.start()
    await new Promise((resolve) => setTimeout(resolve, 10))

    composition.registerMainWindow({ webContentsId: 12 })
    const event: WorkspaceIpcSenderEvent = { senderFrame: { parent: null }, sender: { id: 12, isDestroyed: () => false } }
    const applied = await composition.handlers.command(event, {
      method: 'openWorkspace', requestId: 'req-workspace', expectedRevision: 0, pageId: COMPOSE_PAGE
    })
    expect(applied.status).toBe('applied')
    releaseRead(document)

    const report = await started
    expect(report).toMatchObject({ status: 'ready', restore: 'stale' })
    const snapshot = composition.runtimeStore.getSnapshot()
    expect(snapshot.activeWorkspaceInstanceKey).toBe(applied.workspaceInstanceKey)
    expect(snapshot.pageLayouts.map((layout) => layout.workspaceInstanceKey)).toEqual([applied.workspaceInstanceKey])
  })

  it('keeps a hanging writer from blocking exit and reports the bounded timeout', async () => {
    const layoutFilePath = tempLayoutPath()
    writeStoredDocument(layoutFilePath, storedDocument())
    const layoutStore = createPanelLayoutStore({
      filePath: layoutFilePath,
      storage: { read: async () => storedDocument(), write: () => new Promise<void>(() => undefined) },
      timers: { schedule: () => () => undefined }
    })
    const { composition } = createComposition({ layoutFilePath, panelLayoutStore: layoutStore })
    await composition.start()
    composition.registerMainWindow({ webContentsId: 13 })
    const event: WorkspaceIpcSenderEvent = { senderFrame: { parent: null }, sender: { id: 13, isDestroyed: () => false } }
    await composition.handlers.command(event, { method: 'openWorkspace', requestId: 'req-workspace', expectedRevision: 1, pageId: COMPOSE_PAGE })
    const report = await composition.dispose()
    expect(report).toMatchObject({ status: 'ready', flushOutcome: 'timeout' })
  })
})
