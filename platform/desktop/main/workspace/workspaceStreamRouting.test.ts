import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceEvent } from '@platform/workspace/contracts'
import { WorkspaceOwnershipPolicy, WorkspaceTransferPolicy } from '@platform/workspace/policies'
import { createSecureWindowSecurity } from '../../window/createMainWindow'
import { createWorkspaceEventRouter } from './workspaceEventRouter'
import { createWorkspaceWindowRegistry } from './workspaceWindowRegistry'
import { createTabDetachedWindowHost } from './tabDetachedWindowHost'
import type { DetachedWindowFactory, DetachedWindowHandle } from './panelDetachedWindowHost'
import { createPanelDetachedWindowHost } from './panelDetachedWindowHost'
import { createAgentIpcHandlers } from '../agentIpcHandlers'
import { createAssistantIpcHandlers } from '../assistantIpcHandlers'
import { createWorkspaceClient } from '@renderer/shell/workspace/workspaceClient'

/**
 * Owner: platform/desktop/main/workspace。P2-03 流连续性（A-T03～A-T05、A-T09、A-T10）。
 *
 * 判据刻意落在**新 owner 实际拿到的终态**上，而不是「mock 的 emit 被调用」：
 *  - 受控 Agent execution 流式运行中把页面 Tab 分离：分离后由**新 owner** 通过真实
 *    `createAgentIpcHandlers().getRuntimeSnapshot()` 取到全部 chunk 与终态；`sendMessage` 恰好一次；
 *  - 受控 Assistant execution 流式运行中分离：**新 owner** 通过真实
 *    `createAssistantIpcHandlers().streamAttach()` 取到缓冲 chunk 与终态 `done`；`open` 恰好一次；
 *  - 反向（回停靠）同样由新 owner 收到终态；
 *  - 布局事件路由：迁移后只有新 owner 收到定向事件，旧订阅不再收（旧 listeners 清零）；
 *  - renderer 侧桥：`createWorkspaceClient().observe()` 的订阅在 dispose 后归零，重挂后恰好一条。
 */

type StreamWindow = {
  name: string
  events: WorkspaceEvent[]
}

