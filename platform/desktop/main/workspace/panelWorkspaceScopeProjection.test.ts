import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { ProductManifest } from '@platform/product-manifest'
import type { WorkspaceCommandResult, WorkspacePanelSnapshot, WorkspaceSnapshot } from '@platform/workspace/contracts'
import { WorkspaceOwnershipPolicy } from '@platform/workspace/policies'
import { composePanelWorkspace } from './composePanelWorkspace'
import type { PanelWorkspaceIpcDependencies, WorkspaceIpcSenderEvent } from './panelWorkspaceIpcHandlers'
import {
  emptySnapshot,
  ownsPanel,
  pendingTransferFor,
  projectCommandOutcome,
  scopeHostMounts,
  scopeSnapshot,
  toStoreHostIdentity
} from './panelWorkspaceScopeProjection'
import type { WorkspaceWindowRecord } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace。P1-06c 从 `panelWorkspaceIpcHandlers.ts` 拆出的宿主侧投影：
 * store 身份桥 `toStoreHostIdentity`、所有权判定 `ownsPanel`、快照/挂载/命令响应的按宿主过滤，
 * 以及由 compose 串联的「预留窗口身份 === store 转移目标身份」端到端证据（P1-06c 的身份贯通）。
 */

// ---------------------------------------------------------------------------
// 纯投影：受控快照夹具（主窗承载 p-main(w=main)，独立宿主承载 panel-detached(w=window-9)，另有 workspace-2）
// ---------------------------------------------------------------------------

const PAGE_ID = 'sample.page'
const PANEL_ID = 'sample.inspector'

const mainRecord = (overrides: Partial<WorkspaceWindowRecord> = {}): WorkspaceWindowRecord => ({
  windowInstanceId: 'window-1', hostEpoch: 1, kind: 'main', webContentsId: 1,
  panelInstanceKey: null, workspaceInstanceKey: null, ...overrides
})
const detachedRecord = (overrides: Partial<WorkspaceWindowRecord> = {}): WorkspaceWindowRecord => ({
  windowInstanceId: 'window-9', hostEpoch: 2, kind: 'detached-panel', webContentsId: 7,
  panelInstanceKey: 'panel-detached', workspaceInstanceKey: 'workspace-1', ...overrides
})

function panelSnapshot(input: { panelInstanceKey: string; workspaceInstanceKey: string; windowInstanceId: string | null; hostEpoch: number }): WorkspacePanelSnapshot {
  return {
    panelInstanceKey: input.panelInstanceKey, workspaceInstanceKey: input.workspaceInstanceKey, panelId: PANEL_ID,
    open: true, mode: 'docked-right', presentation: 'normal', bindingState: 'bound',
    windowInstanceId: input.windowInstanceId, hostEpoch: input.hostEpoch, lastValidDock: 'docked-right'
  }
}

function controlledSnapshot(): WorkspaceSnapshot {
  return {
    layoutRevision: 77,
    activeWorkspaceInstanceKey: 'workspace-1',
    panels: [
      panelSnapshot({ panelInstanceKey: 'p-main', workspaceInstanceKey: 'workspace-1', windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId, hostEpoch: 1 }),
      panelSnapshot({ panelInstanceKey: 'panel-detached', workspaceInstanceKey: 'workspace-1', windowInstanceId: 'window-9', hostEpoch: 2 }),
      panelSnapshot({ panelInstanceKey: 'p-other', workspaceInstanceKey: 'workspace-2', windowInstanceId: 'window-other', hostEpoch: 3 })
    ],
    pageLayouts: [
      { workspaceInstanceKey: 'workspace-1', panelOrder: ['p-main', 'panel-detached'], activePanels: { 'docked-right': 'p-main' } },
      { workspaceInstanceKey: 'workspace-2', panelOrder: ['p-other'], activePanels: { embedded: 'p-other' } }
    ],
    tabs: [] as readonly [],
    persistenceState: 'saved' as const
  }
}
const readPending = () => 'pending' as const

