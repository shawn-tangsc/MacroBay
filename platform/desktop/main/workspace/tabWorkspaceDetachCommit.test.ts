import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { ProductManifest } from '@platform/product-manifest'
import type { WorkspaceEvent } from '@platform/workspace/contracts'
import { WorkspaceOwnershipPolicy } from '@platform/workspace/policies'
import { createSecureWindowSecurity } from '../../window/createMainWindow'
import { composePanelWorkspace } from './composePanelWorkspace'
import {
  createPanelDetachedWindowHost,
  type DetachedHostEvent,
  type DetachedWindowFactory,
  type DetachedWindowHandle
} from './panelDetachedWindowHost'
import { createWorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace（P2-07 focused）。回归：本文件。
 *
 * 权威：P2-06 真机缺陷 B1 —— 页窗从不报 `target-ready` ⇒ `detachTab` 的事务恒停在 awaiting-ready，
 * 10s 后 `schedule(prepareTargetTimeoutMs)` 触发 `rollback → destroyWindow`，真实窗口消失、store 被
 * 漂移收敛回 main。
 *
 * 本文件用**真 compose + 真 tabDetachedWindowHost + 真 store/handlers + 真 router**，只把窗口工厂与定时器
 * 换成注入 fake（不启动 Electron），证明：
 *  1) 页窗能从 `.tabs.getSnapshot` 的受控投影拿到本事务 operationId（身份逐字来自 registry）；
 *  2) `.tabs.hostLifecycle(target-ready)` 被接受后事务走到 **commit**（committed owner = 该页窗；
 *     Tab `mode:'detached'` 归属该窗）；
 *  3) 提交后**手动时钟推进 10s+ 不再发生超时回滚**（窗口仍在、mode 仍 detached、零 fallback）；
 *  4) 真正的加载失败仍回滚 + `window-load-failed` 词表 + 漂移收敛（失败可见、零孤儿）；
 *  5) 非目标窗/伪造 epoch/迟到 ACK 一律 fail closed，绝不推进相位。
 */

const PRELOAD = '/app/preload/index.js'
const APP_ROOT = 'file:///app/renderer'
const ENTRY = 'file:///app/renderer/index.html'
const PAGE_ID = 'sample.overview'
const MAIN_WEBCONTENTS = 1
const PAGE_WEBCONTENTS = 100
const FALLBACK_GUARD_MS = 12_000

const composeManifest = {
  id: 'sample', name: 'Sample', version: '1.0.0',
  shellContributions: {
    menuPages: [{ id: 'overview', title: { 'zh-CN': '总览', 'en-US': 'Overview' }, icon: 'home', order: 1, module: './desktop/pages/overview' }],
    settingsSections: [], panels: []
  },
  routes: [], navigation: [], settingsSections: [], serviceRoutes: [], tools: [], skills: [],
  agents: [], workflows: [], policies: [], evaluations: [], jobHandlers: [], migrations: []
} as unknown as ProductManifest

const roots: string[] = []
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})

type FakeWindow = DetachedWindowHandle & { destroyed: boolean; loadedUrls: string[] }
type Timer = { delayMs: number; run: () => void; cancelled: boolean; dueAt: number }
type SentEvent = { webContentsId: number; event: WorkspaceEvent }

