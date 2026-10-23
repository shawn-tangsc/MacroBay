import { describe, expect, it, vi } from 'vitest'

import { WorkspaceOwnershipPolicy } from '@platform/workspace/policies'
import {
  builtInWorkspacePages,
  builtInWorkspacePageModuleIds
} from '@platform/workspace/registry/builtInWorkspacePages'
import { createWorkspacePageRegistry, toProductWorkspacePage } from '@platform/workspace/registry/workspacePageRegistry'
import { createWorkspaceTabStore } from '@platform/workspace/runtime/workspaceTabStore'
import type { WorkspaceEvent, WorkspaceSnapshot, WorkspaceTabState } from '@platform/workspace/contracts'
import { createSecureWindowSecurity } from '../../window/createMainWindow'
import type { DetachedHostEvent, DetachedWindowFactory, DetachedWindowHandle } from './panelDetachedWindowHost'
import { createPanelDetachedWindowHost } from './panelDetachedWindowHost'
import { createTabDetachedWindowHost } from './tabDetachedWindowHost'
import { createTabWorkspaceIpcHandlers, type TabWorkspaceIpcDependencies } from './tabWorkspaceIpcHandlers'
import { createWorkspaceEventRouter } from './workspaceEventRouter'
import { createWorkspaceWindowRegistry, type WorkspaceWindowRecord } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace。P2-03 `.tabs.*` 接线矩阵。
 *
 * 覆盖：
 *  - 通道与 sender 准入（主 frame / 已登记 / 未销毁 / 身份声明一致），伪造与子 frame 一律 not-owner；
 *  - Tab 快照的作用域投影（主窗全量、独立页宿主仅自己的实例、独立面板宿主为空）；
 *  - Tab 命令走真实 `workspaceTabStore`（revision CAS、not-owner、registration-missing）并发布受控事件；
 *  - `detachTab` 两阶段 + 补偿回滚（注册表预留失败/宿主拒绝 ⇒ store 回停靠、登记释放、零孤儿）；
 *  - `.tabs.hostLifecycle` 的 target-ready → 提交，以及迟到/陈旧回调 fail closed；
 *  - `redockTab` 走共享宿主的用户回停靠路径，逻辑 `closeTab` 收敛独立页窗（零孤儿）。
 */

function createPageRegistry() {
  const registry = createWorkspacePageRegistry({
    moduleIds: [...builtInWorkspacePageModuleIds, 'market-intelligence.dashboard'],
    productIds: ['market-intelligence']
  })
  for (const page of builtInWorkspacePages) registry.register(page)
  registry.register(toProductWorkspacePage('market-intelligence', {
    id: 'dashboard', title: { 'zh-CN': '行情面板', 'en-US': 'Market dashboard' },
    icon: 'chart-candlestick', order: 1, module: 'market-intelligence.dashboard'
  }))
  registry.seal()
  return registry
}

type Harness = ReturnType<typeof createHarness>

function createHarness(options: {
  /** P2-09/B3：受控挂载端口（真机＝compose 的 `attachHostWindow`，每次调用都会直发一条 snapshot）。 */
  attach?: (record: WorkspaceWindowRecord) => boolean
  /** P2-10①：宿主销毁/登记回收时的 target 释放端口（真机＝`router.releaseHost`）。 */
  release?: (input: { windowInstanceId: string; hostEpoch: number }) => void
} = {}) {
  let sequence = 0
  const windowRegistry = createWorkspaceWindowRegistry({ createOpaqueId: (prefix) => `${prefix}-${++sequence}` })
  const main = windowRegistry.registerMainWindow({ webContentsId: 10 })
  const pageRegistry = createPageRegistry()
  let tabSequence = 0
  const tabStore = createWorkspaceTabStore({ pageRegistry, createOpaqueId: (prefix = 'id') => `tab-${prefix}-${++tabSequence}` })
  const handles: Array<DetachedWindowHandle & { destroyed: boolean }> = []
  const timers: Array<{ delayMs: number; run: () => void; cancelled: boolean }> = []
  const events: DetachedHostEvent[] = []
  const published: Array<{ type: string; scope: { workspaceInstanceKey?: string; panelInstanceKey?: string }; layoutRevision: number }> = []

  const createWindow: DetachedWindowFactory = () => {
    const handle: DetachedWindowHandle & { destroyed: boolean } = {
      webContentsId: 100 + handles.length,
      destroyed: false,
      isCrashed: () => false,
      loadURL: () => Promise.resolve(),
      isDestroyed: () => handle.destroyed,
      destroy: () => { handle.destroyed = true },
      focus: () => undefined,
      setWindowOpenHandler: () => undefined
    }
    handles.push(handle)
    return handle
  }
  const sharedHost = createPanelDetachedWindowHost({
    entryUrl: 'file:///app/renderer/index.html',
    appRoot: 'file:///app/renderer',
    createWindow,
    security: createSecureWindowSecurity({ preload: '/app/preload/index.js', openExternal: () => undefined }),
    registry: windowRegistry,
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
  const tabHost = createTabDetachedWindowHost({ host: sharedHost, registry: windowRegistry })
  const handlers = createTabWorkspaceIpcHandlers({
    pageRegistry,
    tabStore,
    windowRegistry,
    host: tabHost,
    publish: (input) => { published.push(input) },
    ...(options.attach === undefined ? {} : { attach: options.attach }),
    // PLAT-01②：`release` 是**必填**端口（漏注在构造期即 fail closed）；未显式注入时用 no-op 端口，
    // 使「释放是否真的发生」在断言里完全由 router 的容量自证体现，绝不被 harness 掩盖
    release: options.release ?? (() => undefined)
  })

  const senderFor = (webContentsId: number) => ({
    senderFrame: { parent: null },
    sender: { id: webContentsId, isDestroyed: () => false }
  })
  return {
    windowRegistry, main, pageRegistry, tabStore, handles, timers, events, published, sharedHost, tabHost, handlers,
    senderFor,
    mainSender: senderFor(10),
    fireTimer: () => {
      const entry = timers.filter((timer) => !timer.cancelled)[0]
      if (!entry) throw new Error('no pending timer')
      entry.cancelled = true
      entry.run()
    },
    liveWindows: () => handles.filter((handle) => !handle.destroyed).length,
    revision: () => tabStore.getSnapshot().layoutRevision
  }
}

function frameOf(sender: { sender: { id: number } }) {
  return { senderFrame: { parent: null }, sender: { id: sender.sender.id, isDestroyed: () => false } }
}

async function openTab(harness: Harness, pageId: string, requestId = `req-open-${pageId}`) {
  const result = await harness.handlers.command(harness.mainSender, {
    method: 'openTab', requestId, expectedRevision: harness.revision(),
    windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch, pageId
  })
  return result
}

describe('tabs ipc: channel surface and sender admission', () => {
  it('exposes the three .tabs.* channels plus the shared workspace event channel', () => {
    expect(harness0().handlers.channels).toEqual({
      workspaceTabsGetSnapshot: 'platform:workspace-tabs-get-snapshot',
      workspaceTabsCommand: 'platform:workspace-tabs-command',
      workspaceTabsHostLifecycle: 'platform:workspace-tabs-host-lifecycle',
      workspaceEvent: 'platform:workspace-event'
    })
  })

  function harness0() { return createHarness() }

  it('rejects sub-frames, unregistered senders and destroyed senders before touching the store', async () => {
    const harness = createHarness()
    const subFrame = await harness.handlers.command(
      { senderFrame: { parent: {} }, sender: { id: 10, isDestroyed: () => false } },
      { method: 'openTab', requestId: 'r1', expectedRevision: 0, pageId: 'agents' }
    )
    expect(subFrame).toMatchObject({ status: 'rejected', errorCode: 'not-owner' })

    const unregistered = await harness.handlers.command(
      harness.senderFor(999), { method: 'openTab', requestId: 'r2', expectedRevision: 0, pageId: 'agents' }
    )
    expect(unregistered).toMatchObject({ status: 'rejected', errorCode: 'not-owner' })

    const destroyed = await harness.handlers.command(
      { senderFrame: { parent: null }, sender: { id: 10, isDestroyed: () => true } },
      { method: 'openTab', requestId: 'r3', expectedRevision: 0, pageId: 'agents' }
    )
    expect(destroyed).toMatchObject({ status: 'rejected', errorCode: 'not-owner' })
    expect(harness.tabStore.getSnapshot().tabs).toHaveLength(0)
  })

  it('rejects a forged host claim and unknown/extra payload fields', async () => {
    const harness = createHarness()
    const forged = await harness.handlers.command(harness.mainSender, {
      method: 'openTab', requestId: 'r1', expectedRevision: 0,
      windowInstanceId: 'someone-else', hostEpoch: harness.main.hostEpoch, pageId: 'agents'
    })
    expect(forged).toMatchObject({ status: 'rejected', errorCode: 'not-owner' })

    const extra = await harness.handlers.command(harness.mainSender, {
      method: 'openTab', requestId: 'r2', expectedRevision: 0,
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch, pageId: 'agents', url: 'file:///etc/passwd'
    })
    expect(extra).toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })

    const unknownMethod = await harness.handlers.command(harness.mainSender, {
      method: 'toString', requestId: 'r3', expectedRevision: 0
    })
    expect(unknownMethod).toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })
    expect(harness.tabStore.getSnapshot().tabs).toHaveLength(0)
  })
})

