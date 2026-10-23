import { describe, expect, it } from 'vitest'

import type { WorkspaceEvent, WorkspacePanelRegistration, WorkspaceSnapshot } from '@platform/workspace/contracts'
import { createPanelRegistry } from '@platform/workspace/registry/panelRegistry'
import { createPanelWorkspaceStore } from '@platform/workspace/runtime/panelWorkspaceStore'
import { createWorkspacePreferenceChangePublisher, listPendingPanelTargets } from './workspacePreferenceChangePublisher'
import { createWorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace（PLAT-31 RED）。
 *
 * 缺陷：`status:'pending'`（准备期）面板目标窗**收不到**偏好通知。既有受众判定（`router.publish` 的
 * `ownsScope`）要求「面板已归属目标窗」才算命中：准备期面板仍归属源窗（主窗）⇒ 目标窗 0 条，而主窗
 * 又必须保持 0 条（不能为了通知准备期窗而误投主窗）。
 *
 * 判据（本文件，Main 侧那一半）：
 *  - **按 registry 定向**：只有「已登记、已绑定 webContents、有 in-flight transfer、且面板尚未归属该窗」的
 *    `detached-panel` 记录才进入定向受众；每条记录恰一次定向投递，scope 用面板级、revision 用面板 store 真值；
 *  - **主窗 0 条**：定向投递一律不经过 `router.publish`，主窗（webContents 1）绝不在投递列表里；
 *  - **P1 相位不回归**：投递只读快照，不改变 transfer 相位 / revision / 窗口归属；未在飞则零投递；
 *  - 未绑定 webContents 的预留目标（还没有订阅）不投递（fail closed，绝不猜）。
 */
const PAGE_ID = 'sample.page-a'
const PANEL_ID = 'sample.inspector'
const MAIN_WEBCONTENTS = 1
const TARGET_WEBCONTENTS = 77

function registration(): WorkspacePanelRegistration {
  return {
    panelId: PANEL_ID,
    title: { 'zh-CN': '检查器', 'en-US': 'Inspector' },
    icon: 'file-text',
    module: PANEL_ID,
    pageIds: [PAGE_ID],
    supportedModes: ['embedded', 'docked-right', 'docked-bottom', 'detached'],
    defaultMode: 'embedded',
    allowMultipleInstances: false,
    minSize: { width: 320, height: 240 },
    preferredSize: { width: 480, height: 360 },
    binding: { persistence: 'none', maxKeyBytes: 256 },
    lifecycleEvents: ['open', 'close']
  }
}

async function pendingTransferFixture(options: { attach?: boolean } = {}) {
  let sequence = 0
  const panelRegistry = createPanelRegistry({ pageIds: [PAGE_ID], moduleIds: [PANEL_ID] })
  panelRegistry.register(registration())
  panelRegistry.seal()
  const store = createPanelWorkspaceStore({
    panelRegistry, pageIds: [PAGE_ID], createOpaqueId: (prefix) => `${prefix}-${++sequence}`
  })
  const windowRegistry = createWorkspaceWindowRegistry({ createOpaqueId: (prefix) => `${prefix}-${++sequence}` })
  windowRegistry.registerMainWindow({ webContentsId: MAIN_WEBCONTENTS })

  const workspace = await store.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: PAGE_ID })
  const panel = await store.openPanel({
    requestId: 'panel', expectedRevision: store.getSnapshot().layoutRevision,
    hostEpoch: 1, workspaceInstanceKey: workspace.workspaceInstanceKey, panelId: PANEL_ID
  })
  const reserved = windowRegistry.reserveDetachedWindow({
    hostEpoch: 2, panelInstanceKey: panel.panelInstanceKey, workspaceInstanceKey: workspace.workspaceInstanceKey
  })
  if (reserved.status !== 'reserved') throw new Error(`reservation rejected: ${reserved.errorCode}`)
  if (options.attach !== false) {
    windowRegistry.attachWebContents({ windowInstanceId: reserved.record.windowInstanceId, webContentsId: TARGET_WEBCONTENTS })
  }
  const transfer = await store._beginTransfer({
    requestId: 'transfer', expectedRevision: store.getSnapshot().layoutRevision, hostEpoch: 1, windowInstanceId: 'main',
    panelInstanceKey: panel.panelInstanceKey, targetMode: 'detached',
    targetHost: { windowInstanceId: reserved.record.windowInstanceId, hostEpoch: reserved.record.hostEpoch }
  })
  if (transfer.status !== 'preparing') throw new Error(`transfer not prepared: ${JSON.stringify(transfer)}`)
  return {
    store, windowRegistry, target: reserved.record, panelInstanceKey: panel.panelInstanceKey,
    workspaceInstanceKey: workspace.workspaceInstanceKey, operationId: transfer.operation.operationId
  }
}