function createHarness(options: { failLoad?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'p2-07-tab-commit-'))
  roots.push(root)
  let sequence = 0
  const handles: FakeWindow[] = []
  const timers: Timer[] = []
  const sent: SentEvent[] = []
  const hostEvents: DetachedHostEvent[] = []
  let clock = 0

  const registry = createWorkspaceWindowRegistry({ createOpaqueId: (prefix) => `${prefix}-${++sequence}` })
  /** 与 app.ts 一致：工厂 `destroy()` 里同步派发 `closed` ⇒ 收敛桥（真机必经路径，缺它会让登记残留）。 */
  let workspaceRef: { mainHostBridge: ReturnType<typeof composePanelWorkspace>['mainHostBridge']; publishHostEvent: ReturnType<typeof composePanelWorkspace>['publishHostEvent'] } | null = null

  const createWindow: DetachedWindowFactory = (input) => {
    const handle: FakeWindow = {
      webContentsId: PAGE_WEBCONTENTS + handles.length, destroyed: false, loadedUrls: [],
      loadURL: (url) => {
        if (handle.destroyed) return Promise.reject(new Error('window-destroyed'))
        handle.loadedUrls.push(url)
        // 「加载失败」只由注入开关决定：其余路径逐字复用真实时序（loadURL 成功后才建 operation）
        return options.failLoad === true ? Promise.reject(new Error('ERR_FAILED')) : Promise.resolve()
      },
      isDestroyed: () => handle.destroyed,
      isCrashed: () => false,
      destroy: () => {
        handle.destroyed = true
        void workspaceRef?.mainHostBridge?.windowDestroyed({ windowInstanceId: input.windowInstanceId })
      },
      focus: () => undefined,
      setWindowOpenHandler: () => undefined
    }
    handles.push(handle)
    return handle
  }

  const timerPort = () => ({
    schedule: (delayMs: number, run: () => void) => {
      const entry: Timer = { delayMs, run, cancelled: false, dueAt: clock + delayMs }
      timers.push(entry)
      return () => { entry.cancelled = true }
    }
  })

  const host = createPanelDetachedWindowHost({
    entryUrl: ENTRY,
    appRoot: APP_ROOT,
    createWindow,
    security: createSecureWindowSecurity({ preload: PRELOAD, openExternal: () => undefined }),
    registry,
    displays: () => [{ id: 'primary', workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
    timers: timerPort(),
    // 与 app.ts 一致：宿主事件先进受控投递（publishHostEvent），再记原始事件用于诊断断言
    onEvent: (event: DetachedHostEvent) => {
      hostEvents.push(event)
      workspaceRef?.publishHostEvent(event)
    }
  })

  /**
   * P2-09/B2 打桩（只记录、行为逐字转发给真宿主）：证明「页窗原生关闭确实走了既有宿主机制」。
   * 冻结对象不能 `vi.spyOn`，故用同形转发包装；真宿主内部状态与语义完全不变。
   */
  const nativeCloseCalls: Array<{ windowInstanceId: string; hostEpoch: number }> = []
  const bridgedHost: typeof host = Object.freeze({
    ...host,
    handleNativeClose: (input: Parameters<typeof host.handleNativeClose>[0]) => {
      nativeCloseCalls.push({ windowInstanceId: input.windowInstanceId, hostEpoch: input.hostEpoch })
      return host.handleNativeClose(input)
    }
  })

  const composition = composePanelWorkspace({
    productManifests: [composeManifest],
    ipcMain: { handle: () => undefined },
    layoutFilePath: join(root, 'workspace', 'panel-layout.json'),
    sendToHost: (webContentsId, event) => {
      // 真机语义：窗口已销毁时投递必然失败（webContents 不存在）⇒ 承载者不可达时退到存活主窗
      if (handles.some((handle) => handle.webContentsId === webContentsId && handle.destroyed)) return false
      sent.push({ webContentsId, event })
      return true
    },
    preferences: { getLanguage: async () => 'zh-CN', getTheme: () => 'light' , getTimeZone: async () => 'UTC'},
    // 与 P1-04 宿主共用**同一个** registry：两个 registry 会让身份采纳/归属判定各看一份（真机只有一份）
    windowRegistry: registry,
    detachedHost: bridgedHost,
    transferTimers: timerPort()
  })
  if (composition.status !== 'ready') throw new Error(`composition disabled: ${composition.reason}`)
  const tabHandlers = composition.tabHandlers
  if (tabHandlers === null) throw new Error('tab handlers not wired')
  workspaceRef = { mainHostBridge: composition.mainHostBridge, publishHostEvent: composition.publishHostEvent }

  const event = (webContentsId: number) => ({
    senderFrame: { parent: null }, sender: { id: webContentsId, isDestroyed: () => false }
  })
  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
  }
  /** 手动时钟：只在请求的窗口内兑现定时器（绝不推进真实时间）。 */
  const advance = async (deltaMs: number): Promise<void> => {
    const target = clock + deltaMs
    for (;;) {
      const next = timers.filter((timer) => !timer.cancelled && timer.dueAt <= target)
        .sort((left, right) => left.dueAt - right.dueAt)[0]
      if (next === undefined) break
      next.cancelled = true
      clock = next.dueAt
      next.run()
      await settle()
    }
    clock = target
    await settle()
  }

  const tabRevision = () => composition.tabStore.getSnapshot().layoutRevision
  const tabOf = (workspaceInstanceKey: string) =>
    composition.tabStore.getSnapshot().tabs.find((tab) => tab.workspaceInstanceKey === workspaceInstanceKey)
  const mainWindow = composition.registerMainWindow({ webContentsId: MAIN_WEBCONTENTS })
  // 与 app.ts 一致：主窗加载完成后挂上受控订阅（否则事件无处投递，「失败可见」会失真）
  const mainAttached = composition.attachMainWindow({ webContentsId: MAIN_WEBCONTENTS })
  if (!mainAttached.attached) throw new Error('main window not attached')

  const openTab = async (requestId = 'req-open'): Promise<string> => {
    const result = await tabHandlers.command(event(MAIN_WEBCONTENTS), {
      method: 'openTab', requestId, expectedRevision: tabRevision(),
      windowInstanceId: mainWindow.windowInstanceId, hostEpoch: mainWindow.hostEpoch, pageId: PAGE_ID
    })
    if (result.status !== 'applied' || result.workspaceInstanceKey === undefined) {
      throw new Error(`openTab failed: ${JSON.stringify(result)}`)
    }
    return result.workspaceInstanceKey
  }

  const detachTab = (workspaceInstanceKey: string, requestId = 'req-detach') => tabHandlers.command(event(MAIN_WEBCONTENTS), {
    method: 'detachTab', requestId, expectedRevision: tabRevision(),
    windowInstanceId: mainWindow.windowInstanceId, hostEpoch: mainWindow.hostEpoch, workspaceInstanceKey
  })

  return {
    composition, tabHandlers, host, handles, sent, hostEvents, timers, nativeCloseCalls,
    registry, mainWindow, event, tabRevision, tabOf, openTab, detachTab, advance, settle,
    liveWindows: () => handles.filter((handle) => !handle.destroyed).length,
    pendingTimerDelays: () => [...new Set(timers.filter((timer) => !timer.cancelled).map((timer) => timer.delayMs))]
  }
}