describe('tabs ipc: scoped tab snapshots', () => {
  it('gives the main window the full tab state and a detached page window only its own instance', async () => {
    const harness = createHarness()
    await openTab(harness, 'agents', 'req-a')
    await openTab(harness, 'market-intelligence.dashboard', 'req-b')

    const main = await harness.handlers.getSnapshot(harness.mainSender)
    expect(main.status).toBe('ok')
    expect((main as { snapshot: WorkspaceTabState }).snapshot.tabs.map((tab) => tab.pageId))
      .toEqual(['agents', 'market-intelligence.dashboard'])

    // 分离一个 Tab ⇒ 独立页窗只看到自己
    const detach = await harness.handlers.command(harness.mainSender, {
      method: 'detachTab', requestId: 'req-detach', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch,
      workspaceInstanceKey: (harness.tabStore.getSnapshot().tabs[0] as WorkspaceTabState['tabs'][number]).workspaceInstanceKey
    })
    expect(detach.status).toBe('applied')
    const tabRecord = harness.windowRegistry.listDetachedTabs()[0]
    harness.windowRegistry.attachWebContents({ windowInstanceId: tabRecord.windowInstanceId, webContentsId: 500 })
    const tabRecordBound = harness.windowRegistry.describeWindow(tabRecord.windowInstanceId)
    expect(tabRecordBound?.webContentsId).toBe(500)

    const scoped = await harness.handlers.getSnapshot(frameOf(harness.senderFor(500)))
    expect(scoped.status).toBe('ok')
    expect((scoped as { snapshot: WorkspaceTabState }).snapshot.tabs).toHaveLength(1)
    expect((scoped as { snapshot: WorkspaceTabState }).snapshot.tabs[0].mode).toBe('detached')

    // 独立面板宿主不是页面宿主：拿不到任何 Tab 布局
    const panel = harness.windowRegistry.reserveDetachedWindow({ hostEpoch: 2, panelInstanceKey: 'panel-z', workspaceInstanceKey: 'workspace-z' })
    if (panel.status !== 'reserved') throw new Error('reserve failed')
    harness.windowRegistry.attachWebContents({ windowInstanceId: panel.record.windowInstanceId, webContentsId: 501 })
    const panelScoped = await harness.handlers.getSnapshot(frameOf(harness.senderFor(501)))
    expect((panelScoped as { snapshot: WorkspaceTabState }).snapshot.tabs).toHaveLength(0)
    expect((panelScoped as { snapshot: WorkspaceTabState }).snapshot.activeWorkspaceInstanceKey).toBeNull()
  })

  /**
   * P2-13：渲染侧「重开最近关闭」入口的禁用态**必须**由 Main 从真实 tab store 派生的受控投影驱动
   * （renderer 不自行推断）；同时投影绝不因此放宽作用域 —— 非归属窗拿不到这个数字。
   */
  it('P2-13: derives the recently-closed count from the store and never widens scope', async () => {
    const snapshotOf = (value: unknown): WorkspaceTabState => {
      const record = value as { status: string; snapshot?: WorkspaceTabState }
      if (record.snapshot === undefined) throw new Error(`no snapshot in ${record.status}`)
      return record.snapshot
    }
    // 形状读取：字段落地前是 undefined（RED），落地后是权威条数
    const countOf = (snapshot: WorkspaceTabState): unknown => (snapshot as { recentlyClosedCount?: unknown }).recentlyClosedCount

    const harness = createHarness()
    await openTab(harness, 'agents', 'req-a')
    await openTab(harness, 'settings', 'req-b')
    expect(countOf(snapshotOf(await harness.handlers.getSnapshot(harness.mainSender)))).toBe(0)

    const target = harness.tabStore.getSnapshot().tabs[0]!.workspaceInstanceKey
    const closed = await harness.handlers.command(harness.mainSender, {
      method: 'closeTab', requestId: 'req-close', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch,
      workspaceInstanceKey: target
    })
    expect(closed.status).toBe('applied')
    expect(harness.tabStore.recentlyClosed()).toHaveLength(1)
    // ① 主窗：权威条数逐字来自 store（命令响应与只读快照两条路径都必须一致）
    expect(countOf(closed.snapshot)).toBe(1)
    expect(countOf(snapshotOf(await harness.handlers.getSnapshot(harness.mainSender)))).toBe(1)

    // ② 独立页窗：只拿自己那一个实例，且**不**因本包获得「最近关闭」信息
    const detach = await harness.handlers.command(harness.mainSender, {
      method: 'detachTab', requestId: 'req-detach', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch,
      workspaceInstanceKey: harness.tabStore.getSnapshot().tabs.find((tab) => tab.open)!.workspaceInstanceKey
    })
    expect(detach.status).toBe('applied')
    const tabRecord = harness.windowRegistry.listDetachedTabs()[0]!
    harness.windowRegistry.attachWebContents({ windowInstanceId: tabRecord.windowInstanceId, webContentsId: 500 })
    const pageScoped = snapshotOf(await harness.handlers.getSnapshot(frameOf(harness.senderFor(500))))
    expect(pageScoped.tabs).toHaveLength(1)
    expect(countOf(pageScoped)).toBe(0)

    // ③ 未登记 sender：整份快照都拿不到（更不可能拿到条数）
    expect((await harness.handlers.getSnapshot(harness.senderFor(999))).status).toBe('rejected')
  })
})

