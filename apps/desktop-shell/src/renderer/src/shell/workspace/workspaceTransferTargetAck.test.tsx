// @vitest-environment happy-dom
/**
 * Owner: apps/desktop-shell renderer / workspace **待接管目标**侧 ACK 链（P1-06f）。回归：本文件。
 * 权威：受控 `getHostContext().pendingTransfer`（Main 投影）+ P1-06d 的 hostLifecycle 准入。
 * 只注入 fake preload `window.platform.workspace`：不启动 Electron、不读真实 profile/userData、不加载产品。
 * 断言：预留期不是错误壳、就绪后报一次 target-ready、提交后渲染真实内容、回滚/无能力时 fail closed。
 */
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WorkspacePanelRegistration, WorkspacePanelSnapshot, WorkspaceSnapshot } from '@platform/workspace/contracts'
import { WorkspaceTransferPolicy } from '@platform/workspace/policies'
import { platformText } from '../../i18n/platformText'
import { WorkspaceWindowRoot, type WorkspacePendingTimerPort, type WorkspaceWindowRootProps } from './WorkspaceWindowRoot'
import type { WorkspaceBridge } from './workspaceClient'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const labels = platformText['en-US'].workspace
const loadingLabel = platformText['en-US'].status.loading
const FLUSH_TURNS = 16
/** 待接管目标的有界重取预算（与实现同源：准备上界 + 释放上界）。 */
const PENDING_BUDGET_MS = WorkspaceTransferPolicy.prepareTargetTimeoutMs + WorkspaceTransferPolicy.releaseTimeoutMs
const WORKSPACE_KEY = 'ws-1'
const PANEL_KEY = 'panel-1'
const PANEL_ID = 'platform.inspector'
const PANEL_WINDOW_ID = 'window-panel-1'
const OPERATION_ID = 'operation-1'
const REVISION = 7
const panelIdentity = { workspaceInstanceKey: WORKSPACE_KEY, panelInstanceKey: PANEL_KEY, panelId: PANEL_ID }

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  if (root) {
    const current = root
    root = undefined
    await act(async () => { current.unmount() })
  }
  container = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
})

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < FLUSH_TURNS; turn += 1) await Promise.resolve()
  })
}

const registration: WorkspacePanelRegistration = {
  panelId: PANEL_ID,
  title: { 'en-US': 'Inspector', 'zh-CN': '检查器' },
  icon: 'file-text',
  module: 'platform.inspector',
  pageIds: [],
  supportedModes: ['embedded', 'docked-right', 'docked-bottom', 'detached'],
  defaultMode: 'docked-right',
  allowMultipleInstances: false,
  minSize: { width: 200, height: 150 },
  preferredSize: { width: 300, height: 220 },
  binding: { persistence: 'none', maxKeyBytes: 256 },
  lifecycleEvents: []
}

/** 准备期投影：目标宿主尚未取得归属，权威快照里没有该面板（mounts 恒为空）。 */
function snapshotWithoutPanel(revision = REVISION): WorkspaceSnapshot {
  return { layoutRevision: revision, activeWorkspaceInstanceKey: null, panels: [], pageLayouts: [], tabs: [], persistenceState: 'saved' }
}

/** 提交后的权威投影：面板真的归目标宿主所有（mode:'detached'），且出现在所属 workspace 的布局里。 */
function snapshotOwnedByPanelWindow(revision = REVISION): WorkspaceSnapshot {
  const panel: WorkspacePanelSnapshot = {
    ...panelIdentity, open: true, mode: 'detached', presentation: 'normal', bindingState: 'bound',
    windowInstanceId: PANEL_WINDOW_ID, hostEpoch: 2, lastValidDock: 'docked-right'
  }
  return {
    layoutRevision: revision, activeWorkspaceInstanceKey: WORKSPACE_KEY, panels: [panel],
    pageLayouts: [{ workspaceInstanceKey: WORKSPACE_KEY, panelOrder: [PANEL_KEY], activePanels: {} }],
    tabs: [], persistenceState: 'saved'
  }
}

const hostMount = () => ({
  ...panelIdentity, open: true, mode: 'detached' as const, bindingState: 'bound' as const
})