function createPublisherHarness(targets: () => ReturnType<typeof listPendingPanelTargets>) {
  const directed: { webContentsId: number; event: WorkspaceEvent }[] = []
  const published: { type: string; scope?: unknown; layoutRevision?: number }[] = []
  const publisher = createWorkspacePreferenceChangePublisher({
    listPageWindows: () => [],
    listPanelWindows: () => [],
    listPendingPanelWindows: targets,
    sendDirected: (webContentsId, event) => { directed.push({ webContentsId, event }) },
    getPanelRevision: () => 41,
    getTabRevision: () => 7,
    publish: (input) => { published.push(input as { type: string; scope?: unknown; layoutRevision?: number }) }
  })
  return { publisher, directed, published }
}

describe('PLAT-31 准备期面板目标窗的定向偏好投递', () => {
  it('in-flight 目标窗恰收一条定向 snapshot（面板级 scope + 面板 store 真 revision），主窗 0 条', async () => {
    const fixture = await pendingTransferFixture()
    const { publisher, directed, published } = createPublisherHarness(
      () => listPendingPanelTargets(fixture.windowRegistry, fixture.store.getSnapshot())
    )
    expect(publisher.reconcile({ language: 'zh-CN', theme: 'dark', timeZone: 'UTC' })).toBe(false)
    expect(directed).toEqual([])
    expect(publisher.reconcile({ language: 'en-US', theme: 'dark', timeZone: 'UTC' })).toBe(true)

    expect(directed).toHaveLength(1)
    expect(directed[0]?.webContentsId).toBe(TARGET_WEBCONTENTS)
    expect(directed[0]?.event).toMatchObject({
      type: 'snapshot', layoutRevision: 41,
      scope: { workspaceInstanceKey: fixture.workspaceInstanceKey, panelInstanceKey: fixture.panelInstanceKey }
    })
    // 主窗绝不因为「面板此刻仍归属主窗」而收到任何一条（定向投递不经过 router 的归属命中）
    expect(directed.every((entry) => entry.webContentsId !== MAIN_WEBCONTENTS)).toBe(true)
    expect(published).toEqual([])
  })

  it('P1 相位不回归：投递只读快照，transfer/revision/归属逐字不变', async () => {
    const fixture = await pendingTransferFixture()
    const before = fixture.store.getSnapshot()
    const { publisher } = createPublisherHarness(
      () => listPendingPanelTargets(fixture.windowRegistry, fixture.store.getSnapshot())
    )
    publisher.reconcile({ language: 'zh-CN', theme: 'dark', timeZone: 'UTC' })
    publisher.reconcile({ language: 'zh-CN', theme: 'light', timeZone: 'Asia/Shanghai' })
    const after = fixture.store.getSnapshot()
    expect(after.layoutRevision).toBe(before.layoutRevision)
    expect(after.panels).toEqual(before.panels)
    expect(after.panels[0]?.transfer).toMatchObject({ phase: 'awaiting-source-prepared' })
    expect(after.panels[0]?.windowInstanceId).toBe('main')
  })

  it('提交后条目退出定向受众（改由既有 router 归属链负责），且每条窗口身份至多一条', async () => {
    const fixture = await pendingTransferFixture()
    const list = () => listPendingPanelTargets(fixture.windowRegistry, fixture.store.getSnapshot())
    expect(list()).toHaveLength(1)
    const transfer = fixture.store.getSnapshot().panels[0]?.transfer
    if (!transfer) throw new Error('transfer missing')
    await fixture.store._sourcePrepared(fixture.operationId, { windowInstanceId: 'main', hostEpoch: 1 }, true)
    await fixture.store._targetReady(fixture.operationId, { windowInstanceId: fixture.target.windowInstanceId, hostEpoch: fixture.target.hostEpoch })
    await fixture.store._sourceReleased(fixture.operationId, { windowInstanceId: 'main', hostEpoch: 1 })
    await fixture.store._commitTransfer(fixture.operationId)
    expect(list()).toEqual([])

    const { publisher, directed } = createPublisherHarness(list)
    publisher.reconcile({ language: 'zh-CN', theme: 'dark', timeZone: 'UTC' })
    publisher.reconcile({ language: 'en-US', theme: 'dark', timeZone: 'UTC' })
    expect(directed).toEqual([])
  })

  it('未绑定 webContents / 没有 in-flight 的预留目标不投递（fail closed，绝不猜受众）', async () => {
    const unattached = await pendingTransferFixture({ attach: false })
    expect(listPendingPanelTargets(unattached.windowRegistry, unattached.store.getSnapshot())).toEqual([])

    const idle = await pendingTransferFixture()
    // 没有 in-flight（人为清掉 transfer 的等价形态：从未 _beginTransfer 的空白面板）
    const snapshot = idle.store.getSnapshot() as WorkspaceSnapshot
    expect(listPendingPanelTargets(idle.windowRegistry, {
      ...snapshot,
      panels: snapshot.panels.map((panel) => ({ ...panel, transfer: undefined }))
    })).toEqual([])
  })
})