describe('tabs ipc: commands against the real tab store', () => {
  it('opens, activates, reorders and closes tabs with revision CAS and publishes scoped events', async () => {
    const harness = createHarness()
    const first = await openTab(harness, 'agents', 'req-1')
    expect(first.status).toBe('applied')
    const second = await openTab(harness, 'settings', 'req-2')
    expect(second.status).toBe('applied')
    const tabs = harness.tabStore.getSnapshot().tabs
    expect(tabs).toHaveLength(2)

    const stale = await harness.handlers.command(harness.mainSender, {
      method: 'activateTab', requestId: 'req-stale', expectedRevision: harness.revision() + 5,
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch,
      workspaceInstanceKey: tabs[0].workspaceInstanceKey
    })
    expect(stale).toMatchObject({ status: 'rejected', errorCode: 'stale-revision' })

    const activate = await harness.handlers.command(harness.mainSender, {
      method: 'activateTab', requestId: 'req-activate', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch,
      workspaceInstanceKey: tabs[0].workspaceInstanceKey
    })
    expect(activate.status).toBe('applied')
    expect(harness.tabStore.getSnapshot().activeWorkspaceInstanceKey).toBe(tabs[0].workspaceInstanceKey)

    const reorder = await harness.handlers.command(harness.mainSender, {
      method: 'reorderTabs', requestId: 'req-reorder', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch,
      workspaceInstanceKeys: [tabs[1].workspaceInstanceKey, tabs[0].workspaceInstanceKey]
    })
    expect(reorder.status).toBe('applied')
    expect(harness.tabStore.getSnapshot().tabs.map((tab) => tab.workspaceInstanceKey))
      .toEqual([tabs[1].workspaceInstanceKey, tabs[0].workspaceInstanceKey])

    const close = await harness.handlers.command(harness.mainSender, {
      method: 'closeTab', requestId: 'req-close', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch,
      workspaceInstanceKey: tabs[1].workspaceInstanceKey
    })
    expect(close.status).toBe('applied')
    expect(harness.tabStore.getSnapshot().tabs.find((tab) => tab.workspaceInstanceKey === tabs[1].workspaceInstanceKey)?.open)
      .toBe(false)

    // 事件发布：受控词汇 + 真实 Tab revision + 实例作用域（绝不自造 revision）
    expect(harness.published.length).toBeGreaterThan(0)
    for (const event of harness.published) {
      expect(['open', 'close', 'restore', 'container-changed']).toContain(event.type)
      expect(Number.isSafeInteger(event.layoutRevision)).toBe(true)
      expect(event.layoutRevision).toBeLessThanOrEqual(harness.revision())
    }
    const closeEvent = harness.published.find((event) => event.type === 'close')
    expect(closeEvent?.scope.workspaceInstanceKey).toBe(tabs[1].workspaceInstanceKey)
  })

  it('resolves a tab open by shell menuKey and rejects ambiguous or missing selectors', async () => {
    const harness = createHarness()
    // 产品页：menuKey = /productId/localPageId（shell 一级菜单键）
    const byMenuKey = await harness.handlers.command(harness.mainSender, {
      method: 'openTab', requestId: 'req-menu', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch,
      menuKey: '/market-intelligence/dashboard'
    })
    expect(byMenuKey.status).toBe('applied')
    expect(harness.tabStore.getSnapshot().tabs[0].pageId).toBe('market-intelligence.dashboard')

    const both = await harness.handlers.command(harness.mainSender, {
      method: 'openTab', requestId: 'req-both', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch,
      pageId: 'agents', menuKey: 'agents'
    })
    expect(both).toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })

    const ambiguous = await harness.handlers.command(harness.mainSender, {
      method: 'openTab', requestId: 'req-none', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch
    })
    expect(ambiguous).toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })

    const unknownMenu = await harness.handlers.command(harness.mainSender, {
      method: 'openTab', requestId: 'req-missing-menu', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch, menuKey: '/nope/nope'
    })
    expect(unknownMenu).toMatchObject({ status: 'rejected', errorCode: 'registration-missing' })
  })

  it('rejects registration-missing, duplicate single-instance pages and non-main new tabs', async () => {
    const harness = createHarness()
    const missing = await harness.handlers.command(harness.mainSender, {
      method: 'openTab', requestId: 'req-missing', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch, pageId: 'no.such.page'
    })
    expect(missing).toMatchObject({ status: 'rejected', errorCode: 'registration-missing' })

    // 单实例页重复打开 = 复用同一实例（激活），绝不偷偷多开；显式 newInstance 才被拒绝
    const first = await openTab(harness, 'agents', 'req-agents')
    const again = await openTab(harness, 'agents', 'req-agents-2')
    expect(again.status).toBe('applied')
    expect(again.workspaceInstanceKey).toBe(first.workspaceInstanceKey)
    expect(harness.tabStore.getSnapshot().tabs).toHaveLength(1)
    const forced = await harness.handlers.command(harness.mainSender, {
      method: 'openTab', requestId: 'req-agents-3', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch,
      pageId: 'agents', newInstance: true
    })
    expect(forced).toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })

    // 独立面板宿主不得新建 Tab（布局管理权只属主窗）
    const panel = harness.windowRegistry.reserveDetachedWindow({ hostEpoch: 2, panelInstanceKey: 'panel-q', workspaceInstanceKey: 'workspace-q' })
    if (panel.status !== 'reserved') throw new Error('reserve failed')
    harness.windowRegistry.attachWebContents({ windowInstanceId: panel.record.windowInstanceId, webContentsId: 600 })
    const foreignNew = await harness.handlers.command(frameOf(harness.senderFor(600)), {
      method: 'openTab', requestId: 'req-foreign', expectedRevision: harness.revision(),
      windowInstanceId: panel.record.windowInstanceId, hostEpoch: panel.record.hostEpoch, pageId: 'settings'
    })
    expect(foreignNew).toMatchObject({ status: 'rejected', errorCode: 'not-owner' })
  })

  it('lets a detached page window manage only its own tab and never another one', async () => {
    const harness = createHarness()
    await openTab(harness, 'agents', 'req-a')
    await openTab(harness, 'settings', 'req-b')
    const tabs = harness.tabStore.getSnapshot().tabs
    const detach = await harness.handlers.command(harness.mainSender, {
      method: 'detachTab', requestId: 'req-d', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch,
      workspaceInstanceKey: tabs[0].workspaceInstanceKey
    })
    expect(detach.status).toBe('applied')
    const record = harness.windowRegistry.listDetachedTabs()[0]
    harness.windowRegistry.attachWebContents({ windowInstanceId: record.windowInstanceId, webContentsId: 700 })
    const sender = harness.senderFor(700)

    const selfActivate = await harness.handlers.command(sender, {
      method: 'activateTab', requestId: 'req-self', expectedRevision: harness.revision(),
      windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch,
      workspaceInstanceKey: tabs[0].workspaceInstanceKey
    })
    expect(selfActivate.status).toBe('applied')

    const beforeForeign = harness.tabStore.getSnapshot()
    const foreign = await harness.handlers.command(sender, {
      method: 'closeTab', requestId: 'req-foreign', expectedRevision: harness.revision(),
      windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch,
      workspaceInstanceKey: tabs[1].workspaceInstanceKey
    })
    expect(foreign).toMatchObject({ status: 'rejected', errorCode: 'not-owner' })
    expect(harness.tabStore.getSnapshot().tabs).toEqual(beforeForeign.tabs)
  })
})