/** 页窗真实消费的受控投影：`.tabs.getSnapshot` 的 additive `pendingDetach` 字段。 */
function pendingDetachOf(result: Record<string, unknown>): { operationId: string; windowInstanceId: string; hostEpoch: number } | null {
  const value = result.pendingDetach
  return value === null || value === undefined ? null : value as { operationId: string; windowInstanceId: string; hostEpoch: number }
}

describe('P2-07 页窗分离事务：受控投影 → target-ready → commit（10s+ 不回滚）', () => {
  it('提交后 Tab 归属页窗，手动推进 12s 不再回滚、零 fallback、零残留定时器', async () => {
    const harness = createHarness()
    await harness.composition.start()
    const workspaceInstanceKey = await harness.openTab()
    const detached = await harness.detachTab(workspaceInstanceKey)
    expect(detached.status).toBe('applied')

    // 命令只到 awaiting-ready：真实窗口已建、还没有 committed owner
    expect(harness.liveWindows()).toBe(1)
    expect(harness.handles[0]?.loadedUrls).toEqual([ENTRY])
    expect(harness.host.committedOwners()).toEqual([])
    const tab = harness.tabOf(workspaceInstanceKey)
    expect(tab?.mode).toBe('detached')

    // ① 页窗只从受控 `.tabs.getSnapshot` 投影拿到 operationId（身份逐字来自 registry）
    const projected = await harness.tabHandlers.getSnapshot(harness.event(PAGE_WEBCONTENTS))
    if (projected.status !== 'ok') throw new Error('page snapshot rejected')
    expect(projected.snapshot.tabs.map((entry) => entry.workspaceInstanceKey)).toEqual([workspaceInstanceKey])
    const view = pendingDetachOf(projected as unknown as Record<string, unknown>)
    expect(view).toEqual({
      operationId: harness.host.pendingOperationIds()[0],
      windowInstanceId: tab?.windowInstanceId,
      hostEpoch: tab?.hostEpoch
    })

    // ② target-ready ⇒ 主窗身份确认源释放 ⇒ 提交（相位 reserved → awaiting-ready → awaiting-release → committed）
    const ready = await harness.tabHandlers.hostLifecycle(harness.event(PAGE_WEBCONTENTS), {
      operationId: view?.operationId, phase: 'target-ready',
      windowInstanceId: tab?.windowInstanceId, hostEpoch: tab?.hostEpoch
    })
    expect(ready).toEqual({ accepted: true })
    expect(harness.host.committedOwners()).toEqual([workspaceInstanceKey])
    expect(harness.host.pendingOperationIds()).toEqual([])
    expect(harness.registry.listDetachedTabs()).toHaveLength(1)
    expect(harness.registry.listDetachedTabs()[0]?.windowInstanceId).toBe(tab?.windowInstanceId)
    expect(harness.tabOf(workspaceInstanceKey)?.mode).toBe('detached')
    // 相位链可观测：预留(container-change-requested) → 准备期(container-changing) → 提交(host-detach/container-changed)
    const order = harness.hostEvents.map((entry) => entry.type)
    expect(order.indexOf('container-change-requested')).toBeLessThan(order.indexOf('container-changing'))
    expect(order.indexOf('container-changing')).toBeLessThan(order.indexOf('host-detach'))
    expect(order).toContain('container-changed')

    // 提交后受控投影消失（页窗不再有可 ACK 的事务），且页窗仍只看到自己那一个实例
    const committed = await harness.tabHandlers.getSnapshot(harness.event(PAGE_WEBCONTENTS))
    if (committed.status !== 'ok') throw new Error('page snapshot rejected')
    expect(pendingDetachOf(committed as unknown as Record<string, unknown>)).toBeNull()
    expect(committed.snapshot.tabs.map((entry) => entry.workspaceInstanceKey)).toEqual([workspaceInstanceKey])

    // ③ 手动时钟推进 12s（>10s 准备上界）：绝不发生超时回滚
    await harness.advance(FALLBACK_GUARD_MS)
    expect(harness.liveWindows()).toBe(1)
    expect(harness.registry.listDetachedTabs()).toHaveLength(1)
    expect(harness.tabOf(workspaceInstanceKey)?.mode).toBe('detached')
    expect(harness.host.committedOwners()).toEqual([workspaceInstanceKey])
    expect(harness.hostEvents.filter((entry) => entry.type === 'fallback')).toEqual([])
    expect(harness.pendingTimerDelays()).toEqual([])

    // 事件定向：页窗收到 container-changed（增量），提交结论对页窗可见
    expect(harness.sent.some((entry) => entry.webContentsId === PAGE_WEBCONTENTS
      && entry.event.type === 'container-changed')).toBe(true)
    // 无关窗 0 条：Tab 容器的增量绝不投给不是承载者的主窗（主窗只拿自己的作用域事件）
    expect(harness.sent.filter((entry) => entry.webContentsId === MAIN_WEBCONTENTS
      && entry.event.type === 'container-changed'
      && entry.event.scope.workspaceInstanceKey === workspaceInstanceKey)).toHaveLength(0)
  })

  it('真正的加载失败仍然回滚 + window-load-failed 词表 + 补偿收敛（零孤儿、失败可见）', async () => {
    const harness = createHarness({ failLoad: true })
    await harness.composition.start()
    const workspaceInstanceKey = await harness.openTab()
    const detached = await harness.detachTab(workspaceInstanceKey, 'req-detach-fail')
    // 加载失败 ⇒ 绝不报成「applied 且一切正常」
    expect(detached.status).toBe('rejected')
    expect(detached.errorCode).toBe('unsupported')
    expect(harness.liveWindows()).toBe(0)
    expect(harness.registry.listDetachedTabs()).toHaveLength(0)
    expect(harness.host.committedOwners()).toEqual([])
    expect(harness.host.pendingOperationIds()).toEqual([])

    const fallback = harness.hostEvents.filter((entry) => entry.type === 'fallback')
    expect(fallback).toHaveLength(1)
    expect(fallback[0]?.fallbackReason).toBe('window-load-failed')

    // 补偿已把 store 还原到 main（绝不留下「store 说 detached、却没有窗口」）
    expect(harness.tabOf(workspaceInstanceKey)?.mode).toBe('main')
    // 主窗可见失败：fallback 事件按既有词表投递给主窗（承载者已销毁时退到存活主窗，绝不静默丢弃）
    expect(harness.sent.some((entry) => entry.webContentsId === MAIN_WEBCONTENTS
      && entry.event.type === 'fallback' && entry.event.fallbackReason === 'window-load-failed')).toBe(true)
  })

  it('页窗永不到 ready：准备期超时仍回滚，且容器漂移收敛回 main（主窗收到 container-changed）', async () => {
    const harness = createHarness()
    await harness.composition.start()
    const workspaceInstanceKey = await harness.openTab()
    expect((await harness.detachTab(workspaceInstanceKey)).status).toBe('applied')
    expect(harness.tabOf(workspaceInstanceKey)?.mode).toBe('detached')
    expect(harness.liveWindows()).toBe(1)

    await harness.advance(FALLBACK_GUARD_MS)
    expect(harness.liveWindows()).toBe(0)
    expect(harness.registry.listDetachedTabs()).toHaveLength(0)
    expect(harness.host.pendingOperationIds()).toEqual([])
    expect(harness.hostEvents.some((entry) => entry.type === 'fallback' && entry.fallbackReason === 'window-load-failed')).toBe(true)
    // 失败对用户可见：词表为 window-load-failed 的 fallback 投递到存活主窗（承载窗已销毁时退到主窗）
    expect(harness.sent.some((entry) => entry.webContentsId === MAIN_WEBCONTENTS
      && entry.event.type === 'fallback' && entry.event.fallbackReason === 'window-load-failed')).toBe(true)

    // 超时回滚后 store 必须回到 main（窗口销毁桥 + 漂移收敛两条路径都指向同一结论），且收敛入口幂等
    expect(harness.tabOf(workspaceInstanceKey)?.mode).toBe('main')
    expect(await harness.composition.reconcileTabContainers()).toEqual([])
    expect(harness.sent.some((entry) => entry.webContentsId === MAIN_WEBCONTENTS
      && entry.event.type === 'container-changed')).toBe(true)
  })

  it('非目标窗/伪造 epoch/迟到 ACK 一律 fail closed，绝不推进相位', async () => {
    const harness = createHarness()
    await harness.composition.start()
    const workspaceInstanceKey = await harness.openTab()
    await harness.detachTab(workspaceInstanceKey, 'req-detach-acl')
    const tab = harness.tabOf(workspaceInstanceKey)
    const operationId = harness.host.pendingOperationIds()[0] as string
    expect(operationId).toBeDefined()

    // 主窗代发 ⇒ 不是该事务的目标窗
    const fromMain = await harness.tabHandlers.hostLifecycle(harness.event(MAIN_WEBCONTENTS), {
      operationId, phase: 'target-ready', windowInstanceId: tab?.windowInstanceId, hostEpoch: tab?.hostEpoch
    })
    expect(fromMain).toEqual({ accepted: false, reason: 'not-owner' })
    expect(harness.host.committedOwners()).toEqual([])

    // 伪造 epoch ⇒ 声明与 registry 不一致
    const forgedEpoch = await harness.tabHandlers.hostLifecycle(harness.event(PAGE_WEBCONTENTS), {
      operationId, phase: 'target-ready', windowInstanceId: tab?.windowInstanceId, hostEpoch: (tab?.hostEpoch ?? 2) + 1
    })
    expect(forgedEpoch).toEqual({ accepted: false, reason: 'not-owner' })
    expect(harness.host.committedOwners()).toEqual([])

    // 未知 operation ⇒ unknown-operation
    const unknown = await harness.tabHandlers.hostLifecycle(harness.event(PAGE_WEBCONTENTS), {
      operationId: 'op-does-not-exist', phase: 'target-ready', windowInstanceId: tab?.windowInstanceId, hostEpoch: tab?.hostEpoch
    })
    expect(unknown).toEqual({ accepted: false, reason: 'unknown-operation' })

    // 正确 ACK ⇒ 提交；随后迟到/重复 ACK 一律 fail closed 且不复活事务
    expect(await harness.tabHandlers.hostLifecycle(harness.event(PAGE_WEBCONTENTS), {
      operationId, phase: 'target-ready', windowInstanceId: tab?.windowInstanceId, hostEpoch: tab?.hostEpoch
    })).toEqual({ accepted: true })
    const late = await harness.tabHandlers.hostLifecycle(harness.event(PAGE_WEBCONTENTS), {
      operationId, phase: 'target-ready', windowInstanceId: tab?.windowInstanceId, hostEpoch: tab?.hostEpoch
    })
    // 提交后该 operation 已离开 awaiting-ready ⇒ 迟到 ACK 只做判定（未知 operation），绝不复活状态
    expect(late).toEqual({ accepted: false, reason: 'unknown-operation' })
    expect(harness.host.committedOwners()).toEqual([workspaceInstanceKey])
    expect(harness.tabOf(workspaceInstanceKey)?.mode).toBe('detached')
    expect(harness.registry.listDetachedTabs()).toHaveLength(1)
  })

  it('.tabs.* seam surface 不增：通道逐字不变，响应只 additive 一个受控投影', async () => {
    const harness = createHarness()
    await harness.composition.start()
    expect(harness.tabHandlers.channels).toEqual({
      workspaceTabsGetSnapshot: 'platform:workspace-tabs-get-snapshot',
      workspaceTabsCommand: 'platform:workspace-tabs-command',
      workspaceTabsHostLifecycle: 'platform:workspace-tabs-host-lifecycle',
      workspaceEvent: 'platform:workspace-event'
    })
    const workspaceInstanceKey = await harness.openTab()
    const mainView = await harness.tabHandlers.getSnapshot(harness.event(MAIN_WEBCONTENTS))
    expect(Object.keys(mainView).sort()).toEqual(['pendingDetach', 'snapshot', 'status'])
    expect(pendingDetachOf(mainView as unknown as Record<string, unknown>)).toBeNull()
    expect((await harness.detachTab(workspaceInstanceKey)).status).toBe('applied')
    const pageView = await harness.tabHandlers.getSnapshot(harness.event(PAGE_WEBCONTENTS))
    expect(Object.keys(pageView).sort()).toEqual(['pendingDetach', 'snapshot', 'status'])
  })
})

