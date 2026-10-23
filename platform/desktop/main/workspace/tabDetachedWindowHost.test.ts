import { describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({ openExternal: vi.fn() }))

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: class {},
  shell: { openExternal: electronMocks.openExternal }
}))

import { pathToFileURL } from 'node:url'

import { WorkspaceOwnershipPolicy, WorkspaceTransferPolicy } from '@platform/workspace/policies'
import { createSecureWindowSecurity } from '../../window/createMainWindow'
import {
  createPanelDetachedWindowHost,
  type DetachedHostEvent,
  type DetachedWindowFactory,
  type DetachedWindowHandle
} from './panelDetachedWindowHost'
import { createTabDetachedWindowHost } from './tabDetachedWindowHost'
import { createWorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace。P2-03 受控 Tab 页面窗生命周期矩阵。
 *
 * 本测试的判据全部落在**共享 P1 宿主 + 共享 registry** 的真实结果上（Tab 宿主不复制生命周期）：
 *  - 内置页 Tab 与产品 fixture Tab 各自可分离，且 registry 记录为 `detached-tab`（不污染面板宿主预算表）；
 *  - 父 Tab + 子 panel 双 detached：关闭/回停靠只收敛**本 Tab 所属工作区**的子窗，外来子窗一律拒绝且零触碰；
 *  - release 超时 ⇒ 与面板同一条回滚（销毁窗口 + 释放登记 + 如实报 `content-error`），预算不泄漏；
 *  - 迟到旧回调（rollback/close 之后到达的 ready/released）一律 fail closed，绝不复活状态；
 *  - 共享预算：Tab 与 panel 用同一个 `WorkspaceTransferPolicy.maxDetachedHosts`，零孤儿。
 */

const PRELOAD = '/app/preload/index.js'
const APP_ROOT = 'file:///app/renderer'
const ENTRY = 'file:///app/renderer/index.html'

type FakeWindow = DetachedWindowHandle & { destroyed: boolean; focused: number }

function createFakeWindow(webContentsId: number): FakeWindow {
  const handle: FakeWindow = {
    webContentsId,
    destroyed: false,
    focused: 0,
    isCrashed: () => false,
    loadURL: () => Promise.resolve(),
    isDestroyed: () => handle.destroyed,
    destroy: () => { handle.destroyed = true },
    focus: () => { handle.focused += 1 },
    // 共享安全集合会调用它（`window.open` 一律 deny）；缺失会让建窗被判为 window-create-failed
    setWindowOpenHandler: () => undefined
  }
  return handle
}

function createHarness(overrides: { maxDetachedHosts?: number } = {}) {
  let sequence = 0
  const registry = createWorkspaceWindowRegistry({
    createOpaqueId: (prefix) => `${prefix}-${++sequence}`,
    ...(overrides.maxDetachedHosts === undefined ? {} : { maxDetachedHosts: overrides.maxDetachedHosts })
  })
  const main = registry.registerMainWindow({ webContentsId: 1 })
  const handles: FakeWindow[] = []
  const timers: { delayMs: number; run: () => void; cancelled: boolean }[] = []
  const events: DetachedHostEvent[] = []

  const createWindow: DetachedWindowFactory = () => {
    const handle = createFakeWindow(handles.length + 100)
    handles.push(handle)
    return handle
  }

  // 共享的 P1 宿主实例：Tab 宿主只做身份/语义翻译，不复制任何事务代码
  const sharedHost = createPanelDetachedWindowHost({
    entryUrl: ENTRY,
    appRoot: APP_ROOT,
    createWindow,
    security: createSecureWindowSecurity({ preload: PRELOAD, openExternal: (url) => void electronMocks.openExternal(url) }),
    registry,
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

  const tabHost = createTabDetachedWindowHost({ host: sharedHost, registry })
  return {
    registry, main, handles, timers, events, sharedHost, tabHost,
    fireTimer: (index = 0) => {
      const entry = timers.filter((timer) => !timer.cancelled)[index]
      if (!entry) throw new Error('no pending timer')
      entry.cancelled = true
      entry.run()
    },
    pendingTimerDelays: () => timers.filter((timer) => !timer.cancelled).map((timer) => timer.delayMs),
    liveWindows: () => handles.filter((handle) => !handle.destroyed).length
  }
}

/** 分离一个 Tab：先由调用方（Tab IPC 层）用 store 身份预分配预留，再走共享宿主的真实事务。 */
function requestTabDetach(
  harness: ReturnType<typeof createHarness>,
  input: { operationId: string; workspaceInstanceKey: string; pageId: string; windowInstanceId?: string; hostEpoch?: number }
) {
  const windowInstanceId = input.windowInstanceId ?? `window-tab-${input.workspaceInstanceKey}`
  const hostEpoch = input.hostEpoch ?? WorkspaceOwnershipPolicy.initialHostEpoch + 1
  const reserved = harness.registry.reserveDetachedTabWindow({
    windowInstanceId, hostEpoch, workspaceInstanceKey: input.workspaceInstanceKey
  })
  if (reserved.status === 'rejected') return Promise.resolve({ status: 'rejected' as const, errorCode: reserved.errorCode })
  return harness.tabHost.requestTabDetach({
    operationId: input.operationId,
    workspaceInstanceKey: input.workspaceInstanceKey,
    pageId: input.pageId,
    menuKey: input.pageId,
    title: input.pageId,
    sourceHost: harness.main,
    windowInstanceId,
    hostEpoch,
    savedBounds: { x: 40, y: 60, width: 900, height: 700 }
  })
}

/** 只接受成功预留：测试里把失败直接抛出来，后续断言才有确定的窄化类型。 */
function reserved<T extends { status: string }>(outcome: T): Extract<T, { status: 'reserved' }> {
  if (outcome.status !== 'reserved') throw new Error(`reserve failed: ${JSON.stringify(outcome)}`)
  return outcome as Extract<T, { status: 'reserved' }>
}
/** 只接受 `closed`：`ignored` 直接抛出（否则断言里的窄化类型不成立）。 */
function closedOnly(outcome: {
  status: 'closed' | 'ignored'
}): { status: 'closed'; closedChildWindowIds: readonly string[]; refusedChildWindowIds: readonly string[] } {
  if (outcome.status !== 'closed') throw new Error(`expected closed, got ${JSON.stringify(outcome)}`)
  return outcome as { status: 'closed'; closedChildWindowIds: readonly string[]; refusedChildWindowIds: readonly string[] }
}
/** 只接受 `redocked`。 */
function redockedOnly(outcome: { status: 'redocked' | 'ignored' }): { status: 'redocked'; mode: string } {
  if (outcome.status !== 'redocked') throw new Error(`expected redocked, got ${JSON.stringify(outcome)}`)
  return outcome as never
}

describe('tab detached window host: built-in and product fixture tabs detach independently', () => {
  it('detaches a built-in page tab through the shared P1 host and records a detached-tab container', async () => {
    const harness = createHarness()
    const outcome = await requestTabDetach(harness, { operationId: 'op-builtin', workspaceInstanceKey: 'workspace-builtin', pageId: 'assistants' })

    expect(outcome.status).toBe('awaiting-ready')
    const record = harness.registry.describeWindow(harness.registry.listDetachedTabs()[0]?.windowInstanceId ?? '')
    expect(record?.kind).toBe('detached-tab')
    expect(record?.workspaceInstanceKey).toBe('workspace-builtin')
    expect(record?.webContentsId).toBe(handlesOf(harness))
    // 面板宿主预算表绝不被 Tab 污染（两条 kind 分离，预算共享）
    expect(harness.registry.listDetachedHosts()).toHaveLength(0)
    expect(harness.registry.detachedTabCount()).toBe(1)
    // 事务事件仍由共享宿主发出（Tab 宿主只翻译身份，不重发、不吞掉）
    expect(harness.events.map((event) => event.type)).toContain('container-changing')
  })

  it('detaches a product fixture tab independently and keeps both owners alive', async () => {
    const harness = createHarness()
    const builtin = await requestTabDetach(harness, { operationId: 'op-a', workspaceInstanceKey: 'workspace-a', pageId: 'agents' })
    const product = await requestTabDetach(harness, { operationId: 'op-b', workspaceInstanceKey: 'workspace-b', pageId: 'market-intelligence.dashboard' })

    expect([builtin.status, product.status]).toEqual(['awaiting-ready', 'awaiting-ready'])
    expect(harness.registry.detachedTabCount()).toBe(2)
    expect(harness.tabHost.committedOwners()).toHaveLength(0)
    expect([...harness.tabHost.pendingOperationIds()].sort()).toEqual(['op-a', 'op-b'])
  })

  it('fails closed when the caller did not pre-allocate the tab identity (never invents a container)', async () => {
    const harness = createHarness()
    const outcome = await harness.tabHost.requestTabDetach({
      operationId: 'op-none', workspaceInstanceKey: 'workspace-none', pageId: 'assistants', menuKey: 'assistants',
      title: 'Assistants', sourceHost: harness.main
    })
    expect(outcome.status).toBe('rejected')
    expect(harness.registry.detachedTabCount()).toBe(0)
    expect(harness.liveWindows()).toBe(0)
  })
})

function handlesOf(harness: ReturnType<typeof createHarness>): number {
  const handle = harness.handles[0]
  if (!handle) throw new Error('no window created')
  return handle.webContentsId
}

describe('tab detached window host: parent tab plus child panel double detach', () => {
  it('commits both and converges only the tab-owned child panel window on logical close', async () => {
    const harness = createHarness()
    const outcome = await requestTabDetach(harness, { operationId: 'op-parent', workspaceInstanceKey: 'workspace-parent', pageId: 'agents' })
    expect(outcome.status).toBe('awaiting-ready')
    const tabRecord = harness.registry.listDetachedTabs()[0]
    const tabWindow = tabRecord.windowInstanceId
    const tabEpoch = tabRecord.hostEpoch

    // 同一工作区的子面板（共享同一个 registry，走 P1 面板预留）
    const child = reserved(harness.registry.reserveDetachedWindow({ hostEpoch: 2, panelInstanceKey: 'panel-child', workspaceInstanceKey: 'workspace-parent' }))
    expect(child.status).toBe('reserved')
    // 外来工作区的子面板：与本 Tab 无关，任何路径都不得触碰
    const foreign = reserved(harness.registry.reserveDetachedWindow({ hostEpoch: 2, panelInstanceKey: 'panel-foreign', workspaceInstanceKey: 'workspace-other' }))
    expect(foreign.status).toBe('reserved')

    const closed = closedOnly(harness.tabHost.closeDetachedTab({
      windowInstanceId: tabWindow, hostEpoch: tabEpoch,
      childPanelWindowInstanceIds: [child.record.windowInstanceId, foreign.record.windowInstanceId]
    }))

    expect(closed.status).toBe('closed')
    expect(closed.closedChildWindowIds).toEqual([child.record.windowInstanceId])
    // 权限语义：外来工作区的子窗被拒绝且**零触碰**（登记与窗口都还在）
    expect(closed.refusedChildWindowIds).toEqual([foreign.record.windowInstanceId])
    expect(harness.registry.describeWindow(foreign.record.windowInstanceId)).toBeDefined()
    expect(harness.registry.describeWindow(child.record.windowInstanceId)).toBeUndefined()
    expect(harness.registry.detachedTabCount()).toBe(0)
    // 逻辑关闭：共享宿主必须记住「面板命令关闭」意图（绝不 redock、绝不补发 fallback）
    expect(harness.sharedHost.closedByPanelCommand(tabWindow)).toBe(true)
  })

  it('rehomes the tab to the main window on user redock without touching child panel windows', async () => {
    const harness = createHarness()
    await requestTabDetach(harness, { operationId: 'op-rehome', workspaceInstanceKey: 'workspace-rehome', pageId: 'settings' })
    const tabRecord = harness.registry.listDetachedTabs()[0]
    const child = reserved(harness.registry.reserveDetachedWindow({ hostEpoch: 2, panelInstanceKey: 'panel-keep', workspaceInstanceKey: 'workspace-rehome' }))

    const rehome = redockedOnly(harness.tabHost.rehomeTabToMain({ windowInstanceId: tabRecord.windowInstanceId, hostEpoch: tabRecord.hostEpoch }))

    expect(rehome.status).toBe('redocked')
    expect(rehome.mode).toBe('embedded')
    // 用户回停靠意图被共享宿主记录（app 侧据此只开一条回停靠事务）
    expect(harness.sharedHost.redockedByUser(tabRecord.windowInstanceId)).toBe('embedded')
    // 子面板窗不受回停靠影响（它有自己的归宿）
    expect(harness.registry.describeWindow(child.record.windowInstanceId)).toBeDefined()
    expect(harness.registry.detachedTabCount()).toBe(0)
  })

  it('refuses close from a stale epoch and never touches the live tab window', async () => {
    const harness = createHarness()
    await requestTabDetach(harness, { operationId: 'op-stale', workspaceInstanceKey: 'workspace-stale', pageId: 'agents', hostEpoch: 2 })
    const tabRecord = harness.registry.listDetachedTabs()[0]

    const closed = harness.tabHost.closeDetachedTab({ windowInstanceId: tabRecord.windowInstanceId, hostEpoch: 99 })

    expect(closed.status).toBe('ignored')
    if (closed.status !== 'ignored') throw new Error('unreachable')
    expect(closed.reason).toBe('epoch-mismatch')
    expect(harness.registry.describeWindow(tabRecord.windowInstanceId)).toBeDefined()
    expect(harness.liveWindows()).toBe(1)
  })
})

describe('tab detached window host: release timeout, late callbacks and zero orphans', () => {
  it('rolls back with content-error when the source release times out and releases the shared budget', async () => {
    const harness = createHarness()
    const outcome = await requestTabDetach(harness, { operationId: 'op-timeout', workspaceInstanceKey: 'workspace-timeout', pageId: 'agents' })
    expect(outcome.status).toBe('awaiting-ready')
    const tabRecord = harness.registry.listDetachedTabs()[0]

    const ready = harness.tabHost.confirmTargetReady({
      operationId: 'op-timeout', windowInstanceId: tabRecord.windowInstanceId, hostEpoch: tabRecord.hostEpoch
    })
    expect(ready).toEqual({ accepted: true })
    // 目标就绪后挂上的截止时间就是平台释放上界（不是自造时长）
    expect(harness.pendingTimerDelays()).toEqual([WorkspaceTransferPolicy.releaseTimeoutMs])

    harness.fireTimer()

    // 与面板同一条回滚：窗口销毁、登记释放、如实报 content-error
    expect(harness.liveWindows()).toBe(0)
    expect(harness.registry.detachedTabCount()).toBe(0)
    expect(harness.registry.describeWindow(tabRecord.windowInstanceId)).toBeUndefined()
    const fallback = harness.events.filter((event) => event.type === 'fallback')
    expect(fallback).toHaveLength(1)
    expect(fallback[0].fallbackReason).toBe('content-error')
    // 预算不泄漏：超时后同一身份预算可再次使用
    const again = harness.registry.reserveDetachedTabWindow({
      windowInstanceId: 'window-after-timeout', hostEpoch: 2, workspaceInstanceKey: 'workspace-timeout'
    })
    expect(again.status).toBe('reserved')
  })

  it('fails closed on late ready/released callbacks arriving after a rollback', async () => {
    const harness = createHarness()
    await requestTabDetach(harness, { operationId: 'op-late', workspaceInstanceKey: 'workspace-late', pageId: 'agents' })
    const tabRecord = harness.registry.listDetachedTabs()[0]
    const claim = { operationId: 'op-late', windowInstanceId: tabRecord.windowInstanceId, hostEpoch: tabRecord.hostEpoch }

    harness.tabHost.confirmTargetReady(claim)
    harness.fireTimer() // 超时回滚

    // 迟到的旧回调：绝不被当成有效 ACK，绝不复活事务或状态
    expect(harness.tabHost.confirmSourceReleased(claim)).toEqual({ accepted: false, reason: 'orphaned' })
    expect(harness.tabHost.confirmTargetReady(claim)).toEqual({ accepted: false, reason: 'orphaned' })
    expect(harness.tabHost.pendingOperationIds()).toEqual([])
    expect(harness.tabHost.committedOwners()).toEqual([])
    expect(harness.registry.detachedTabCount()).toBe(0)
    // 孤儿身份只回收，绝不新建窗口
    expect(harness.liveWindows()).toBe(0)
  })

  it('fails closed on a late released callback that carries a fresh epoch for the same window id', async () => {
    const harness = createHarness()
    await requestTabDetach(harness, { operationId: 'op-epoch', workspaceInstanceKey: 'workspace-epoch', pageId: 'agents' })
    const tabRecord = harness.registry.listDetachedTabs()[0]
    harness.tabHost.confirmTargetReady({ operationId: 'op-epoch', windowInstanceId: tabRecord.windowInstanceId, hostEpoch: tabRecord.hostEpoch })

    // 旧 operationId + 错 epoch：绝不放行（fail closed），也不销毁在线窗口
    expect(harness.tabHost.confirmSourceReleased({
      operationId: 'op-epoch', windowInstanceId: tabRecord.windowInstanceId, hostEpoch: tabRecord.hostEpoch + 1
    })).toEqual({ accepted: false, reason: 'epoch-mismatch' })
    expect(harness.liveWindows()).toBe(1)
    expect(harness.registry.detachedTabCount()).toBe(1)
  })

  it('commits after target ready plus source released and keeps exactly one owner', async () => {
    const harness = createHarness()
    await requestTabDetach(harness, { operationId: 'op-commit', workspaceInstanceKey: 'workspace-commit', pageId: 'agents' })
    const tabRecord = harness.registry.listDetachedTabs()[0]
    const claim = { operationId: 'op-commit', windowInstanceId: tabRecord.windowInstanceId, hostEpoch: tabRecord.hostEpoch }

    harness.tabHost.confirmTargetReady(claim)
    expect(harness.tabHost.confirmSourceReleased(claim)).toEqual({
      accepted: true,
      outcome: { status: 'committed', operationId: 'op-commit', windowInstanceId: tabRecord.windowInstanceId, hostEpoch: tabRecord.hostEpoch }
    })
    expect(harness.tabHost.committedOwners()).toEqual(['workspace-commit'])
    // 重复 ACK 一律拒绝（幂等失败面）
    expect(harness.tabHost.confirmSourceReleased(claim)).toEqual({ accepted: false, reason: 'already-committed' })
    // 已提交后再次采纳同一身份：registry 一律拒绝（身份只采纳一次），绝不新建第二个窗口
    const again = await requestTabDetach(harness, {
      operationId: 'op-commit-2', workspaceInstanceKey: 'workspace-commit', pageId: 'agents',
      windowInstanceId: tabRecord.windowInstanceId, hostEpoch: tabRecord.hostEpoch
    })
    expect(again).toEqual({ status: 'rejected', errorCode: 'duplicate-identity' })
    expect(harness.registry.detachedTabCount()).toBe(1)
    expect(harness.liveWindows()).toBe(1)
  })
})

describe('tab detached window host: shared budget and zero orphans', () => {
  it('counts tab and panel windows against the same bounded budget', async () => {
    const harness = createHarness({ maxDetachedHosts: 1 })
    await requestTabDetach(harness, { operationId: 'op-budget', workspaceInstanceKey: 'workspace-budget', pageId: 'agents' })
    expect(harness.registry.detachedTabCount()).toBe(1)
    // 面板与 Tab 共享 `maxDetachedHosts`，没有第二套预算
    expect(harness.registry.reserveDetachedWindow({ hostEpoch: 2, panelInstanceKey: 'panel-x', workspaceInstanceKey: 'workspace-x' }))
      .toEqual({ status: 'rejected', errorCode: 'limit-reached' })
    expect(harness.registry.reserveDetachedTabWindow({
      windowInstanceId: 'window-over-budget', hostEpoch: 2, workspaceInstanceKey: 'workspace-y'
    })).toEqual({ status: 'rejected', errorCode: 'limit-reached' })
  })

  it('destroys every window it created on the app-exit path (zero orphans, intents released)', async () => {
    const harness = createHarness()
    await requestTabDetach(harness, { operationId: 'op-exit-a', workspaceInstanceKey: 'workspace-exit-a', pageId: 'agents' })
    await requestTabDetach(harness, { operationId: 'op-exit-b', workspaceInstanceKey: 'workspace-exit-b', pageId: 'settings' })
    expect(harness.registry.detachedTabCount()).toBe(2)

    const summary = await harness.sharedHost.appExit({ flush: () => undefined })

    expect(summary.flushOutcome).toBe('flushed')
    expect(summary.destroyedWindowIds).toHaveLength(2)
    expect(harness.liveWindows()).toBe(0)
    expect(harness.registry.detachedTabCount()).toBe(0)
    expect(harness.tabHost.pendingOperationIds()).toEqual([])
  })

  it('destroys the window and releases the reservation when the shared host fails to load the entry', async () => {
    const harness = createHarness()
    const failing = createPanelDetachedWindowHost({
      entryUrl: ENTRY,
      appRoot: APP_ROOT,
      createWindow: ((input: { }) => {
        const handle = createFakeWindow(500)
        handle.loadURL = () => Promise.reject(new Error('load-failed'))
        void input
        return handle
      }) as unknown as DetachedWindowFactory,
      security: createSecureWindowSecurity({ preload: PRELOAD, openExternal: (url) => void electronMocks.openExternal(url) }),
      registry: harness.registry,
      displays: () => [{ id: 'primary', workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
      timers: { schedule: () => () => undefined }
    })
    const host = createTabDetachedWindowHost({ host: failing, registry: harness.registry })
    const reserved = harness.registry.reserveDetachedTabWindow({
      windowInstanceId: 'window-load-fail', hostEpoch: 2, workspaceInstanceKey: 'workspace-load-fail'
    })
    expect(reserved.status).toBe('reserved')

    const outcome = await host.requestTabDetach({
      operationId: 'op-load-fail', workspaceInstanceKey: 'workspace-load-fail', pageId: 'agents',
      menuKey: 'agents', title: 'Agents', sourceHost: harness.main,
      windowInstanceId: 'window-load-fail', hostEpoch: 2
    })

    expect(outcome.status).toBe('rolled-back')
    expect(harness.registry.detachedTabCount()).toBe(0)
    expect(harness.liveWindows()).toBe(0)
  })
})

describe('tab detached window host: reservation adoption is bounded and one-shot', () => {
  it('adopts the caller-allocated identity once and never re-uses it for a later detach', async () => {
    const harness = createHarness()
    const first = await requestTabDetach(harness, {
      operationId: 'op-adopt-1', workspaceInstanceKey: 'workspace-adopt', pageId: 'agents', windowInstanceId: 'window-adopt', hostEpoch: 2
    })
    expect(first.status).toBe('awaiting-ready')
    // 采纳：真实容器身份 == store 分配的身份（绝不另发一个）
    expect(harness.registry.describeWindow('window-adopt')?.hostEpoch).toBe(2)
    expect(harness.registry.listDetachedTabs()[0]?.windowInstanceId).toBe('window-adopt')

    // 身份已消费：第二次用同一身份预留必须被拒绝（绝不复用已登记身份）
    expect(harness.registry.reserveDetachedTabWindow({
      windowInstanceId: 'window-adopt', hostEpoch: 2, workspaceInstanceKey: 'workspace-adopt-2'
    })).toEqual({ status: 'rejected', errorCode: 'duplicate-identity' })
    void pathToFileURL
  })

  it('fails closed when the store-allocated epoch is not the container epoch the shared host derives', async () => {
    const harness = createHarness()
    const reserved = harness.registry.reserveDetachedTabWindow({
      windowInstanceId: 'window-epoch-drift', hostEpoch: 7, workspaceInstanceKey: 'workspace-epoch-drift'
    })
    expect(reserved.status).toBe('reserved')

    const outcome = await harness.tabHost.requestTabDetach({
      operationId: 'op-epoch-drift', workspaceInstanceKey: 'workspace-epoch-drift', pageId: 'agents',
      menuKey: 'agents', title: 'Agents', sourceHost: harness.main,
      windowInstanceId: 'window-epoch-drift', hostEpoch: 7
    })

    // 绝不允许静默分叉（store epoch ≠ 宿主派生 epoch ⇒ 采纳不会发生 ⇒ 必须 fail closed，零窗口）
    expect(outcome).toEqual({ status: 'rejected', operationId: 'op-epoch-drift', errorCode: 'invalid-request' })
    expect(harness.liveWindows()).toBe(0)
    expect(harness.registry.listDetachedHosts()).toHaveLength(0)
  })
})

/**
 * P2-07：页窗 ACK 的**受控 operationId 投影**（`pendingTabOperation`）。
 * 判据全部来自「共享宿主的真实事务是否仍未提交」+ registry 身份逐字一致：它只回答身份映射，
 * 绝不代替 `hostLifecycle` 的准入，也绝不复制相位状态机。
 */
describe('tab detached window host: P2-07 页窗 ACK 投影（pendingTabOperation）', () => {
  const recordOf = (harness: ReturnType<typeof createHarness>) => harness.registry.listDetachedTabs()[0]

  it('分离进行中（awaiting-ready）返回本事务 operationId；提交后与回滚后一律 undefined', async () => {
    const harness = createHarness()
    expect(await requestTabDetach(harness, {
      operationId: 'op-projection', workspaceInstanceKey: 'workspace-projection', pageId: 'agents'
    })).toMatchObject({ status: 'awaiting-ready' })
    const record = recordOf(harness)
    if (!record) throw new Error('no detached tab record')

    expect(harness.tabHost.pendingTabOperation({
      windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch
    })).toEqual({ operationId: 'op-projection' })

    // 提交（target-ready ⇒ 源释放 ⇒ commit）：投影随事务收敛而消失
    expect(harness.tabHost.confirmTargetReady({
      operationId: 'op-projection', windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch
    })).toEqual({ accepted: true })
    expect(harness.tabHost.confirmSourceReleased({
      operationId: 'op-projection', windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch
    })).toMatchObject({ accepted: true })
    expect(harness.tabHost.pendingTabOperation({
      windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch
    })).toBeUndefined()
    // 提交后迟到查询绝不复活：窗口身份仍在，但事务已提交 ⇒ 没有待 ACK 目标
    expect(harness.tabHost.committedOwners()).toEqual(['workspace-projection'])

    // 回滚路径：超时 ⇒ 窗口销毁、登记回收，投影同样消失（零幽灵 ACK）
    const second = createHarness()
    expect(await requestTabDetach(second, {
      operationId: 'op-rollback', workspaceInstanceKey: 'workspace-rollback', pageId: 'agents'
    })).toMatchObject({ status: 'awaiting-ready' })
    const rollbackRecord = recordOf(second)
    if (!rollbackRecord) throw new Error('no detached tab record')
    second.fireTimer()
    expect(second.liveWindows()).toBe(0)
    expect(second.tabHost.pendingTabOperation({
      windowInstanceId: rollbackRecord.windowInstanceId, hostEpoch: rollbackRecord.hostEpoch
    })).toBeUndefined()
  })

  it('身份/epoch 不匹配或未参与事务的窗口拿不到投影（fail closed，绝不放宽归属）', async () => {
    const harness = createHarness()
    expect(await requestTabDetach(harness, {
      operationId: 'op-identity', workspaceInstanceKey: 'workspace-identity', pageId: 'agents'
    })).toMatchObject({ status: 'awaiting-ready' })
    const record = recordOf(harness)
    if (!record) throw new Error('no detached tab record')

    // 陈旧 epoch（同一窗口身份的旧回调）
    expect(harness.tabHost.pendingTabOperation({
      windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch + 1
    })).toBeUndefined()
    // 完全无关的身份
    expect(harness.tabHost.pendingTabOperation({
      windowInstanceId: 'window-not-involved', hostEpoch: record.hostEpoch
    })).toBeUndefined()
    // 主窗身份（它不是本事务的目标窗）
    expect(harness.tabHost.pendingTabOperation({
      windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch
    })).toBeUndefined()
    // 正确身份仍可拿到（上面的拒绝不是「一律返回 undefined」）
    expect(harness.tabHost.pendingTabOperation({
      windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch
    })).toEqual({ operationId: 'op-identity' })
  })
})