describe('tabs ipc: detach transaction, host lifecycle and compensation', () => {
  it('commits the detach after the page window reports target-ready and publishes container-changed', async () => {
    const harness = createHarness()
    await openTab(harness, 'agents', 'req-a')
    const workspaceInstanceKey = harness.tabStore.getSnapshot().tabs[0].workspaceInstanceKey
    const detach = await harness.handlers.command(harness.mainSender, {
      method: 'detachTab', requestId: 'req-detach', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch, workspaceInstanceKey
    })
    expect(detach.status).toBe('applied')
    const tab = harness.tabStore.getSnapshot().tabs[0]
    expect(tab.mode).toBe('detached')
    const record = harness.windowRegistry.describeWindow(tab.windowInstanceId)
    expect(record?.kind).toBe('detached-tab')
    expect(record?.hostEpoch).toBe(tab.hostEpoch)
    // 命令只到 awaiting-ready：还没有提交，快照里不能假装已接管
    expect(harness.tabHost.committedOwners()).toEqual([])

    harness.windowRegistry.attachWebContents({ windowInstanceId: tab.windowInstanceId, webContentsId: 800 })
    const ready = await harness.handlers.hostLifecycle(harness.senderFor(800), {
      operationId: harness.tabHost.pendingOperationIds()[0], phase: 'target-ready',
      windowInstanceId: tab.windowInstanceId, hostEpoch: tab.hostEpoch
    })
    expect(ready).toEqual({ accepted: true })
    expect(harness.tabHost.committedOwners()).toEqual([workspaceInstanceKey])

    const containerChanged = harness.published.filter((event) => event.type === 'container-changed')
    expect(containerChanged.at(-1)?.scope.workspaceInstanceKey).toBe(workspaceInstanceKey)
  })

  it('compensates (re-dock in the store, release the reservation) when the host refuses the detach', async () => {
    const harness = createHarness()
    await openTab(harness, 'agents', 'req-a')
    const workspaceInstanceKey = harness.tabStore.getSnapshot().tabs[0].workspaceInstanceKey
    // 预算占满（共享预算）：预留必然 limit-reached
    for (let index = 0; index < 8; index += 1) {
      harness.windowRegistry.reserveDetachedWindow({ hostEpoch: 2, panelInstanceKey: `panel-${index}`, workspaceInstanceKey: `workspace-${index}` })
    }
    const detach = await harness.handlers.command(harness.mainSender, {
      method: 'detachTab', requestId: 'req-detach-full', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch, workspaceInstanceKey
    })
    expect(detach).toMatchObject({ status: 'rejected', errorCode: 'limit-reached' })
    // 补偿：store 回到 main，登记与窗口零残留
    expect(harness.tabStore.getSnapshot().tabs[0].mode).toBe('main')
    expect(harness.windowRegistry.listDetachedTabs()).toHaveLength(0)
    expect(harness.liveWindows()).toBe(0)
  })

  it('fails closed on late or stale host lifecycle callbacks and never resurrects the transaction', async () => {
    const harness = createHarness()
    await openTab(harness, 'agents', 'req-a')
    const workspaceInstanceKey = harness.tabStore.getSnapshot().tabs[0].workspaceInstanceKey
    await harness.handlers.command(harness.mainSender, {
      method: 'detachTab', requestId: 'req-d', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch, workspaceInstanceKey
    })
    const tab = harness.tabStore.getSnapshot().tabs[0]
    harness.windowRegistry.attachWebContents({ windowInstanceId: tab.windowInstanceId, webContentsId: 900 })
    const operationId = harness.tabHost.pendingOperationIds()[0]

    const staleEpoch = await harness.handlers.hostLifecycle(harness.senderFor(900), {
      operationId, phase: 'target-ready', windowInstanceId: tab.windowInstanceId, hostEpoch: tab.hostEpoch + 1
    })
    expect(staleEpoch).toEqual({ accepted: false, reason: 'not-owner' })

    const unknown = await harness.handlers.hostLifecycle(harness.senderFor(900), {
      operationId: 'op-does-not-exist', phase: 'target-ready', windowInstanceId: tab.windowInstanceId, hostEpoch: tab.hostEpoch
    })
    expect(unknown).toEqual({ accepted: false, reason: 'unknown-operation' })

    const wrongPhase = await harness.handlers.hostLifecycle(harness.senderFor(900), {
      operationId, phase: 'source-released', windowInstanceId: tab.windowInstanceId, hostEpoch: tab.hostEpoch
    })
    expect(wrongPhase).toEqual({ accepted: false, reason: 'not-owner' })

    // 正确 ACK 后，迟到的重复 ACK 一律 fail closed
    expect(await harness.handlers.hostLifecycle(harness.senderFor(900), {
      operationId, phase: 'target-ready', windowInstanceId: tab.windowInstanceId, hostEpoch: tab.hostEpoch
    })).toEqual({ accepted: true })
    const late = await harness.handlers.hostLifecycle(harness.senderFor(900), {
      operationId, phase: 'source-released', windowInstanceId: tab.windowInstanceId, hostEpoch: tab.hostEpoch
    })
    expect(late.accepted).toBe(false)
    expect(harness.tabHost.committedOwners()).toEqual([workspaceInstanceKey])
  })

  it('reconciles the store back to main when the page window never becomes ready (prepare timeout)', async () => {
    const harness = createHarness()
    await openTab(harness, 'agents', 'req-a')
    const workspaceInstanceKey = harness.tabStore.getSnapshot().tabs[0].workspaceInstanceKey
    await harness.handlers.command(harness.mainSender, {
      method: 'detachTab', requestId: 'req-dt', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch, workspaceInstanceKey
    })
    const tab = harness.tabStore.getSnapshot().tabs[0]
    expect(tab.mode).toBe('detached')
    harness.windowRegistry.attachWebContents({ windowInstanceId: tab.windowInstanceId, webContentsId: 901 })

    // 准备期截止时间到期 ⇒ 共享宿主回滚：窗口销毁、登记释放
    harness.fireTimer()
    expect(harness.liveWindows()).toBe(0)
    expect(harness.windowRegistry.listDetachedTabs()).toHaveLength(0)
    expect(harness.tabHost.committedOwners()).toEqual([])

    // 漂移收敛：store 不能停在「detached 但没有窗口」——必须还原到 main
    const reconciled = await harness.handlers.reconcileContainerDrift()
    expect(reconciled).toEqual([workspaceInstanceKey])
    expect(harness.tabStore.getSnapshot().tabs[0].mode).toBe('main')
    // 收敛幂等：第二次没有可收敛项
    expect(await harness.handlers.reconcileContainerDrift()).toEqual([])

    // 回滚后的迟到 ACK：只登记判定，绝不复活
    const late = await harness.handlers.hostLifecycle(harness.senderFor(901), {
      operationId: 'op-late', phase: 'source-released', windowInstanceId: tab.windowInstanceId, hostEpoch: tab.hostEpoch
    })
    expect(late.accepted).toBe(false)
  })

  it('redocks through the shared user-native-close path and closes detached page windows on closeTab', async () => {
    const harness = createHarness()
    await openTab(harness, 'agents', 'req-a')
    const workspaceInstanceKey = harness.tabStore.getSnapshot().tabs[0].workspaceInstanceKey
    await harness.handlers.command(harness.mainSender, {
      method: 'detachTab', requestId: 'req-d', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch, workspaceInstanceKey
    })
    const tab = harness.tabStore.getSnapshot().tabs[0]
    harness.windowRegistry.attachWebContents({ windowInstanceId: tab.windowInstanceId, webContentsId: 902 })
    await harness.handlers.hostLifecycle(harness.senderFor(902), {
      operationId: harness.tabHost.pendingOperationIds()[0], phase: 'target-ready',
      windowInstanceId: tab.windowInstanceId, hostEpoch: tab.hostEpoch
    })
    expect(harness.tabHost.committedOwners()).toEqual([workspaceInstanceKey])

    const redock = await harness.handlers.command(harness.mainSender, {
      method: 'redockTab', requestId: 'req-redock', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch, workspaceInstanceKey
    })
    expect(redock.status).toBe('applied')
    expect(harness.tabStore.getSnapshot().tabs[0].mode).toBe('main')
    expect(harness.windowRegistry.listDetachedTabs()).toHaveLength(0)
    expect(harness.liveWindows()).toBe(0)

    // 再分离一次，然后逻辑关闭：独立页窗必须消失（零孤儿）
    await harness.handlers.command(harness.mainSender, {
      method: 'detachTab', requestId: 'req-d2', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch, workspaceInstanceKey
    })
    const tab2 = harness.tabStore.getSnapshot().tabs[0]
    expect(harness.liveWindows()).toBe(1)
    const close = await harness.handlers.command(harness.mainSender, {
      method: 'closeTab', requestId: 'req-close', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch, workspaceInstanceKey
    })
    expect(close.status).toBe('applied')
    expect(harness.windowRegistry.listDetachedTabs()).toHaveLength(0)
    expect(harness.liveWindows()).toBe(0)
    expect(harness.sharedHost.closedByPanelCommand(tab2.windowInstanceId)).toBe(true)
  })

  it('refuses detachTab for a non-main sender and for an unregistered page', async () => {
    const harness = createHarness()
    const panel = harness.windowRegistry.reserveDetachedWindow({ hostEpoch: 2, panelInstanceKey: 'panel-p', workspaceInstanceKey: 'workspace-p' })
    if (panel.status !== 'reserved') throw new Error('reserve failed')
    harness.windowRegistry.attachWebContents({ windowInstanceId: panel.record.windowInstanceId, webContentsId: 903 })
    const foreign = await harness.handlers.command(frameOf(harness.senderFor(903)), {
      method: 'detachTab', requestId: 'req-f', expectedRevision: harness.revision(),
      windowInstanceId: panel.record.windowInstanceId, hostEpoch: panel.record.hostEpoch, workspaceInstanceKey: 'workspace-unknown'
    })
    expect(foreign).toMatchObject({ status: 'rejected', errorCode: 'not-owner' })

    await openTab(harness, 'agents', 'req-a')
    const workspaceInstanceKey = harness.tabStore.getSnapshot().tabs[0].workspaceInstanceKey
    const unknownTab = await harness.handlers.command(harness.mainSender, {
      method: 'detachTab', requestId: 'req-u', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch, workspaceInstanceKey: 'workspace-nope'
    })
    expect(unknownTab).toMatchObject({ status: 'rejected', errorCode: 'registration-missing' })
    void workspaceInstanceKey
  })
})