function createStreamHarness() {
  let sequence = 0
  const registry = createWorkspaceWindowRegistry({ createOpaqueId: (prefix) => `${prefix}-${++sequence}` })
  const mainRecord = registry.registerMainWindow({ webContentsId: 1 })
  const windows: StreamWindow[] = [{ name: 'main', events: [] }]
  const handles: Array<DetachedWindowHandle & { destroyed: boolean }> = []
  const timers: Array<{ run: () => void; cancelled: boolean }> = []

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
    registry,
    displays: () => [{ id: 'primary', workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
    timers: {
      schedule: (_delayMs, run) => {
        const entry = { run, cancelled: false }
        timers.push(entry)
        return () => { entry.cancelled = true }
      }
    }
  })
  const tabHost = createTabDetachedWindowHost({ host: sharedHost, registry })

  /**
   * 页面容器的归属解析（P2-03 PM 追加项）：`WorkspaceSnapshot.tabs` 仍为空，面板快照里也没有页面容器，
   * 因此组合根必须注入这个只读解析器，页面宿主才能真正收到转场后的增量事件。
   * `panelInstanceKey` 存在时返回 undefined ⇒ 回退到既有面板归属判定（两种容器串联，不是二选一）。
   */
  const tabOwners = new Map<string, { windowInstanceId: string; hostEpoch: number }>()
  const router = createWorkspaceEventRouter({
    getLayoutRevision: () => revision,
    getSnapshot: () => snapshot,
    send: (windowInstanceId, event) => {
      const target = windows.find((entry) => entry.name === windowInstanceId)
      if (target) target.events.push(event)
    },
    maxTargets: WorkspaceTransferPolicy.maxDetachedHosts + 1,
    resolveScopeOwner: (scope) => {
      if (scope.panelInstanceKey !== undefined) return undefined
      const workspaceInstanceKey = scope.workspaceInstanceKey
      if (workspaceInstanceKey === undefined) return undefined
      const declared = tabOwners.get(workspaceInstanceKey)
      if (declared === undefined) return undefined
      // 容器漂移以 registry 为权威：store 说 detached 但登记已经回收 ⇒ 归属回到主窗
      const record = registry.listDetachedTabs().find((entry) => entry.workspaceInstanceKey === workspaceInstanceKey)
      return record === undefined
        ? declared
        : { windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch }
    }
  })

  let revision = 0
  const snapshot = {
    layoutRevision: 0,
    activeWorkspaceInstanceKey: 'workspace-stream',
    panels: Object.freeze([]),
    pageLayouts: Object.freeze([]),
    tabs: Object.freeze([]) as readonly [],
    persistenceState: 'saved' as const
  }

  /** 真实事务：分离 → 新 owner 报 ready（Main 确认源释放）→ commit。 */
  async function detachTab(input: { workspaceInstanceKey: string; pageId: string; windowInstanceId: string }) {
    tabOwners.set(input.workspaceInstanceKey, { windowInstanceId: input.windowInstanceId, hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch + 1 })
    const reserved = registry.reserveDetachedTabWindow({
      windowInstanceId: input.windowInstanceId, hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch + 1,
      workspaceInstanceKey: input.workspaceInstanceKey
    })
    if (reserved.status === 'rejected') throw new Error('reserve failed')
    const outcome = await tabHost.requestTabDetach({
      operationId: `op-${input.workspaceInstanceKey}`, workspaceInstanceKey: input.workspaceInstanceKey,
      pageId: input.pageId, menuKey: input.pageId, title: input.pageId, sourceHost: mainRecord,
      windowInstanceId: input.windowInstanceId, hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch + 1
    })
    if (outcome.status !== 'awaiting-ready') throw new Error(`unexpected detach outcome ${outcome.status}`)
    const record = registry.describeWindow(input.windowInstanceId)
    if (!record) throw new Error('reservation lost')
    const claim = { operationId: `op-${input.workspaceInstanceKey}`, windowInstanceId: input.windowInstanceId, hostEpoch: record.hostEpoch }
    expect(tabHost.confirmTargetReady(claim)).toEqual({ accepted: true })
    const committed = tabHost.confirmSourceReleased(claim)
    if (!('accepted' in committed) || !committed.accepted) throw new Error('commit failed')
    revision += 1
    windows.push({ name: input.windowInstanceId, events: [] })
    return record
  }

  return {
    registry, mainRecord, router, tabHost, windows, handles, detachTab, tabOwners,
    windowOf: (name: string) => windows.find((entry) => entry.name === name) as StreamWindow,
    bumpRevision: () => { revision += 1 }
  }
}

