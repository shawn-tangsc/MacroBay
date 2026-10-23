import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceEvent } from '@platform/workspace/contracts'
import { createPanelRegistry } from '@platform/workspace/registry/panelRegistry'
import { WorkspaceRegistrationPolicy } from '@platform/workspace/policies'
import { createPanelWorkspaceStore } from '@platform/workspace/runtime/panelWorkspaceStore'
import { createWorkspaceEventRouter } from './workspaceEventRouter'
import {
  createWorkspaceHostSubscriptionLedger,
  type WorkspaceHostSubscriptionLedger
} from './workspaceHostSubscriptionLedger'
import {
  createPanelWorkspaceIpcHandlers,
  type PanelWorkspaceIpcDependencies,
  type WorkspaceIpcSenderEvent
} from './panelWorkspaceIpcHandlers'
import type { WorkspaceWindowRecord, WorkspaceWindowRegistry } from './workspaceWindowRegistry'
import { createWorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace（**PLAT-30** focused）。回归：本文件。
 *
 *
 * 并入项 1（**宿主订阅记账单一出口**）：PLAT-28 的隐式耦合是「面板宿主 target 的额度归还依赖既有
 * `tabWorkspaceIpcHandlers` 的回收通知（未按 kind 过滤，且重试信用可被另一模块的释放误消费）」。
 * 本文件用**真实 router + 真实 registry + 真实共享记账**证明：面板宿主 / 页窗宿主 / 主窗三类订阅者的
 * 挂载、幂等、降级、额度归还与释放全部由同一个出口驱动，互不可分叉、互不串账；未知/陈旧身份的释放
 * 一律不触碰端口（不存在第二套记账在偷偷释放）。
 *
 * 并入项 2（**`attach` 端口未注入不得静默**）：共享记账的 `attach` 端口必填（漏注构造期 fail closed，
 * 与 PLAT-01② 的 `release` 同一取向），面板侧另有与页窗侧对称的只读可见面 `hostSubscriptionStatus()`
 * （未接线时如实降级，绝不谎报已订阅）。
 *
 * 结构判据（router / compose < 500 行）的取证在 `workspacePreferenceChangePublisher.test.ts`。
 */

const PAGE_ID = 'sample.overview'
const PANEL_ID = 'sample.inspector'
const MAIN_WEBCONTENTS = 1

type Harness = ReturnType<typeof createHarness>

function senderFor(webContentsId: number): WorkspaceIpcSenderEvent {
  return { senderFrame: { parent: null }, sender: { id: webContentsId, isDestroyed: () => false } }
}

/** 权威空快照：本文件只关心归属/订阅/额度，内容与偏好无关。 */
const snapshot = () => ({
  layoutRevision: 1, activeWorkspaceInstanceKey: 'workspace-1', panels: [], pageLayouts: [],
  tabs: [] as readonly [], persistenceState: 'saved' as const
})

function createHarness(options: { maxTargets?: number } = {}) {
  let sequence = 0
  const windowRegistry: WorkspaceWindowRegistry = createWorkspaceWindowRegistry({
    createOpaqueId: (prefix) => `${prefix}-${++sequence}`,
    maxDetachedHosts: 8
  })
  const directSnapshots: string[] = []
  const routerTargets = new Map<string, number>()
  const router = createWorkspaceEventRouter({
    getLayoutRevision: () => 1,
    getSnapshot: snapshot,
    send: (windowInstanceId, event: WorkspaceEvent) => {
      if (event.type === 'snapshot') directSnapshots.push(windowInstanceId)
    },
    maxTargets: options.maxTargets ?? 4
  })
  const attach = vi.fn((record: WorkspaceWindowRecord) => {
    const outcome = router.attachHost({ windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch })
    if (outcome.subscribed) routerTargets.set(record.windowInstanceId, record.hostEpoch)
    return outcome.subscribed
  })
  const release = vi.fn((input: { windowInstanceId: string; hostEpoch: number }) => {
    const outcome = router.releaseHost(input)
    if (outcome.released) routerTargets.delete(input.windowInstanceId)
    return outcome.released
  })

  // 真机接线：共享记账的唯一出口。面板 handler 只拿「按 kind 收窄」的端口视图。
  const ledger: WorkspaceHostSubscriptionLedger = createWorkspaceHostSubscriptionLedger({
    windowRegistry, attach, release
  })

  const panelRegistry = createPanelRegistry({ pageIds: [PAGE_ID], moduleIds: [PANEL_ID] })
  panelRegistry.register({
    panelId: PANEL_ID, title: { 'zh-CN': '检查器', 'en-US': 'Inspector' }, icon: 'file-text',
    module: PANEL_ID, pageIds: [PAGE_ID],
    supportedModes: ['embedded', 'docked-right', 'docked-bottom', 'detached'] as const,
    defaultMode: 'embedded' as const, allowMultipleInstances: true,
    minSize: { width: 320, height: 240 }, preferredSize: { width: 480, height: 360 },
    binding: { persistence: 'session' as const, maxKeyBytes: WorkspaceRegistrationPolicy.maxBindingKeyBytes },
    lifecycleEvents: ['open', 'close'] as const
  })
  panelRegistry.seal()
  const runtimeStore = createPanelWorkspaceStore({ panelRegistry, pageIds: [PAGE_ID] })
  const dependencies: PanelWorkspaceIpcDependencies = {
    panelRegistry, pageIds: [PAGE_ID], runtimeStore, windowRegistry,
    preferences: { getLanguage: () => 'zh-CN', getTheme: () => 'dark' , getTimeZone: () => 'UTC'}
  }
  const panelHandlers = createPanelWorkspaceIpcHandlers({
    ...dependencies, attachSubscription: ledger.attachFor('detached-panel')
  })

  const main = windowRegistry.registerMainWindow({ webContentsId: MAIN_WEBCONTENTS })
  return {
    windowRegistry, router, ledger, attach, release, routerTargets, directSnapshots, panelHandlers, main,
    dependencies, mainSender: senderFor(MAIN_WEBCONTENTS),
    /** 预留一个已物化的面板宿主窗（真机由 P1-04 宿主物化 + `attachWebContents`）。 */
    reservePanelHost(input: { hostEpoch: number; panelInstanceKey: string; workspaceInstanceKey: string; webContentsId: number }) {
      const reserved = windowRegistry.reserveDetachedWindow({
        hostEpoch: input.hostEpoch, panelInstanceKey: input.panelInstanceKey, workspaceInstanceKey: input.workspaceInstanceKey
      })
      if (reserved.status !== 'reserved') throw new Error('panel reservation rejected')
      const attached = windowRegistry.attachWebContents({
        windowInstanceId: reserved.record.windowInstanceId, webContentsId: input.webContentsId
      })
      if (attached.status !== 'attached') throw new Error('panel host attach rejected')
      return attached.record
    },
    /** 预留一个已物化的页窗宿主（真机由 `.tabs.detachTab` + 宿主物化驱动）。 */
    reserveTabHost(input: { windowInstanceId: string; hostEpoch: number; workspaceInstanceKey: string; webContentsId: number }) {
      const reserved = windowRegistry.reserveDetachedTabWindow({
        windowInstanceId: input.windowInstanceId, hostEpoch: input.hostEpoch, workspaceInstanceKey: input.workspaceInstanceKey
      })
      if (reserved.status !== 'reserved') throw new Error('tab reservation rejected')
      const attached = windowRegistry.attachWebContents({
        windowInstanceId: reserved.record.windowInstanceId, webContentsId: input.webContentsId
      })
      if (attached.status !== 'attached') throw new Error('tab host attach rejected')
      return attached.record
    },
    /** 面板宿主的受控读（真机＝面板窗 renderer 的 `workspace.getSnapshot`）。 */
    async readPanelHost(record: WorkspaceWindowRecord) {
      if (record.webContentsId === null) throw new Error('panel host without webContents')
      return panelHandlers.getSnapshot(senderFor(record.webContentsId))
    }
  }
}

describe('PLAT-30 并入项 1：宿主订阅记账单一出口（面板宿主 / 页窗宿主 / 主窗）', () => {
  it('同一共享出口同时结算三类订阅者：面板宿主销毁只归还它自己的额度与目标，页窗与主窗不受影响', async () => {
    const harness = createHarness({ maxTargets: 4 })
    const tabPort = harness.ledger.attachFor('detached-tab')

    // 三类订阅者：主窗（既有 router 直挂）+ 面板宿主 + 页窗宿主
    expect(harness.router.attachHost({
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch
    }).subscribed).toBe(true)
    harness.routerTargets.set(harness.main.windowInstanceId, harness.main.hostEpoch)

    const panelHost = harness.reservePanelHost({
      hostEpoch: 2, panelInstanceKey: 'panel-1', workspaceInstanceKey: 'workspace-1', webContentsId: 201
    })
    expect((await harness.readPanelHost(panelHost)).status).toBe('ok')
    expect(harness.panelHandlers.hostSubscriptionStatus()).toEqual({ subscribed: [panelHost.windowInstanceId], degraded: [] })

    const tabHost = harness.reserveTabHost({
      windowInstanceId: 'window-tab-1', hostEpoch: 3, workspaceInstanceKey: 'workspace-2', webContentsId: 301
    })
    expect(tabPort.attach(tabHost)).toBe(true)
    expect(harness.ledger.query('detached-tab')).toEqual({ subscribed: [tabHost.windowInstanceId], degraded: [] })

    expect(harness.routerTargets.size).toBe(3)
    expect(harness.router.capacity()).toMatchObject({ maxTargets: 4, targetCount: 3, available: 1 })
    expect(harness.attach).toHaveBeenCalledTimes(2)
    expect(harness.attach.mock.calls.map(([record]) => record.kind)).toEqual(['detached-panel', 'detached-tab'])

    // 面板宿主销毁：同一个出口当刻结算（额度立刻归还、目标立刻清掉、只动面板这一类）
    harness.windowRegistry.markDestroyed({ windowInstanceId: panelHost.windowInstanceId })
    expect(harness.release).toHaveBeenCalledTimes(1)
    expect(harness.release).toHaveBeenCalledWith({ windowInstanceId: panelHost.windowInstanceId, hostEpoch: 2 })
    expect(harness.routerTargets.has(panelHost.windowInstanceId)).toBe(false)
    expect(harness.router.capacity()).toMatchObject({ targetCount: 2, available: 2 })
    expect(harness.panelHandlers.hostSubscriptionStatus()).toEqual({ subscribed: [], degraded: [] })
    expect(harness.ledger.query('detached-tab')).toEqual({ subscribed: [tabHost.windowInstanceId], degraded: [] })
    // 主窗的订阅绝不被另一个 kind 的回收误释放
    expect(harness.routerTargets.has(harness.main.windowInstanceId)).toBe(true)
    expect(harness.router.publish({ type: 'persistence-state' }).delivered).toBe(2)
  })

  it('同一共享出口结算页窗销毁与身份替换：陈旧 epoch 的迟到释放绝不误删同窗口新 epoch 的在线订阅', () => {
    const harness = createHarness()
    const tabPort = harness.ledger.attachFor('detached-tab')

    const tabHost = harness.reserveTabHost({
      windowInstanceId: 'window-tab-1', hostEpoch: 2, workspaceInstanceKey: 'workspace-2', webContentsId: 301
    })
    expect(tabPort.attach(tabHost)).toBe(true)
    expect(harness.ledger.query('detached-tab')).toEqual({ subscribed: [tabHost.windowInstanceId], degraded: [] })

    harness.windowRegistry.markDestroyed({ windowInstanceId: tabHost.windowInstanceId })
    expect(harness.release).toHaveBeenCalledWith({ windowInstanceId: tabHost.windowInstanceId, hostEpoch: 2 })
    expect(harness.ledger.query('detached-tab')).toEqual({ subscribed: [], degraded: [] })

    // 同 id 新 epoch 重新登记并挂载
    const replaced = harness.reserveTabHost({
      windowInstanceId: 'window-tab-1', hostEpoch: 3, workspaceInstanceKey: 'workspace-2', webContentsId: 302
    })
    expect(tabPort.attach(replaced)).toBe(true)
    expect(harness.ledger.query('detached-tab')).toEqual({ subscribed: [replaced.windowInstanceId], degraded: [] })

    // 迟到的陈旧 epoch 释放：epoch 守卫拒绝，绝不动 N+1 的在线订阅与记账（也不重复调端口）
    const releaseCallsBefore = harness.release.mock.calls.length
    harness.ledger.releaseHost({ windowInstanceId: 'window-tab-1', hostEpoch: 2 })
    expect(harness.release.mock.calls.length).toBe(releaseCallsBefore)
    expect(harness.ledger.query('detached-tab')).toEqual({ subscribed: [replaced.windowInstanceId], degraded: [] })
    expect(harness.routerTargets.get('window-tab-1')).toBe(3)
  })

  it('降级宿主的重试信用属于同一出口的同一件事：一次真实释放只够重试一次，绝不按读次数放大、绝不跨 kind 串账', () => {
    const harness = createHarness({ maxTargets: 1 })
    const panelPort = harness.ledger.attachFor('detached-panel')
    const tabPort = harness.ledger.attachFor('detached-tab')

    // 额度被面板宿主占满
    const panelHost = harness.reservePanelHost({
      hostEpoch: 5, panelInstanceKey: 'panel-1', workspaceInstanceKey: 'workspace-1', webContentsId: 201
    })
    expect(panelPort.attach(panelHost)).toBe(true)
    expect(harness.router.capacity()).toMatchObject({ targetCount: 1, available: 0 })

    // 页窗宿主挂载被拒 ⇒ 降级**可见**（绝不静默），且不会被谎报为已订阅
    const tabHost = harness.reserveTabHost({
      windowInstanceId: 'window-tab-1', hostEpoch: 6, workspaceInstanceKey: 'workspace-2', webContentsId: 301
    })
    expect(tabPort.attach(tabHost)).toBe(false)
    expect(harness.ledger.query('detached-tab')).toEqual({ subscribed: [], degraded: [tabHost.windowInstanceId] })
    expect(harness.router.capacity()).toMatchObject({ rejectedCount: 1, available: 0 })

    // 面板宿主被回收 ⇒ 恰一个真实释放信用；页窗宿主**下一次**挂载恰好重试一次并成功（额度归还）
    harness.windowRegistry.markDestroyed({ windowInstanceId: panelHost.windowInstanceId })
    expect(harness.release).toHaveBeenCalledWith({ windowInstanceId: panelHost.windowInstanceId, hostEpoch: 5 })
    expect(harness.ledger.query('detached-tab')).toEqual({ subscribed: [], degraded: [tabHost.windowInstanceId] })
    expect(tabPort.attach(tabHost)).toBe(true)
    expect(harness.ledger.query('detached-tab')).toEqual({ subscribed: [tabHost.windowInstanceId], degraded: [] })
    expect(harness.router.capacity()).toMatchObject({ targetCount: 1, available: 0 })

    // 信用已消费：再读不再触发任何挂载/释放副作用（重试由释放驱动，绝不由读次数驱动）
    const attachCalls = harness.attach.mock.calls.length
    expect(tabPort.attach(tabHost)).toBe(true)
    expect(harness.attach.mock.calls.length).toBe(attachCalls)
    expect(harness.release.mock.calls.length).toBe(1)
  })

  it('释放只来自这一个出口：未知/陈旧身份的释放一律不触碰端口（无第二套记账偷偷释放）', () => {
    const harness = createHarness()
    const panelPort = harness.ledger.attachFor('detached-panel')
    const panelHost = harness.reservePanelHost({
      hostEpoch: 7, panelInstanceKey: 'panel-1', workspaceInstanceKey: 'workspace-1', webContentsId: 201
    })
    expect(panelPort.attach(panelHost)).toBe(true)
    expect(harness.routerTargets.size).toBe(1)

    harness.windowRegistry.markDestroyed({ windowInstanceId: panelHost.windowInstanceId })
    expect(harness.release).toHaveBeenCalledTimes(1)

    // 另一个（独立）共享记账实例对同一 registry 上的同一批登记**没有**记账：
    // 它既不重复释放、也绝不对未知身份盲调端口（回收派发点与记账同源）
    const second = createWorkspaceHostSubscriptionLedger({
      windowRegistry: harness.windowRegistry, attach: () => true, release: harness.release
    })
    const otherHost = harness.reservePanelHost({
      hostEpoch: 8, panelInstanceKey: 'panel-2', workspaceInstanceKey: 'workspace-1', webContentsId: 202
    })
    expect(second.attachFor('detached-panel').attach(otherHost)).toBe(true)
    expect(harness.attach).toHaveBeenCalledTimes(1)
    harness.windowRegistry.markDestroyed({ windowInstanceId: otherHost.windowInstanceId })
    expect(harness.release).toHaveBeenCalledTimes(2)
    second.releaseHost({ windowInstanceId: 'window-unknown', hostEpoch: 1 })
    second.releaseHost({ windowInstanceId: panelHost.windowInstanceId, hostEpoch: 7 })
    expect(harness.release).toHaveBeenCalledTimes(2)
  })
})

describe('PLAT-30 并入项 2：attach 端口未注入不得静默（必填 + 面板侧只读可见面）', () => {
  it('共享出口的 attach 端口必填：漏注在类型层不可构造，构造期 fail closed', () => {
    const windowRegistry = createWorkspaceWindowRegistry()
    const release = () => true
    // 类型层：attach 是必填端口（与 PLAT-01② 的 release 同一取向）
    // @ts-expect-error attach 缺失即类型层不可构造（PLAT-30 并入项 2）
    const missingAttach: Parameters<typeof createWorkspaceHostSubscriptionLedger>[0] = { windowRegistry, release }

    expect(() => createWorkspaceHostSubscriptionLedger(missingAttach))
      .toThrow('workspace-host-subscription-attach-required')
    expect(() => createWorkspaceHostSubscriptionLedger({ windowRegistry, release, attach: () => true })).not.toThrow()
  })

  it('面板侧只读可见面与页窗侧对称：未接线时如实降级（不谎报已订阅），接线状态可见', async () => {
    const harness = createHarness()
    const unwired = createPanelWorkspaceIpcHandlers(harness.dependencies)
    expect(unwired.hostSubscriptionStatus()).toEqual({ subscribed: [], degraded: [] })
    const host = harness.reservePanelHost({
      hostEpoch: 9, panelInstanceKey: 'panel-1', workspaceInstanceKey: 'workspace-1', webContentsId: 201
    })
    expect(harness.attach).not.toHaveBeenCalled()
    expect((await unwired.getSnapshot(senderFor(201))).status).toBe('ok')
    // 受控读是挂载点：端口未接线 ⇒ 如实记为降级（**可见**），绝不静默
    expect(harness.attach).not.toHaveBeenCalled()
    expect(unwired.hostSubscriptionStatus()).toEqual({ subscribed: [], degraded: [host.windowInstanceId] })

    // 接线后：同一身份只挂载一次，且可见面如实报已订阅
    const wired = createPanelWorkspaceIpcHandlers({
      ...harness.dependencies, attachSubscription: harness.ledger.attachFor('detached-panel')
    })
    const wiredHost = harness.reservePanelHost({
      hostEpoch: 9, panelInstanceKey: 'panel-2', workspaceInstanceKey: 'workspace-1', webContentsId: 202
    })
    expect((await wired.getSnapshot(senderFor(202))).status).toBe('ok')
    expect(harness.attach).toHaveBeenCalledTimes(1)
    expect(wired.hostSubscriptionStatus()).toEqual({ subscribed: [wiredHost.windowInstanceId], degraded: [] })
  })

  it('面板宿主按身份幂等挂载：N 次受控读恰 1 条直发快照（无自持环），与页窗侧同一套语义', async () => {
    const harness = createHarness()
    const host = harness.reservePanelHost({
      hostEpoch: 11, panelInstanceKey: 'panel-1', workspaceInstanceKey: 'workspace-1', webContentsId: 201
    })
    for (let round = 0; round < 20; round += 1) {
      expect((await harness.readPanelHost(host)).status).toBe('ok')
    }
    expect(harness.attach).toHaveBeenCalledTimes(1)
    expect(harness.directSnapshots).toEqual([host.windowInstanceId])
    expect(harness.router.capacity()).toMatchObject({ targetCount: 1, rejectedCount: 0 })
  })
})