describe('tabs ipc: idempotent replay', () => {
  it('replays the same requestId result and rejects a mismatched replay', async () => {
    const harness = createHarness()
    // 幂等回放要求「方法 + 参数逐字一致」（含 expectedRevision），否则 fail closed
    const request = {
      method: 'openTab', requestId: 'req-same', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch, pageId: 'agents'
    }
    const first = await harness.handlers.command(harness.mainSender, { ...request })
    const replay = await harness.handlers.command(harness.mainSender, { ...request })
    expect(replay).toEqual(first)
    expect(harness.tabStore.getSnapshot().tabs).toHaveLength(1)
    const mismatch = await harness.handlers.command(harness.mainSender, {
      method: 'openTab', requestId: 'req-same', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch, pageId: 'settings'
    })
    expect(mismatch).toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })
    expect(harness.tabStore.getSnapshot().tabs).toHaveLength(1)
    void WorkspaceOwnershipPolicy
  })
})

/**
 * Owner: platform/desktop/main/workspace。P2-09/B3 RED（P2-06R 真机证据 `/tmp/p2-06r-evidence/`）。
 *
 * 真机缺陷：detach 一个页窗后**零交互 32.6s** 收到 48550 条 `type=snapshot/scope={}`（~1487 条/秒），
 * 主窗同期 0 条 ⇒ A-T07「无关窗 0 条」不成立。闭环 = `getSnapshot` 每次都 `attach` → router 每次 attach
 * 都直发一条 snapshot → renderer 收到即 refresh → `tabsGetSnapshot` ⇒ 自持。
 *
 * 判据：`getSnapshot` 是**只读**查询，其副作用（挂载 = 退订旧 listener + 直发 snapshot + 续增量）必须按
 * 宿主身份（windowInstanceId + hostEpoch）**至多发生一次**；N 次 refresh 的直发快照数必须是 O(1)。
 */