describe('toStoreHostIdentity', () => {
  it('主窗映射到 store 哨兵身份，其它宿主沿用 registry 实例身份', () => {
    expect(toStoreHostIdentity(mainRecord())).toEqual({ windowInstanceId: 'main', hostEpoch: 1 })
    expect(toStoreHostIdentity(mainRecord({ windowInstanceId: 'window-42', hostEpoch: 5 })))
      .toEqual({ windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId, hostEpoch: 5 })
    expect(toStoreHostIdentity(detachedRecord())).toEqual({ windowInstanceId: 'window-9', hostEpoch: 2 })
  })
})

describe('ownsPanel', () => {
  it('主窗只认 store 哨兵 + epoch，独立宿主只认自己承载的 panelInstanceKey + epoch', () => {
    const mainPanel = controlledSnapshot().panels[0] as WorkspacePanelSnapshot
    expect(ownsPanel(mainRecord(), mainPanel)).toBe(true)
    expect(ownsPanel(mainRecord({ hostEpoch: 2 }), mainPanel)).toBe(false)
    expect(ownsPanel(mainRecord({ kind: 'detached-panel' }), mainPanel)).toBe(false)

    const detachedPanel = controlledSnapshot().panels[1] as WorkspacePanelSnapshot
    expect(ownsPanel(detachedRecord(), detachedPanel)).toBe(true)
    expect(ownsPanel(detachedRecord({ hostEpoch: 3 }), detachedPanel)).toBe(false)
    expect(ownsPanel(detachedRecord({ panelInstanceKey: 'panel-other' }), detachedPanel)).toBe(false)
    expect(ownsPanel(detachedRecord({ panelInstanceKey: null }), detachedPanel)).toBe(false)
    // 别的宿主的 panel 一律不属于本宿主，绝不因为「同属一个 workspace」而放行
    expect(ownsPanel(detachedRecord(), controlledSnapshot().panels[2] as WorkspacePanelSnapshot)).toBe(false)
  })
})

describe('scopeSnapshot / emptySnapshot / scopeHostMounts', () => {
  it('主窗拿全量（只覆盖真实持久化状态），独立宿主只拿自己承载的 panel 与所属 workspace 布局', () => {
    const raw = controlledSnapshot()
    const full = scopeSnapshot(raw, mainRecord(), readPending)
    expect(full.panels.map((panel) => panel.panelInstanceKey)).toEqual(['p-main', 'panel-detached', 'p-other'])
    expect(full.pageLayouts.map((layout) => layout.workspaceInstanceKey)).toEqual(['workspace-1', 'workspace-2'])
    expect(full).toMatchObject({ layoutRevision: 77, activeWorkspaceInstanceKey: 'workspace-1', persistenceState: 'pending' })

    const scoped = scopeSnapshot(raw, detachedRecord(), readPending)
    expect(scoped.panels.map((panel) => panel.panelInstanceKey)).toEqual(['panel-detached'])
    expect(scoped.pageLayouts).toEqual([{ workspaceInstanceKey: 'workspace-1', panelOrder: ['panel-detached'], activePanels: {} }])
    expect(scoped.activeWorkspaceInstanceKey).toBe('workspace-1')
    expect(scoped).toMatchObject({ layoutRevision: 77, persistenceState: 'pending' })
    expect(Object.isFrozen(scoped.panels)).toBe(true)
    expect(Object.isFrozen(scoped.pageLayouts)).toBe(true)
    // 受控快照本身不得被改写
    expect(raw.panels).toHaveLength(3)
  })

  it('未承载任何 panel 的宿主拿到空投影（不是全量回退），activeWorkspace 归零但 revision 仍真实', () => {
    const empty = scopeSnapshot(controlledSnapshot(), detachedRecord({ panelInstanceKey: 'panel-unknown' }), readPending)
    expect(empty.panels).toEqual([])
    expect(empty.pageLayouts).toEqual([])
    expect(empty.activeWorkspaceInstanceKey).toBeNull()
    expect(empty).toMatchObject({ layoutRevision: 77, persistenceState: 'pending' })

    const hardEmpty = emptySnapshot(controlledSnapshot(), readPending)
    expect(hardEmpty.panels).toEqual([])
    expect(hardEmpty.pageLayouts).toEqual([])
    expect(hardEmpty.activeWorkspaceInstanceKey).toBeNull()
    expect(hardEmpty).toMatchObject({ tabs: [], persistenceState: 'pending' })
  })

  it('宿主挂载按同一所有权判定投影，且只带安全字段', () => {
    expect(scopeHostMounts(controlledSnapshot(), detachedRecord())).toEqual([{
      workspaceInstanceKey: 'workspace-1', panelInstanceKey: 'panel-detached', panelId: PANEL_ID,
      open: true, mode: 'docked-right', bindingState: 'bound'
    }])
    expect(scopeHostMounts(controlledSnapshot(), detachedRecord({ panelInstanceKey: 'panel-unknown' }))).toEqual([])
    // 挂载列表不是快照：主窗只列自己承载的（epoch 1 的 p-main），不因为「快照拿全量」而列出别人的面板
    expect(scopeHostMounts(controlledSnapshot(), mainRecord()).map((mount) => mount.panelInstanceKey))
      .toEqual(['p-main'])
  })
})