/**
 * Owner: platform/desktop/main/workspace。P2-09/B3 组合级（真 compose + 真 router）。
 *
 * 单元级已证明 `.tabs.getSnapshot` 的挂载调用是 O(1)；这里证明**真 router 的可观测后果**：
 * 直发 snapshot 恰 1 条、listener 恰 1 个、重复读不再产生任何事件（自持闭环断开）。
 */
describe('P2-09 页窗自持 snapshot 风暴（B3）：真 router 的直发快照与 listener 均 O(1)', () => {
  it('连续 50 次页窗 getSnapshot 只直发 1 条 snapshot，listener 恒 1，无关窗 0 条', async () => {
    const harness = createHarness()
    await harness.composition.start()
    const workspaceInstanceKey = await harness.openTab()
    expect((await harness.detachTab(workspaceInstanceKey)).status).toBe('applied')
    const snapshotsTo = (webContentsId: number) => harness.sent.filter((entry) =>
      entry.webContentsId === webContentsId && entry.event.type === 'snapshot')
    // 主窗自己的挂载快照恰 1 条（既有 P2-01 语义），页窗此刻还没有任何事件
    const mainBefore = snapshotsTo(MAIN_WEBCONTENTS).length
    const pageBefore = snapshotsTo(PAGE_WEBCONTENTS).length
    const listenersBefore = harness.composition.router?.targetCount() ?? 0
    expect(pageBefore).toBe(0)

    for (let round = 0; round < 50; round += 1) {
      const view = await harness.tabHandlers.getSnapshot(harness.event(PAGE_WEBCONTENTS))
      expect(view.status).toBe('ok')
    }

    // 首次读触发**一次**挂载 ⇒ 恰 1 条直发 snapshot（RED：每轮一条 ⇒ 50 条）；listener 恰多 1 个且不再增长
    expect(snapshotsTo(PAGE_WEBCONTENTS).length - pageBefore).toBe(1)
    expect(snapshotsTo(MAIN_WEBCONTENTS).length - mainBefore).toBe(0)
    expect((harness.composition.router?.targetCount() ?? 0) - listenersBefore).toBe(1)

    // listener 未被重复注册：一条定向增量恰好投递一次（若每轮重订阅/重复注册，这里会 >1）
    const delivered = harness.composition.router?.publish({
      type: 'container-changed', scope: { workspaceInstanceKey }
    }).delivered
    expect(delivered).toBe(1)
    expect(harness.sent.filter((entry) => entry.webContentsId === PAGE_WEBCONTENTS
      && entry.event.type === 'container-changed')).toHaveLength(1)

    // 提交后继续零交互读 50 次：任何窗都不再新增事件（页窗自持增长彻底消失）
    const totalBefore = harness.sent.length
    expect(await harness.tabHandlers.hostLifecycle(harness.event(PAGE_WEBCONTENTS), {
      operationId: harness.host.pendingOperationIds()[0], phase: 'target-ready',
      windowInstanceId: harness.tabOf(workspaceInstanceKey)?.windowInstanceId,
      hostEpoch: harness.tabOf(workspaceInstanceKey)?.hostEpoch
    })).toEqual({ accepted: true })
    const committedTotal = harness.sent.length
    for (let round = 0; round < 50; round += 1) {
      expect((await harness.tabHandlers.getSnapshot(harness.event(PAGE_WEBCONTENTS))).status).toBe('ok')
    }
    expect(harness.sent.length).toBe(committedTotal)
    expect(committedTotal).toBeGreaterThan(totalBefore)
  })
})