describe('tabs ipc: B3 页窗自持 snapshot 风暴（attach 按宿主身份幂等）', () => {
  it('连续 50 次页窗 getSnapshot 只挂载一次：直发快照 O(1)、listener 恒 1', async () => {
    const attachCalls: string[] = []
    const listeners = new Set<string>()
    const harness = createHarness({
      attach: (record) => {
        // 真机 attach 的等价物：router.attachHost 每次都会直发一条 snapshot（见 compose 的挂载点）
        attachCalls.push(`${record.windowInstanceId}:${record.hostEpoch}`)
        listeners.add(record.windowInstanceId)
        return true
      }
    })
    await openTab(harness, 'agents', 'req-b3-open')
    const workspaceInstanceKey = harness.tabStore.getSnapshot().tabs[0].workspaceInstanceKey
    expect((await harness.handlers.command(harness.mainSender, {
      method: 'detachTab', requestId: 'req-b3-detach', expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch, workspaceInstanceKey
    })).status).toBe('applied')
    const record = harness.windowRegistry.listDetachedTabs()[0]
    if (record === undefined) throw new Error('no detached page window')
    harness.windowRegistry.attachWebContents({ windowInstanceId: record.windowInstanceId, webContentsId: 950 })
    const pageSender = frameOf(harness.senderFor(950))

    for (let round = 0; round < 50; round += 1) {
      const view = await harness.handlers.getSnapshot(pageSender)
      expect(view.status).toBe('ok')
      // 幂等化绝不削弱读路径：每一轮都仍拿到自己作用域的权威快照
      expect((view as { snapshot: WorkspaceTabState }).snapshot.tabs.map((tab) => tab.workspaceInstanceKey))
        .toEqual([workspaceInstanceKey])
    }

    // 50 次 refresh ⇒ 恰好 1 次挂载（RED：当前每次 getSnapshot 都挂载 ⇒ 50 次）
    expect(attachCalls).toEqual([`${record.windowInstanceId}:${record.hostEpoch}`])
    // listener 恒 1（每多一次挂载就多一次退订+重订阅，真机表现为每轮一条直发 snapshot）
    expect(listeners.size).toBe(1)
  })
})

/**
 * Owner: platform/desktop/main/workspace。P2-10① RED。
 *
 * 缺陷：`router.targets` 只在显式 `unsubscribe`/`reset` 时清理，**宿主销毁/登记回收不释放** ⇒ `maxTargets`
 * （真机 = maxDetachedHosts + 1 = 9）被死宿主永久占满，同一会话里后续页窗挂载一律 `subscribed:false`，
 * 只能靠 IPC 拉取（**静默降级**：调用方拿不到任何提示）。
 *
 * 判据（真机等价物：`attach` = `router.attachHost`、`release` = `router.releaseHost`）：
 *  ① 登记回收后死宿主的 target 必须被释放，`maxTargets` 额度恢复且**拒绝可见**（容量探测 + 挂载状态）；
 *  ② P2-09 的按身份幂等挂载不得回退（连续 N 次读仍恰 1 条直发快照）；
 *  ③ 释放后同身份重挂仍有直发快照；
 *  ④ 未释放的 target 不受其它宿主销毁影响（隔离）。
 */