function panelContext(input: { mounts?: unknown[]; pendingTransfer?: unknown; layoutRevision?: number } = {}): unknown {
  return {
    status: 'ok',
    context: {
      windowInstanceId: PANEL_WINDOW_ID, hostEpoch: 2, role: 'panel', mounts: input.mounts ?? [],
      ...(input.pendingTransfer === undefined ? {} : { pendingTransfer: input.pendingTransfer }),
      layoutRevision: input.layoutRevision ?? REVISION, pageIds: [],
      preferences: { language: 'en-US', theme: 'system' }
    }
  }
}

const reservedView = () => ({ status: 'reserved', ...panelIdentity })
const inFlightView = (phase = 'awaiting-target-ready') => ({ status: 'in-flight', operationId: OPERATION_ID, phase, ...panelIdentity })

type AckRequest = Record<string, unknown>
type AckOutcome = { accepted: boolean; reason?: string }
type BridgeHarness = {
  bridge: WorkspaceBridge
  ackRequests: AckRequest[]
  setContext: (value: unknown) => void
  setSnapshot: (value: WorkspaceSnapshot) => void
  setAckOutcome: (value: AckOutcome | ((request: AckRequest) => AckOutcome)) => void
  emit: (event: unknown) => void
  listenerCount: () => number
  unsubscribeCount: () => number
  contextCalls: () => number
}

/**
 * 手动定时器端口（P1-06g 非阻塞①）：兜底重取的节奏由注入端口控制，生产 props 里不再有测试时长旋钮。
 * `pending()` = 仍在飞的定时器（实现必须始终 ≤1，绝不累积）；`fire()` 兑现最早的一条并排空微任务。
 */
function createManualTimers() {
  const scheduled: Array<{ delayMs: number; run: () => void; cancelled: boolean; fired: boolean }> = []
  let now = 1_000
  const port: WorkspacePendingTimerPort = {
    now: () => now,
    schedule: (delayMs, run) => {
      const entry = { delayMs, run, cancelled: false, fired: false }
      scheduled.push(entry)
      return () => { entry.cancelled = true }
    }
  }
  return {
    port,
    advance: (deltaMs: number) => { now += deltaMs },
    pending: () => scheduled.filter((entry) => !entry.cancelled && !entry.fired),
    scheduledCount: () => scheduled.length,
    firedCount: () => scheduled.filter((entry) => entry.fired).length,
    /** 只统计「排了但从未兑现就被取消」的定时器（已兑现的那条随后被取消不算淘汰）。 */
    cancelCount: () => scheduled.filter((entry) => entry.cancelled && !entry.fired).length,
    fire: async (): Promise<void> => {
      const entry = scheduled.find((candidate) => !candidate.cancelled && !candidate.fired)
      if (!entry) throw new Error('no pending timer')
      entry.fired = true
      entry.run()
      await settle()
    }
  }
}

/** fake 受控桥（镜像 preload 的 platform.workspace）；`withHostLifecycle:false` 用于证伪「没有 ACK 能力」。 */
function createTransferBridge(input: { context: unknown; snapshot: WorkspaceSnapshot; withHostLifecycle?: boolean }): BridgeHarness {
  const listeners = new Set<(event: unknown) => void>()
  const state = {
    context: input.context, snapshot: input.snapshot, contextCalls: 0, unsubscribes: 0,
    ackOutcome: { accepted: true } as AckOutcome | ((request: AckRequest) => AckOutcome)
  }
  const harness: BridgeHarness = {
    bridge: null as unknown as WorkspaceBridge, ackRequests: [],
    setContext: (value) => { state.context = value },
    setSnapshot: (value) => { state.snapshot = value },
    setAckOutcome: (value) => { state.ackOutcome = value },
    emit: (event) => { for (const listener of [...listeners]) listener(event) },
    listenerCount: () => listeners.size,
    unsubscribeCount: () => state.unsubscribes,
    contextCalls: () => state.contextCalls
  }
  const base = {
    getHostContext: async () => { state.contextCalls += 1; return state.context },
    getSnapshot: async () => ({ status: 'ok', snapshot: state.snapshot }),
    command: async () => ({ status: 'applied', snapshot: state.snapshot, panelInstanceKey: PANEL_KEY }),
    onEvent: (listener: (event: unknown) => void) => {
      listeners.add(listener)
      return () => { state.unsubscribes += 1; listeners.delete(listener) }
    }
  }
  harness.bridge = (input.withHostLifecycle === false ? base : {
    ...base,
    hostLifecycle: async (request: unknown) => {
      const record = request as AckRequest
      harness.ackRequests.push(record)
      return typeof state.ackOutcome === 'function' ? state.ackOutcome(record) : state.ackOutcome
    }
  }) as unknown as WorkspaceBridge
  return harness
}