describe('pendingTransferFor（P1-06f 受控待接管视图）', () => {
  /** 待接管目标：同一个面板、但**另一个**窗口身份与 epoch（尚未取得归属）。 */
  const targetRecord = (overrides: Partial<WorkspaceWindowRecord> = {}): WorkspaceWindowRecord =>
    detachedRecord({ windowInstanceId: 'window-target', hostEpoch: 3, ...overrides })
  const withTransfer = (panelInstanceKey: string, phase: 'awaiting-source-prepared' | 'awaiting-source-release'): WorkspaceSnapshot => {
    const raw = controlledSnapshot()
    return {
      ...raw,
      panels: raw.panels.map((panel) => panel.panelInstanceKey === panelInstanceKey
        ? { ...panel, transfer: { operationId: 'operation-1', phase } }
        : panel)
    }
  }

  it('只向「尚未取得归属」的被预留目标宿主投射待接管视图（含 operationId 与相位）', () => {
    expect(pendingTransferFor(withTransfer('panel-detached', 'awaiting-source-prepared'), targetRecord())).toEqual({
      status: 'in-flight', operationId: 'operation-1', phase: 'awaiting-source-prepared',
      workspaceInstanceKey: 'workspace-1', panelInstanceKey: 'panel-detached', panelId: PANEL_ID
    })
    expect(pendingTransferFor(withTransfer('panel-detached', 'awaiting-source-release'), targetRecord()))
      .toMatchObject({ status: 'in-flight', phase: 'awaiting-source-release' })
  })

  it('预留中（飞事务尚未建立）只给「reserved」受控视图：目标需要在拿到 operationId 之前识别自己', () => {
    expect(pendingTransferFor(controlledSnapshot(), targetRecord())).toEqual({
      status: 'reserved', workspaceInstanceKey: 'workspace-1', panelInstanceKey: 'panel-detached', panelId: PANEL_ID
    })
  })

  it('主窗、预留给其它面板的窗口、未登记面板一律看不到该视图（未参与转移者零泄露）', () => {
    const raw = withTransfer('panel-detached', 'awaiting-source-prepared')
    expect(pendingTransferFor(raw, mainRecord())).toBeNull()
    expect(pendingTransferFor(raw, targetRecord({ panelInstanceKey: 'panel-unknown' }))).toBeNull()
    expect(pendingTransferFor(raw, targetRecord({ panelInstanceKey: null }))).toBeNull()
    // 已经承载该面板的窗口（redock 的源、或已提交的宿主）不是「待接管目标」
    expect(ownsPanel(detachedRecord(), controlledSnapshot().panels[1] as WorkspacePanelSnapshot)).toBe(true)
    expect(pendingTransferFor(raw, detachedRecord())).toBeNull()
  })

  it('视图是冻结快照，且绝不改写权威快照本身', () => {
    const raw = withTransfer('panel-detached', 'awaiting-source-prepared')
    const view = pendingTransferFor(raw, targetRecord())
    expect(Object.isFrozen(view)).toBe(true)
    expect(raw.panels[1]).toMatchObject({ windowInstanceId: 'window-9', hostEpoch: 2 })
  })
})