describe('tabs ipc: P2-10① 宿主销毁/登记回收释放 router target', () => {
  /** 真机接线等价物：`attach`/`release` 都打到同一个真实 router 上，直发快照按宿主身份计数。 */
  function createRoutedHarness(maxTargets: number) {
    const directSnapshots: string[] = []
    const router = createWorkspaceEventRouter({
      getLayoutRevision: () => 1,
      getSnapshot: (): WorkspaceSnapshot => ({
        layoutRevision: 1, activeWorkspaceInstanceKey: 'workspace-1',
        panels: [], pageLayouts: [], tabs: [], persistenceState: 'saved'
      }),
      send: (windowInstanceId, event: WorkspaceEvent) => {
        if (event.type === 'snapshot') directSnapshots.push(windowInstanceId)
      },
      maxTargets
    })
    const harness = createHarness({
      attach: (record) => router.attachHost({ windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch }).subscribed,
      release: (input) => { router.releaseHost(input) }
    })
    return { harness, router, directSnapshots }
  }

  /** detach 一个页签并返回它的页面窗登记 + sender（真机等价物：窗口物化 + `attachWebContents`）。 */
  async function detachPage(harness: Harness, pageId: string, webContentsId: number) {
    expect((await openTab(harness, pageId, `req-${pageId}-open`)).status).toBe('applied')
    const workspaceInstanceKey = harness.tabStore.getSnapshot().tabs.find((tab) => tab.pageId === pageId)?.workspaceInstanceKey
    if (workspaceInstanceKey === undefined) throw new Error(`no tab for ${pageId}`)
    expect((await harness.handlers.command(harness.mainSender, {
      method: 'detachTab', requestId: `req-${pageId}-detach`, expectedRevision: harness.revision(),
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch, workspaceInstanceKey
    })).status).toBe('applied')
    const record = harness.windowRegistry.listDetachedTabs().find((entry) => entry.workspaceInstanceKey === workspaceInstanceKey)
    if (record === undefined) throw new Error(`no detached page window for ${pageId}`)
    harness.windowRegistry.attachWebContents({ windowInstanceId: record.windowInstanceId, webContentsId })
    return { record, sender: frameOf(harness.senderFor(webContentsId)) }
  }

  it('登记回收释放死宿主的 target、额度恢复、拒绝可见；且幂等读与释放后重挂都不回退', async () => {
    const { harness, router, directSnapshots } = createRoutedHarness(1)
    const first = await detachPage(harness, 'agents', 950)

    // ② P2-09 幂等：连续 5 次读仍恰 1 条直发快照、恰 1 个 target
    for (let round = 0; round < 5; round += 1) {
      expect((await harness.handlers.getSnapshot(first.sender)).status).toBe('ok')
    }
    expect(directSnapshots).toEqual([first.record.windowInstanceId])
    expect(router.capacity().targets).toEqual([first.record.windowInstanceId])

    // 第二个页窗挂载：额度已满 ⇒ 拒绝，但**必须可见**（容量探测 + 挂载状态），不许静默
    const second = await detachPage(harness, 'settings', 951)
    expect((await harness.handlers.getSnapshot(second.sender)).status).toBe('ok')
    expect(router.capacity()).toMatchObject({
      maxTargets: 1, targetCount: 1, available: 0, rejectedCount: 1,
      lastRejected: { windowInstanceId: second.record.windowInstanceId, reason: 'target-limit' }
    })
    expect(harness.handlers.hostSubscriptionStatus()).toEqual({
      subscribed: [first.record.windowInstanceId], degraded: [second.record.windowInstanceId]
    })

    // 宿主销毁 / 登记回收 ⇒ 下一次读必须释放死宿主的 target（RED：当前恒为 1，死宿主永久占额）
    harness.windowRegistry.markDestroyed({ windowInstanceId: first.record.windowInstanceId })
    expect((await harness.handlers.getSnapshot(second.sender)).status).toBe('ok')
    expect(router.capacity().targets).toEqual([second.record.windowInstanceId])
    expect(harness.handlers.hostSubscriptionStatus()).toEqual({ subscribed: [second.record.windowInstanceId], degraded: [] })

    // ③ 释放后同身份重挂 ⇒ 恰好多一条直发快照（首挂被拒 1 条 + 释放后重挂 1 条），且此后的读不再重发
    expect(directSnapshots).toEqual([first.record.windowInstanceId, second.record.windowInstanceId, second.record.windowInstanceId])
    expect((await harness.handlers.getSnapshot(second.sender)).status).toBe('ok')
    expect(directSnapshots).toHaveLength(3)

    // 额度仍被 second 占用；释放它之后新身份可重新订阅
    expect(router.releaseHost({ windowInstanceId: second.record.windowInstanceId, hostEpoch: second.record.hostEpoch }).released).toBe(true)
    expect(router.capacity()).toMatchObject({ targetCount: 0, available: 1 })
  })

  it('④ 隔离：释放一个宿主绝不影响其它仍存活宿主的 target', async () => {
    const { harness, router, directSnapshots } = createRoutedHarness(2)
    const first = await detachPage(harness, 'agents', 960)
    const second = await detachPage(harness, 'settings', 961)
    expect((await harness.handlers.getSnapshot(first.sender)).status).toBe('ok')
    expect((await harness.handlers.getSnapshot(second.sender)).status).toBe('ok')
    expect(router.capacity().targets).toEqual([first.record.windowInstanceId, second.record.windowInstanceId])

    harness.windowRegistry.markDestroyed({ windowInstanceId: first.record.windowInstanceId })
    expect((await harness.handlers.getSnapshot(second.sender)).status).toBe('ok')
    expect(router.capacity().targets).toEqual([second.record.windowInstanceId])
    // 未释放的 target 仍然收得到广播（隔离，不是把整张表清空）
    expect(router.publish({ type: 'persistence-state' }).delivered).toBe(1)
    // 存活宿主的幂等挂载不变：本次读没有重发直发快照
    expect(directSnapshots.filter((entry) => entry === second.record.windowInstanceId)).toHaveLength(1)
  })

  /* ────────────────────────────────────────────────────────────────────────────────────────────
   * PLAT-01 RED：释放的**即时性**与端口的**不可静默**
   *
   * 现状（缺陷）：释放由 `getSnapshot` 里的 `pruneAttachedHosts` 懒触发（另有 `nativeClose`、
   * `reconcileContainerDrift` 两条即时路径），因此「宿主销毁/登记回收 ⇒ target 释放、额度归还」依赖
   * **下一次页窗读**；并且 `release` 端口是可选的 ⇒ 新调用方漏注时**静默不释放**（`maxTargets` 被死宿主
   * 长期占满，该页窗静默降级为仅 IPC 拉取，无任何可见信号）。
   *
   * 判据：
   *  ① registry 回收（`markDestroyed`）当刻即释放：`capacity()` 立刻回落、额度立刻恢复（无需任何读）；
   *  ② 即时释放不破坏 P2-09 幂等：同身份重挂仍恰 1 条直发快照，此后读不再重发；
   *  ③ epoch 守卫：陈旧 epoch 的释放不得误删同窗口新 epoch 的在线订阅与挂载记账；
   *  ⑤ 隔离：释放一个宿主不影响其它宿主的订阅与增量广播。
   * ──────────────────────────────────────────────────────────────────────────────────────────── */

  /** 同身份/新身份重新登记并物化（真机走 store 分配 + registry 采纳；这里直接驱动 registry 权威）。 */
  function remount(harness: Harness, record: WorkspaceWindowRecord, input: { hostEpoch?: number; webContentsId: number }) {
    if (record.workspaceInstanceKey === null) throw new Error('detached page record without workspace instance key')
    expect(harness.windowRegistry.reserveDetachedTabWindow({
      windowInstanceId: record.windowInstanceId,
      hostEpoch: input.hostEpoch ?? record.hostEpoch,
      workspaceInstanceKey: record.workspaceInstanceKey
    }).status).toBe('reserved')
    expect(harness.windowRegistry.attachWebContents({
      windowInstanceId: record.windowInstanceId, webContentsId: input.webContentsId
    }).status).toBe('attached')
    return frameOf(harness.senderFor(input.webContentsId))
  }

  it('PLAT-01① 登记回收当刻即释放（无需下一次页窗读），额度立刻归还', async () => {
    const { harness, router } = createRoutedHarness(1)
    const first = await detachPage(harness, 'agents', 970)
    expect((await harness.handlers.getSnapshot(first.sender)).status).toBe('ok')
    expect(router.capacity()).toMatchObject({ targetCount: 1, available: 0 })

    // 宿主销毁 / 登记回收**当刻**：释放不再依赖下一次读的剪除
    harness.windowRegistry.markDestroyed({ windowInstanceId: first.record.windowInstanceId })
    expect(router.capacity()).toMatchObject({ targetCount: 0, available: 1 })
    expect(harness.handlers.hostSubscriptionStatus()).toEqual({ subscribed: [], degraded: [] })

    // 额度立刻归还：后续页窗无需先被拒一次就能真的订上（拒绝账绝不增长）
    const second = await detachPage(harness, 'settings', 971)
    expect((await harness.handlers.getSnapshot(second.sender)).status).toBe('ok')
    expect(router.capacity()).toMatchObject({ targetCount: 1, rejectedCount: 0, lastRejected: null })
  })

  it('PLAT-01② 即时释放不破坏幂等：同身份重挂仍恰 1 条直发快照', async () => {
    const { harness, router, directSnapshots } = createRoutedHarness(2)
    const first = await detachPage(harness, 'agents', 972)
    for (let round = 0; round < 3; round += 1) {
      expect((await harness.handlers.getSnapshot(first.sender)).status).toBe('ok')
    }
    expect(directSnapshots).toEqual([first.record.windowInstanceId])

    harness.windowRegistry.markDestroyed({ windowInstanceId: first.record.windowInstanceId })
    expect(router.capacity().targetCount).toBe(0)

    // 同身份（同 id 同 epoch）重新登记 + 重挂：恰好多一条直发快照，其后的读不再重发
    const sender = remount(harness, first.record, { webContentsId: 972 })
    for (let round = 0; round < 3; round += 1) {
      expect((await harness.handlers.getSnapshot(sender)).status).toBe('ok')
    }
    expect(directSnapshots).toEqual([first.record.windowInstanceId, first.record.windowInstanceId])
    expect(router.capacity()).toMatchObject({ targetCount: 1, available: 1 })
    expect(harness.handlers.hostSubscriptionStatus()).toEqual({ subscribed: [first.record.windowInstanceId], degraded: [] })
  })

  it('PLAT-01③ 陈旧 epoch 的释放绝不误删同窗口 N+1 的在线订阅与挂载记账', async () => {
    const { harness, router, directSnapshots } = createRoutedHarness(2)
    const first = await detachPage(harness, 'agents', 974)
    expect((await harness.handlers.getSnapshot(first.sender)).status).toBe('ok')

    // 宿主销毁 ⇒ 释放 epoch N（即时）
    harness.windowRegistry.markDestroyed({ windowInstanceId: first.record.windowInstanceId })
    expect(router.capacity().targetCount).toBe(0)

    // 同 id 新 epoch（N+1）重新登记并重挂
    const sender = remount(harness, first.record, { hostEpoch: first.record.hostEpoch + 1, webContentsId: 974 })
    expect((await harness.handlers.getSnapshot(sender)).status).toBe('ok')
    expect(router.capacity()).toMatchObject({ targetCount: 1, available: 1 })
    expect(directSnapshots).toEqual([first.record.windowInstanceId, first.record.windowInstanceId])

    // 迟到的陈旧 epoch 释放：epoch 守卫必须拒绝，绝不动 N+1（订阅与记账都保持）
    harness.handlers.releaseHost({ windowInstanceId: first.record.windowInstanceId, hostEpoch: first.record.hostEpoch })
    expect(router.capacity()).toMatchObject({ targetCount: 1, available: 1 })
    expect(router.capacity().targets).toEqual([first.record.windowInstanceId])
    expect(harness.handlers.hostSubscriptionStatus()).toEqual({ subscribed: [first.record.windowInstanceId], degraded: [] })
    expect(router.publish({ type: 'persistence-state' }).delivered).toBe(1)
    expect(directSnapshots).toEqual([first.record.windowInstanceId, first.record.windowInstanceId])
  })

  it('PLAT-01⑤ 即时释放保持隔离：其它宿主的订阅与增量广播都不变', async () => {
    const { harness, router, directSnapshots } = createRoutedHarness(2)
    const first = await detachPage(harness, 'agents', 976)
    const second = await detachPage(harness, 'settings', 977)
    expect((await harness.handlers.getSnapshot(first.sender)).status).toBe('ok')
    expect((await harness.handlers.getSnapshot(second.sender)).status).toBe('ok')
    expect(router.capacity().targets).toEqual([first.record.windowInstanceId, second.record.windowInstanceId])

    harness.windowRegistry.markDestroyed({ windowInstanceId: first.record.windowInstanceId })
    expect(router.capacity().targets).toEqual([second.record.windowInstanceId])
    expect(router.publish({ type: 'persistence-state' }).delivered).toBe(1)
    expect(harness.handlers.hostSubscriptionStatus()).toEqual({ subscribed: [second.record.windowInstanceId], degraded: [] })
    // 存活宿主仍恰 1 条直发快照（本次释放没有触发任何重挂）
    expect(directSnapshots.filter((entry) => entry === second.record.windowInstanceId)).toHaveLength(1)
    expect((await harness.handlers.getSnapshot(second.sender)).status).toBe('ok')
    expect(directSnapshots.filter((entry) => entry === second.record.windowInstanceId)).toHaveLength(1)
  })
})