/**
 * Owner: platform/desktop/main/workspace。P2-09/B2 RED（P2-06R 真机证据 `/tmp/p2-06r-evidence/`）。
 *
 * 真机缺陷：页窗原生关闭（X）被 `preventDefault`（`defaultPrevented=true`）后窗口 20s 内不销毁、Tab 恒
 * `detached`、无 `container-changed`、`nativeCloseRedocked=false`。根因：`mainHostBridge.nativeClose` 只按
 * `panelInstanceKey` 去**面板 store** 查面板，而页窗记录是 `kind:'detached-tab'` ⇒ `if (!panel) return false`，
 * 宿主 `handleNativeClose` 从不被调用。差分对照：同一 Tab 走 IPC `redockTab` ⇒ 立即 applied/mode:main/窗口销毁。
 *
 * 判据：页窗原生关闭必须走既有宿主机制 ⇒ 窗口销毁、`mode:'main'`、`container-changed`（定向语义不变）、
 * 登记释放、零孤儿；身份（windowInstanceId + hostEpoch）不一致时零触碰。
 */
describe('P2-09 页窗原生关闭（B2）：必须走既有宿主机制并回停靠', () => {
  /** 分离一个 Tab 并提交（真机 X 的对象是「已提交的独立页窗」）。 */
  async function detachAndCommit(harness: ReturnType<typeof createHarness>) {
    await harness.composition.start()
    const workspaceInstanceKey = await harness.openTab()
    expect((await harness.detachTab(workspaceInstanceKey)).status).toBe('applied')
    const tab = harness.tabOf(workspaceInstanceKey)
    expect(await harness.tabHandlers.hostLifecycle(harness.event(PAGE_WEBCONTENTS), {
      operationId: harness.host.pendingOperationIds()[0], phase: 'target-ready',
      windowInstanceId: tab?.windowInstanceId, hostEpoch: tab?.hostEpoch
    })).toEqual({ accepted: true })
    expect(harness.host.committedOwners()).toEqual([workspaceInstanceKey])
    expect(harness.liveWindows()).toBe(1)
    return { workspaceInstanceKey, windowInstanceId: tab?.windowInstanceId as string, hostEpoch: tab?.hostEpoch as number }
  }

  it('原生关闭 ⇒ handleNativeClose 被调用、窗口销毁、mode:main、container-changed、登记释放、零孤儿', async () => {
    const harness = createHarness()
    const keys = await detachAndCommit(harness)

    // 真机 X：工厂 preventDefault 后交给 app 侧桥（唯一入口）
    const handled = await harness.composition.mainHostBridge?.nativeClose({
      windowInstanceId: keys.windowInstanceId, hostEpoch: keys.hostEpoch
    })
    await harness.settle()

    // ① 既有宿主机制真的被调用（打桩记录，不是「猜」）；② 返回被处理；③ 窗口销毁
    // 三者一条断言：真机症状正是「返回 false / handleNativeClose 从未被调用 / 窗口不销毁」同时出现
    expect({
      handled,
      hostNativeCloseCalls: harness.nativeCloseCalls,
      windowDestroyed: harness.handles[0]?.destroyed
    }).toEqual({
      handled: true,
      hostNativeCloseCalls: [{ windowInstanceId: keys.windowInstanceId, hostEpoch: keys.hostEpoch }],
      windowDestroyed: true
    })
    // ② 窗口销毁 + 登记释放 + 零孤儿（共享预算不泄漏）
    expect(harness.liveWindows()).toBe(0)
    expect(harness.registry.listDetachedTabs()).toHaveLength(0)
    expect(harness.registry.listWindows().filter((record) => record.kind !== 'main')).toHaveLength(0)
    expect(harness.host.committedOwners()).toEqual([])
    expect(harness.host.pendingOperationIds()).toEqual([])
    // ③ 回停靠：Tab 必须回到 main（绝不留下「store 说 detached、窗口已消失」）
    expect(harness.tabOf(keys.workspaceInstanceKey)).toMatchObject({
      mode: 'main', open: true, windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId
    })
    // ④ 定向语义不变：container-changed 按该工作区投递给回停靠后的承载者（主窗）
    expect(harness.sent.some((entry) => entry.webContentsId === MAIN_WEBCONTENTS
      && entry.event.type === 'container-changed'
      && entry.event.scope.workspaceInstanceKey === keys.workspaceInstanceKey)).toBe(true)
    // ⑤ 已收敛：漂移收敛入口无事可做，且无残留定时器（回停靠不是失败回退链）
    expect(await harness.composition.reconcileTabContainers()).toEqual([])
    expect(harness.hostEvents.filter((entry) => entry.type === 'fallback')).toEqual([])
    expect(harness.pendingTimerDelays()).toEqual([])
  })

  it('身份不放宽：未知身份/陈旧 epoch 的页窗原生关闭零触碰（绝不销毁在线窗口）', async () => {
    const harness = createHarness()
    const keys = await detachAndCommit(harness)
    const callsBefore = harness.nativeCloseCalls.length

    expect(await harness.composition.mainHostBridge?.nativeClose({
      windowInstanceId: keys.windowInstanceId, hostEpoch: keys.hostEpoch + 1
    })).toBe(false)
    expect(await harness.composition.mainHostBridge?.nativeClose({
      windowInstanceId: 'window-unknown', hostEpoch: keys.hostEpoch
    })).toBe(false)
    await harness.settle()

    // 宿主机制一次都不被调用：陈旧/未知身份在 app 侧桥就 fail closed
    expect(harness.nativeCloseCalls).toHaveLength(callsBefore)
    expect(harness.handles[0]?.destroyed).toBe(false)
    expect(harness.liveWindows()).toBe(1)
    expect(harness.registry.listDetachedTabs()).toHaveLength(1)
    expect(harness.tabOf(keys.workspaceInstanceKey)?.mode).toBe('detached')
    expect(harness.host.committedOwners()).toEqual([keys.workspaceInstanceKey])
  })
})