describe('projectCommandOutcome', () => {
  it('按宿主投影快照，并只在 store 真的给了字段时才带上它们', () => {
    const result: WorkspaceCommandResult & { panelInstanceKey?: string; workspaceInstanceKey?: string; hostEpoch?: number } = {
      status: 'rejected', snapshot: controlledSnapshot(), errorCode: 'not-owner', panelInstanceKey: 'p-other'
    }
    const rejected = projectCommandOutcome(result, detachedRecord(), readPending)
    expect(rejected.status).toBe('rejected')
    expect(rejected.errorCode).toBe('not-owner')
    expect(rejected.panelInstanceKey).toBe('p-other')
    expect(rejected.snapshot.panels.map((panel) => panel.panelInstanceKey)).toEqual(['panel-detached'])
    expect('workspaceInstanceKey' in rejected).toBe(false)
    expect('hostEpoch' in rejected).toBe(false)

    const applied = projectCommandOutcome(
      { status: 'applied', snapshot: controlledSnapshot(), workspaceInstanceKey: 'workspace-1', hostEpoch: 1 },
      mainRecord(), readPending
    )
    expect(applied).toMatchObject({ status: 'applied', workspaceInstanceKey: 'workspace-1', hostEpoch: 1 })
    expect('errorCode' in applied).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 身份贯通端到端：compose 预留窗口身份 → store 转移目标身份（P1-06c 的唯一新增行为）
// ---------------------------------------------------------------------------

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

const COMPOSE_PAGE = 'sample.overview'
const COMPOSE_PANEL = 'sample.inspector'
const DETACHED_WEBCONTENTS = 41
const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

type DetachedHostPort = NonNullable<PanelWorkspaceIpcDependencies['detachedHost']>

function createFakeDetachedHost() {
  const calls = { targetReady: [] as unknown[] }
  const committed = (claim: { operationId: string; windowInstanceId: string; hostEpoch: number }) =>
    ({ accepted: true as const, outcome: { status: 'committed' as const, ...claim } })
  const port: DetachedHostPort = {
    confirmTargetReady: (claim) => { calls.targetReady.push(claim); return { accepted: true as const } },
    confirmSourceReleased: (claim) => committed(claim),
    confirmSourceInvalid: (claim) => committed(claim),
    reportWindowFailure: () => ({ status: 'rolled-back', operationId: 'op', fallbackReason: 'window-crashed', fallbackMode: 'embedded' }),
    handleNativeClose: () => ({ status: 'redocked', mode: 'docked-right' })
  }
  return { port, calls }
}

function eventFor(webContentsId: number): WorkspaceIpcSenderEvent {
  return { senderFrame: { parent: null }, sender: { id: webContentsId, isDestroyed: () => false } }
}

function createComposition() {
  const root = mkdtempSync(join(tmpdir(), 'p1-06c-identity-'))
  roots.push(root)
  const fake = createFakeDetachedHost()
  const composition = composePanelWorkspace({
    productManifests: [composeManifest],
    ipcMain: { handle: () => undefined },
    layoutFilePath: join(root, 'workspace', 'panel-layout.json'),
    sendToHost: () => true,
    preferences: { getLanguage: async () => 'zh-CN', getTheme: () => 'light' , getTimeZone: async () => 'UTC'},
    detachedHost: fake.port
  })
  if (composition.status !== 'ready') throw new Error(`composition disabled: ${composition.reason}`)
  return { composition, fake }
}

/** 真实命令打开 workspace+panel，返回主窗记录与两个 key（不伪造 store 状态）。 */
async function openInspector(webContentsId: number) {
  const { composition, fake } = createComposition()
  await composition.start()
  const main = composition.registerMainWindow({ webContentsId })
  const event = eventFor(webContentsId)
  const workspace = await composition.handlers.command(event, {
    method: 'openWorkspace', requestId: 'req-workspace', expectedRevision: 0, pageId: COMPOSE_PAGE
  })
  const panel = await composition.handlers.command(event, {
    method: 'openPanel', requestId: 'req-panel', expectedRevision: composition.runtimeStore.getSnapshot().layoutRevision,
    workspaceInstanceKey: workspace.workspaceInstanceKey as string, panelId: COMPOSE_PANEL
  })
  return {
    composition, fake, event, main,
    panelInstanceKey: panel.panelInstanceKey as string,
    workspaceInstanceKey: workspace.workspaceInstanceKey as string
  }
}

describe('compose 事务身份贯通', () => {
  it('预留的窗口身份 = store 转移目标身份 = P1-04 端口 claim 身份', async () => {
    const { composition, fake, main, panelInstanceKey, workspaceInstanceKey } = await openInspector(31)
    const reserved = composition.windowRegistry.reserveDetachedWindow({ hostEpoch: 2, panelInstanceKey, workspaceInstanceKey })
    if (reserved.status !== 'reserved') throw new Error('reservation rejected')
    const targetWindowInstanceId = reserved.record.windowInstanceId

    const prepared = await composition.beginTransferToReservedHost({
      requestId: 'req-detach', expectedRevision: composition.runtimeStore.getSnapshot().layoutRevision,
      sourceWindowInstanceId: main.windowInstanceId, targetWindowInstanceId, panelInstanceKey
    })
    expect(prepared.status).toBe('preparing')
    if (prepared.status !== 'preparing') return

    // 身份只有一个来源：registry 记录 → 宿主侧投影桥 → store 转移目标。三者必须是同一个值
    expect(prepared.target).toEqual({ windowInstanceId: targetWindowInstanceId, hostEpoch: 2 })
    expect(prepared.target).toEqual(toStoreHostIdentity(reserved.record))
    expect(prepared.window).toBe(composition.windowRegistry.describeWindow(targetWindowInstanceId))
    // 源身份仍按 store 哨兵桥（主窗），未被目标身份污染
    expect(prepared.source).toEqual({ windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId, hostEpoch: 1 })

    // store 里真的存在这个飞事务，且源仍是主窗（未 commit）
    expect(composition.runtimeStore.getSnapshot().panels[0]).toMatchObject({
      panelInstanceKey, windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId,
      transfer: { operationId: prepared.operationId, phase: 'awaiting-source-prepared' }
    })

    // P1-04 端口收到的 claim 与 store 目标身份逐字一致；只走准入，不驱动 _targetReady/_sourceReleased/_commitTransfer
    composition.windowRegistry.attachWebContents({ windowInstanceId: targetWindowInstanceId, webContentsId: DETACHED_WEBCONTENTS })
    await expect(composition.handlers.hostLifecycle(eventFor(DETACHED_WEBCONTENTS), {
      operationId: prepared.operationId, phase: 'target-ready'
    })).resolves.toEqual({ accepted: true })
    expect(fake.calls.targetReady).toEqual([{ operationId: prepared.operationId, ...prepared.target }])
    expect(composition.runtimeStore.getSnapshot().panels[0]?.transfer).toMatchObject({ phase: 'awaiting-source-prepared' })
  })

  it('目标窗口与面板不匹配、不是独立宿主或未登记时一律拒绝，且不创建飞事务', async () => {
    const { composition, main, panelInstanceKey, workspaceInstanceKey } = await openInspector(32)
    const before = composition.runtimeStore.getSnapshot().layoutRevision
    const someoneElse = composition.windowRegistry.reserveDetachedWindow({
      hostEpoch: 2, panelInstanceKey: 'panel-someone-else', workspaceInstanceKey
    })
    if (someoneElse.status !== 'reserved') throw new Error('reservation rejected')

    const base = { requestId: 'req-detach', expectedRevision: before, sourceWindowInstanceId: main.windowInstanceId, panelInstanceKey }
    await expect(composition.beginTransferToReservedHost({ ...base, targetWindowInstanceId: someoneElse.record.windowInstanceId }))
      .resolves.toMatchObject({ status: 'rejected', errorCode: 'not-owner', reason: 'target-panel-mismatch' })
    await expect(composition.beginTransferToReservedHost({ ...base, targetWindowInstanceId: 'window-missing' }))
      .resolves.toMatchObject({ status: 'rejected', errorCode: 'registration-missing', reason: 'unknown-target-window' })
    await expect(composition.beginTransferToReservedHost({ ...base, targetWindowInstanceId: main.windowInstanceId }))
      .resolves.toMatchObject({ status: 'rejected', errorCode: 'not-owner', reason: 'target-not-detached' })
    await expect(composition.beginTransferToReservedHost({ ...base, targetWindowInstanceId: 'window-missing', sourceWindowInstanceId: 'window-missing-source' }))
      .resolves.toMatchObject({ status: 'rejected', errorCode: 'registration-missing', reason: 'unknown-source-window' })

    expect(composition.runtimeStore.getSnapshot().layoutRevision).toBe(before)
    expect(composition.runtimeStore.getSnapshot().panels[0]?.transfer).toBeUndefined()
  })

  it('store 拒绝转移时如实回传 errorCode，绝不留下半条身份记录', async () => {
    const { composition, main, panelInstanceKey, workspaceInstanceKey } = await openInspector(33)
    const reserved = composition.windowRegistry.reserveDetachedWindow({ hostEpoch: 2, panelInstanceKey, workspaceInstanceKey })
    if (reserved.status !== 'reserved') throw new Error('reservation rejected')

    // 陈旧 revision：store 拒绝，registry 预留未被消费（调用方自己按 P1-06d 编排释放）
    await expect(composition.beginTransferToReservedHost({
      requestId: 'req-detach', expectedRevision: 0, sourceWindowInstanceId: main.windowInstanceId,
      targetWindowInstanceId: reserved.record.windowInstanceId, panelInstanceKey
    })).resolves.toMatchObject({ status: 'rejected', errorCode: 'stale-revision', reason: 'store-rejected' })
    expect(composition.runtimeStore.getSnapshot().panels[0]?.transfer).toBeUndefined()
    expect(composition.windowRegistry.describeWindow(reserved.record.windowInstanceId)).toBeDefined()
  })

  it('工作区禁用（无产品页面）时身份贯通入口 fail closed，仍返回形状合法的空快照', async () => {
    // P1-06l 测试隔离：禁用态虽然不建 store/不落盘，布局路径仍必须 per-run 唯一（固定路径是跨运行共享状态，
    // 一旦将来这里接上真实 store 就会像 p1-06d-no-orchestrator 一样被上一次运行的文档污染）
    const root = mkdtempSync(join(tmpdir(), 'p1-06c-disabled-'))
    roots.push(root)
    const composition = composePanelWorkspace({
      productManifests: [{
        ...composeManifest, shellContributions: { menuPages: [], settingsSections: [] }
      } as unknown as ProductManifest],
      ipcMain: { handle: () => undefined },
      layoutFilePath: join(root, 'panel-layout.json'),
      sendToHost: () => true,
      preferences: { getLanguage: async () => 'zh-CN', getTheme: () => 'light' , getTimeZone: async () => 'UTC'}
    })
    expect(composition.status).toBe('disabled')
    await expect(composition.beginTransferToReservedHost({
      requestId: 'req-detach', expectedRevision: 0,
      sourceWindowInstanceId: 'window-missing', targetWindowInstanceId: 'window-missing', panelInstanceKey: 'panel-missing'
    })).resolves.toMatchObject({
      status: 'rejected', errorCode: 'unsupported', reason: 'workspace-disabled',
      snapshot: { panels: [], pageLayouts: [], activeWorkspaceInstanceKey: null, layoutRevision: 0 }
    })
  })
})