/**
 * Owner: platform/desktop/main/workspace。PLAT-01② RED（端口不得静默失败）。
 *
 * 缺陷：`TabWorkspaceIpcDependencies.release` 是**可选**端口 ⇒ 新调用方漏注时静默不释放（`maxTargets`
 * 额度被死宿主长期占用、该页窗静默降级为仅 IPC 拉取、无任何可见信号）。
 *
 * 判据：端口必填 —— 漏注在**类型层**即不可构造（`@ts-expect-error` 断言），并且在**构造期**运行期
 * fail closed（`tabs-release-port-required`，防 JS 调用方/断言绕过类型）；补齐端口即可构造。
 */
describe('tabs ipc: PLAT-01② release 端口必填（漏注绝不静默）', () => {
  it('漏注 release ⇒ 类型层不可构造 + 构造期 fail closed', () => {
    const pageRegistry = createPageRegistry()
    const tabStore = createWorkspaceTabStore({ pageRegistry })
    const windowRegistry = createWorkspaceWindowRegistry()
    // 类型层：release 是必填端口，缺失的依赖对象不可赋给 TabWorkspaceIpcDependencies
    // @ts-expect-error release 缺失即类型层不可构造（PLAT-01②）
    const missingRelease: TabWorkspaceIpcDependencies = { pageRegistry, tabStore, windowRegistry }

    expect(() => createTabWorkspaceIpcHandlers(missingRelease)).toThrow('tabs-release-port-required')
    // 补齐端口（同一份依赖的其它字段逐字不变）即可构造：只拦「漏注」，不给合法调用方添堵
    expect(() => createTabWorkspaceIpcHandlers({ ...missingRelease, release: () => undefined })).not.toThrow()
  })
})