async function renderRoot(bridge: WorkspaceBridge, props: Partial<WorkspaceWindowRootProps> = {}): Promise<HTMLDivElement> {
  Reflect.set(window, 'platform', { workspace: bridge })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const current = root
  // 真实 dev 渲染器就是 StrictMode：ACK 链必须对 effect 双调用幂等
  await act(async () => {
    current.render(createElement(StrictMode, null, createElement(WorkspaceWindowRoot, props as WorkspaceWindowRootProps)))
  })
  await settle()
  return container
}

describe('待接管目标：受控视图 → 准备期界面 → target-ready → 提交后渲染真实内容', () => {
  it('预留期先渲染准备期界面（不是「没有可承载面板」错误壳），视图推进到 in-flight 后才报 ready', async () => {
    const harness = createTransferBridge({ context: panelContext({ pendingTransfer: reservedView() }), snapshot: snapshotWithoutPanel() })
    const host = await renderRoot(harness.bridge, { registrations: [registration] })

    // 准备期界面：不是错误壳、也没有伪造面板帧
    expect(host.querySelector('.workspace-window-preparing')).not.toBeNull()
    expect(host.textContent).not.toContain(labels.windowHostUnavailableTitle)
    expect(host.textContent).not.toContain(labels.windowHostUnavailablePanel)
    expect(host.querySelector('[data-panel-key]')).toBeNull()
    // 还没有 operationId：绝不猜、绝不先报 ready
    expect(harness.ackRequests).toHaveLength(0)

    harness.setContext(panelContext({ pendingTransfer: inFlightView() }))
    harness.emit({ type: 'container-changing', layoutRevision: REVISION, scope: { panelInstanceKey: PANEL_KEY } })
    await settle()
    expect(harness.ackRequests).toEqual([{
      operationId: OPERATION_ID, phase: 'target-ready', windowInstanceId: PANEL_WINDOW_ID, hostEpoch: 2
    }])
    expect(host.querySelector('.workspace-window-preparing')?.getAttribute('aria-label')).toBe('Inspector')
    expect(host.textContent).toContain(loadingLabel)
  })

  it('直接处于 in-flight 时同样先渲染准备期界面并报一次 ready', async () => {
    const harness = createTransferBridge({ context: panelContext({ pendingTransfer: inFlightView() }), snapshot: snapshotWithoutPanel() })
    const host = await renderRoot(harness.bridge, { registrations: [registration] })
    expect(host.querySelector('.workspace-window-preparing')).not.toBeNull()
    expect(harness.ackRequests).toHaveLength(1)
    expect(harness.ackRequests[0]).toMatchObject({ phase: 'target-ready', operationId: OPERATION_ID })
  })

  it('错过全部事件时靠有界兜底重取发现飞事务：目标仍会在渲染器就绪后报 ready', async () => {
    const harness = createTransferBridge({ context: panelContext({ pendingTransfer: reservedView() }), snapshot: snapshotWithoutPanel() })
    const timers = createManualTimers()
    const host = await renderRoot(harness.bridge, { registrations: [registration], pendingTimers: timers.port })
    expect(harness.ackRequests).toHaveLength(0)
    // 兜底节奏只由实现的具名常量决定：调用方只能看到「恰好一个在飞定时器」，没有时长旋钮
    expect(timers.pending()).toHaveLength(1)
    expect(timers.pending()[0]?.delayMs).toBeGreaterThan(0)

    // 没有发出任何事件，只是权威上下文推进到 in-flight：兜底定时器必须自己发现并报 ready
    harness.setContext(panelContext({ pendingTransfer: inFlightView() }))
    await timers.fire()
    expect(harness.ackRequests).toEqual([{
      operationId: OPERATION_ID, phase: 'target-ready', windowInstanceId: PANEL_WINDOW_ID, hostEpoch: 2
    }])
    expect(host.querySelector('.workspace-window-preparing')).not.toBeNull()
  })

  it('兜底重取恰好按预期次数、绝不累积在飞定时器，且重复重取不会重复报 ready', async () => {
    const harness = createTransferBridge({ context: panelContext({ pendingTransfer: inFlightView() }), snapshot: snapshotWithoutPanel() })
    const timers = createManualTimers()
    await renderRoot(harness.bridge, { registrations: [registration], pendingTimers: timers.port })
    expect(harness.ackRequests).toHaveLength(1)
    expect(timers.pending()).toHaveLength(1)

    // 连续三轮兜底空转：每轮恰好一个在飞定时器，ready 仍只发一次
    for (let round = 0; round < 3; round += 1) {
      expect(timers.pending()).toHaveLength(1)
      await timers.fire()
    }
    expect(timers.firedCount()).toBe(3)
    // 每条排过的定时器都有归宿：已兑现 / 仍在飞 / 被取消（StrictMode 双调用只多一条取消记录），绝不丢失
    expect(timers.scheduledCount()).toBe(
      timers.firedCount() + timers.pending().length + timers.cancelCount()
    )
    expect(timers.cancelCount()).toBeGreaterThanOrEqual(1)
    expect(harness.ackRequests).toHaveLength(1)

    // 事件驱动与定时器兜底并存：同样只保留一个在飞定时器，且不重复 ACK
    harness.emit({ type: 'container-changing', layoutRevision: REVISION, scope: { panelInstanceKey: PANEL_KEY } })
    await settle()
    expect(timers.pending()).toHaveLength(1)
    expect(harness.ackRequests).toHaveLength(1)
  })

  it('卸载后不再重取：在飞定时器被取消、退订归零，且之后不再有任何权威读取', async () => {
    const harness = createTransferBridge({ context: panelContext({ pendingTransfer: inFlightView() }), snapshot: snapshotWithoutPanel() })
    const timers = createManualTimers()
    await renderRoot(harness.bridge, { registrations: [registration], pendingTimers: timers.port })
    expect(harness.listenerCount()).toBe(1)
    const scheduledBeforeUnmount = timers.scheduledCount()
    const readsBeforeUnmount = harness.contextCalls()

    const current = root
    root = undefined
    await act(async () => { current?.unmount() })

    expect(timers.pending()).toHaveLength(0)
    expect(timers.cancelCount()).toBeGreaterThanOrEqual(1)
    expect(harness.listenerCount()).toBe(0)
    expect(harness.unsubscribeCount()).toBeGreaterThanOrEqual(1)
    expect(timers.scheduledCount()).toBe(scheduledBeforeUnmount)
    // 卸载后事件与定时器都不得再触发权威读取
    harness.emit({ type: 'container-changing', layoutRevision: REVISION + 1, scope: { panelInstanceKey: PANEL_KEY } })
    await settle()
    expect(harness.contextCalls()).toBe(readsBeforeUnmount)
  })

  it('提交后（mounts 出现）渲染真实面板内容，不再显示准备期界面', async () => {
    const harness = createTransferBridge({ context: panelContext({ pendingTransfer: inFlightView() }), snapshot: snapshotWithoutPanel() })
    // ready 被接受后 Main 立即提交：下一次权威读取就应看到挂载并渲染真实内容
    harness.setAckOutcome((request) => {
      if (request.phase !== 'target-ready') return { accepted: true }
      harness.setContext(panelContext({ mounts: [hostMount()], pendingTransfer: null }))
      harness.setSnapshot(snapshotOwnedByPanelWindow(8))
      return { accepted: true }
    })
    const host = await renderRoot(harness.bridge, {
      registrations: [registration],
      renderPanelContent: () => createElement('div', { 'data-real-content': 'yes' }, 'REAL-CONTENT')
    })
    expect(host.querySelector('.workspace-window-preparing')).toBeNull()
    // 独立窗是单面板内容面：绝不把 detached 伪造成停靠模式，也不套页面级轨道
    expect(host.querySelector('.workspace-panel-window')).not.toBeNull()
    const surface = host.querySelector<HTMLElement>('section[data-panel-key="' + PANEL_KEY + '"]')
    expect(surface?.getAttribute('data-dock')).toBe('detached')
    expect(surface?.getAttribute('aria-label')).toBe('Inspector')
    expect(host.textContent).toContain('REAL-CONTENT')
    expect(host.textContent).not.toContain(labels.windowHostUnavailableTitle)
  })

  it('ready 之后由提交事件驱动：权威投影出现挂载即切换到真实内容', async () => {
    const harness = createTransferBridge({ context: panelContext({ pendingTransfer: inFlightView() }), snapshot: snapshotWithoutPanel() })
    const host = await renderRoot(harness.bridge, { registrations: [registration] })
    expect(host.querySelector('.workspace-window-preparing')).not.toBeNull()

    harness.setContext(panelContext({ mounts: [hostMount()], pendingTransfer: null }))
    harness.setSnapshot(snapshotOwnedByPanelWindow(9))
    harness.emit({ type: 'container-changed', layoutRevision: 9, scope: { panelInstanceKey: PANEL_KEY } })
    await settle()
    expect(host.querySelector('.workspace-window-preparing')).toBeNull()
    const surface = host.querySelector<HTMLElement>('section[data-panel-key="' + PANEL_KEY + '"]')
    expect(surface?.getAttribute('data-dock')).toBe('detached')
    expect(surface?.textContent).toContain(labels.windowPanelPlaceholder)
  })

  it('转移被回滚（视图消失且没有挂载）时收敛到安全错误壳，绝不留准备期假象', async () => {
    const harness = createTransferBridge({ context: panelContext({ pendingTransfer: inFlightView() }), snapshot: snapshotWithoutPanel() })
    const host = await renderRoot(harness.bridge, { registrations: [registration] })
    harness.setContext(panelContext({ pendingTransfer: null }))
    harness.emit({ type: 'fallback', layoutRevision: 9, scope: { panelInstanceKey: PANEL_KEY } })
    await settle()
    expect(host.querySelector('.workspace-window-preparing')).toBeNull()
    expect(host.textContent).toContain(labels.windowHostUnavailableTitle)
  })

  it('未参与转移（无视图且无挂载）仍是安全错误壳，不伪造待接管目标', async () => {
    const harness = createTransferBridge({ context: panelContext(), snapshot: snapshotWithoutPanel() })
    const host = await renderRoot(harness.bridge, { registrations: [registration] })
    expect(host.textContent).toContain(labels.windowHostUnavailablePanel)
    expect(harness.ackRequests).toHaveLength(0)
  })

  it('桥没有 hostLifecycle 能力时绝不假装 ready：fail closed 到错误壳', async () => {
    const harness = createTransferBridge({
      context: panelContext({ pendingTransfer: inFlightView() }), snapshot: snapshotWithoutPanel(), withHostLifecycle: false
    })
    const host = await renderRoot(harness.bridge, { registrations: [registration] })
    expect(host.textContent).toContain(labels.windowHostUnavailablePanel)
    expect(harness.ackRequests).toHaveLength(0)
  })

  it('准备期有界：预算内既未提交也未回滚 ⇒ 收敛到安全错误壳，绝不无限悬挂', async () => {
    vi.useFakeTimers()
    try {
      const harness = createTransferBridge({ context: panelContext({ pendingTransfer: inFlightView() }), snapshot: snapshotWithoutPanel() })
      const host = await renderRoot(harness.bridge, { registrations: [registration] })
      expect(host.querySelector('.workspace-window-preparing')).not.toBeNull()
      await act(async () => {
        vi.advanceTimersByTime(PENDING_BUDGET_MS + 1_000)
        for (let turn = 0; turn < FLUSH_TURNS; turn += 1) await Promise.resolve()
      })
      expect(host.querySelector('.workspace-window-preparing')).toBeNull()
      expect(host.textContent).toContain(labels.windowHostUnavailableTitle)
    } finally {
      vi.useRealTimers()
    }
  })
})