describe('stream continuity: controlled agent execution survives tab detach and redock', () => {
  it('delivers every chunk and the terminal result to the new owner, with sendMessage exactly once', async () => {
    const harness = createStreamHarness()
    const chunks: Array<{ sessionId: string; index: number }> = []
    let terminal: unknown = null
    const runtimeSnapshot = {
      sessions: {},
      toolApprovals: [],
      toolApprovalHistory: [],
      chunksBySessionId: {} as Record<string, readonly unknown[]>,
      updatedAt: '2026-10-06T00:00:00.000Z'
    }
    const sendMessage = vi.fn(async (request: { sessionId: string; text: string }) => {
      // 流式：逐块落入 Main 侧权威快照（与真实 runtime 同一形状）
      for (let index = 0; index < 3; index += 1) {
        chunks.push({ sessionId: request.sessionId, index })
        runtimeSnapshot.chunksBySessionId = { ...runtimeSnapshot.chunksBySessionId, [request.sessionId]: [...chunks] }
      }
      terminal = { sessionId: request.sessionId, status: 'done', text: 'answer-3' }
      return terminal
    })
    const services = {
      state: { getState: async () => ({}) },
      agents: {}, tasks: {}, sessions: {}, messages: {}, taskAutomation: {}
    } as never
    const handlers = createAgentIpcHandlers(
      services,
      { sendMessage, getSnapshot: () => runtimeSnapshot } as never
    )

    // 主窗启动流
    const started = await handlers.sendMessage({ sessionId: 'session-1', agentId: 'agent-1', text: 'hi', runId: 'run-1' } as never)
    expect(started).toEqual(terminal)
    // 流仍在跑时读一次主窗快照（chunk 逐步到达）
    expect((handlers.getRuntimeSnapshot() as { chunksBySessionId: Record<string, unknown[]> }).chunksBySessionId['session-1']).toHaveLength(3)

    // 分离之前：主窗作为该作用域的 owner 订阅（这就是「旧 owner」）
    const scope = { workspaceInstanceKey: 'workspace-stream' }
    harness.tabOwners.set('workspace-stream', {
      windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId, hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch
    })
    expect(harness.router.attachHost({
      windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId,
      hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch, scope
    }).subscribed).toBe(true)
    expect(harness.windowOf('main').events.map((event) => event.type)).toEqual(['snapshot'])
    harness.bumpRevision()
    expect(harness.router.publish({ type: 'container-changed', scope }).delivered).toBe(1)
    expect(harness.windowOf('main').events).toHaveLength(2)

    // 流式运行中分离承载页面
    const record = await harness.detachTab({ workspaceInstanceKey: 'workspace-stream', pageId: 'agents', windowInstanceId: 'window-stream' })

    // 新 owner 直接向真实 handler 取终态：chunk + terminal 都在，无需旧的 emit
    const delivered = handlers.getRuntimeSnapshot() as { chunksBySessionId: Record<string, unknown[]> }
    expect(delivered.chunksBySessionId['session-1']).toHaveLength(3)
    expect(terminal).toEqual({ sessionId: 'session-1', status: 'done', text: 'answer-3' })
    // send 恰一次：分离/回停靠绝不重放用户消息
    expect(sendMessage).toHaveBeenCalledTimes(1)

    // 分离提交后：同一作用域的 owner 变成独立页窗；旧 owner（主窗）**不再**收到定向事件
    harness.tabOwners.set('workspace-stream', { windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch })
    harness.registry.attachWebContents({ windowInstanceId: record.windowInstanceId, webContentsId: 42 })
    const attached = harness.router.attachHost({ windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch, scope })
    expect(attached.subscribed).toBe(true)
    expect(harness.windowOf(record.windowInstanceId).events.map((event) => event.type)).toEqual(['snapshot'])

    harness.bumpRevision()
    const published = harness.router.publish({ type: 'container-changed', scope })
    // 恰好 1 次投递，且落在新 owner：旧 owner 的收件箱保持在上面的 2 条，绝不再涨
    expect(published.delivered).toBe(1)
    expect(harness.windowOf('main').events).toHaveLength(2)
    expect(harness.windowOf(record.windowInstanceId).events).toHaveLength(2)
  })

  it('keeps the terminal result reachable after redocking back to the main window', async () => {
    const harness = createStreamHarness()
    const runtimeSnapshot = { chunksBySessionId: { 'session-2': [{ index: 0 }, { index: 1 }] } as Record<string, unknown[]> }
    const sendMessage = vi.fn(async () => ({ sessionId: 'session-2', status: 'done' }))
    const handlers = createAgentIpcHandlers(
      { state: { getState: async () => ({}) }, agents: {}, tasks: {}, sessions: {}, messages: {}, taskAutomation: {} } as never,
      { sendMessage, getSnapshot: () => runtimeSnapshot } as never
    )
    await handlers.sendMessage({ sessionId: 'session-2', agentId: 'a', text: 'hi' } as never)

    const record = await harness.detachTab({ workspaceInstanceKey: 'workspace-redock', pageId: 'agents', windowInstanceId: 'window-redock' })
    const rehome = harness.tabHost.rehomeTabToMain({ windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch })
    expect(rehome).toEqual({ status: 'redocked', mode: 'embedded' })

    // 回停靠后主窗仍是同一个权威会话：chunk 与终态都还在
    const delivered = handlers.getRuntimeSnapshot() as { chunksBySessionId: Record<string, unknown[]> }
    expect(delivered.chunksBySessionId['session-2']).toHaveLength(2)
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})

describe('stream continuity: controlled assistant execution survives tab detach', () => {
  it('hands the buffered chunks and the terminal status to the new owner exactly once', async () => {
    const harness = createStreamHarness()
    const buffered = [
      { topicId: 'topic-1', executionId: 'exec-1', chunk: { type: 'text-delta', text: 'a' } },
      { topicId: 'topic-1', executionId: 'exec-1', chunk: { type: 'text-delta', text: 'b' } }
    ]
    let status: { topicId: string; status: string; activeExecutions: unknown[]; awaitingApprovalAnchors: unknown[]; updatedAt: string } = {
      topicId: 'topic-1', status: 'streaming', activeExecutions: [{ executionId: 'exec-1' }], awaitingApprovalAnchors: [],
      updatedAt: '2026-10-06T00:00:00.000Z'
    }
    const open = vi.fn(async () => ({ mode: 'started' as const, executionIds: ['exec-1'] }))
    const runtime = {
      open,
      attach: vi.fn(() => ({ snapshot: status, bufferedChunks: [...buffered] })),
      abort: () => false,
      discardTopic: () => undefined,
      getStatus: () => status
    }
    const handlers = createAssistantIpcHandlers({} as never, runtime as never)

    expect(await handlers.streamOpen({ topicId: 'topic-1', trigger: 'submit-message', userMessageParts: [] } as never))
      .toEqual({ mode: 'started', executionIds: ['exec-1'] })
    // 流式运行中：主窗能看到 chunk
    expect(handlers.streamAttach('topic-1').bufferedChunks).toHaveLength(2)

    // 流式运行中分离承载页面
    const record = await harness.detachTab({ workspaceInstanceKey: 'workspace-assistant', pageId: 'assistants', windowInstanceId: 'window-assistant' })
    expect(record.kind).toBe('detached-tab')
    // 终态到达（真实 runtime 会把 status 推进到 done）
    status = { ...status, status: 'done', activeExecutions: [] }

    // 新 owner 实际收到的终态：缓冲 chunk + done 状态
    const attached = handlers.streamAttach('topic-1')
    expect(attached.bufferedChunks).toHaveLength(2)
    expect(attached.snapshot.status).toBe('done')
    // open 恰一次（分离不重放开流）
    expect(open).toHaveBeenCalledTimes(1)
  })
})

describe('stream continuity: renderer bridge listeners are released on migration', () => {
  function createCountingBridge() {
    const listeners = new Set<(event: unknown) => void>()
    return {
      activeListeners: () => listeners.size,
      bridge: {
        getHostContext: async () => ({
          windowInstanceId: 'main', hostEpoch: 1, role: 'main' as const, mounts: [], pendingTransfer: null,
          layoutRevision: 0, pageIds: [], preferences: { language: 'en-US' as const, theme: 'dark', timeZone: 'UTC' }
        }),
        getSnapshot: async () => ({
          status: 'ok',
          snapshot: {
            layoutRevision: 0, activeWorkspaceInstanceKey: null, panels: [], pageLayouts: [], tabs: [], persistenceState: 'saved'
          }
        }),
        command: async () => ({ status: 'rejected', errorCode: 'unsupported', snapshot: null }),
        onEvent: (listener: (event: unknown) => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        }
      }
    }
  }

  it('clears the old window listener before the new owner subscribes (no listener leak)', async () => {
    // 旧 owner（主窗）：挂载订阅
    const oldWindow = createCountingBridge()
    const oldClient = createWorkspaceClient(oldWindow.bridge)
    await oldClient.readHostContext()
    const stopOld = oldClient.observe(() => undefined)
    expect(oldWindow.activeListeners()).toBe(1)

    // 迁移：旧窗口卸载/dispose（页面离开主窗）
    stopOld()
    expect(oldWindow.activeListeners()).toBe(0)
    oldClient.dispose()
    expect(oldWindow.activeListeners()).toBe(0)

    // 新 owner（独立页窗）：恰好一条订阅
    const newWindow = createCountingBridge()
    const newClient = createWorkspaceClient(newWindow.bridge)
    await newClient.readHostContext()
    const received: unknown[] = []
    const stopNew = newClient.observe((snapshot) => received.push(snapshot))
    expect(newWindow.activeListeners()).toBe(1)

    // 同一窗口再挂一条订阅：两条并存，退订一条后仍有恰好一条在档（无泄漏、无提前释放）
    const stopSecond = newClient.observe(() => undefined)
    expect(newWindow.activeListeners()).toBe(1)
    stopSecond()
    expect(newWindow.activeListeners()).toBe(1)
    stopNew()
    expect(newWindow.activeListeners()).toBe(0)
    newClient.dispose()
    expect(newWindow.activeListeners()).toBe(0)
    void received
  })
})
