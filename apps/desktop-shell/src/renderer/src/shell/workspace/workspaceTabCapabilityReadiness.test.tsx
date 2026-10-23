// @vitest-environment happy-dom
/**
 * Owner: apps/desktop-shell renderer / workspace。**PLAT-05 RED（先落盘、先跑失败）**。回归：本文件。
 *
 * 缺陷（真机证据）：应用启动早期，渲染进程在 Main 侧 `.tabs.*` handler **尚未注册**时就发
 * `platform:workspace-tabs-get-snapshot`，Main 打
 * `Error occurred in handler for 'platform:workspace-tabs-get-snapshot': Error: No handler registered for …`
 * （P2-15 `focused-stderr.txt` 第 1 行；P2-06T 基线同一类噪声）。renderer 只是 fail closed（不崩），
 * 但启动日志被污染、真机归因容易被误判为产品失败。
 *
 * 判据（PLAT-05 ①–④，全部用**受控面形状**的 fake preload，不启动 Electron / 不读 profile / 不加载产品路由）：
 *  ① 能力未就绪（同窗角色握手在飞）⇒ **一次 `tabsGetSnapshot` invoke 都不许发**（当前：直接 invoke）；
 *  ② 就绪后**恰好一次**权威读取并渲染 Tab 条（补读单飞，不得形成读取风暴）；
 *  ③ 有界：未就绪持续（真实时间流逝）+ 握手被拒后**零重试**，行为退化为安全壳（不崩、不轮询、不无限重试）；
 *  ④ 就绪正证（既有受控握手成功）到达后**自动补一次**权威读取，用户不需要手动刷新；
 *  ⑤ 生产接线（真实 `AppShell`）：握手在飞时零 invoke 且不挂 Tab 条 ⇒ 握手成功后自动读取并挂载 Tab 条。
 *
 * 就绪的正面证据只有两个，且都**不发 invoke**：同窗既有的受控角色握手（`workspace.getHostContext()`，
 * 窗口根判定角色时已经发起）成功；或 Main 投递的受控 `workspaceEvent` 到达。绝不「先打一枪再重试」。
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDefaultAppSettings } from '@platform/settings/schema/appSettings'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const MAIN_WINDOW_ID = 'main'
const HOST_EPOCH = 1
const TAB_KEY = 'workspace-tab-settings'
const FLUSH_TURNS = 16

/**
 * PLAT-12：⑤ 是**真实慢**，不是负载抖动。它 `await import('../AppShell')` 的实测耗时
 * （单跑 3 次 + 干净并集 1 次）：2.91s / 3.41s / 3.51s / 3.56s；临时探针实测该动态 import 占本用例
 * 耗时 ~96%（真实 `AppShell` 模块图在 happy-dom 下的执行成本），已吃掉默认 5s 预算的 70%；
 * 10 路 CPU 竞争下实测 4.83s / 5.42s，并集里即 5005ms 超时（PLAT-12 RED 复现）。
 * ⇒ 给**这一个用例**具名、局部、有界的预算（≈ 最坏实测的 2.7 倍）；真的挂起仍然失败。
 * 不用「缩小渲染面」换绿：⑤ 的验证强度正是「真实生产接线（真实 AppShell）」，缩小即降低强度。
 */
const APP_SHELL_CASE_TIMEOUT_MS = 15_000

/** 条件驱动等待的显式有界上界：`vi.waitFor` 默认 1s 在竞争下会先于条件到达而抛错（判据不变，只是上界明确且有界）。 */
const CONDITION_TIMEOUT_MS = 5_000

let root: Root | undefined
let container: HTMLDivElement | undefined

beforeEach(() => {
  // 能力就绪是**每渲染进程（= 每窗）一份**的模块状态：每个用例都从干净模块图开始，绝不互相污染。
  vi.resetModules()
})

afterEach(async () => {
  if (root !== undefined) {
    const current = root
    root = undefined
    await act(async () => { current.unmount() })
  }
  container = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
  window.localStorage.clear()
})

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < FLUSH_TURNS; turn += 1) await Promise.resolve()
  })
}

/** 主窗受控上下文（形状与 Main 的 `workspace.getHostContext` 投影逐字同构）。 */
function mainContext(): unknown {
  return {
    status: 'ok',
    context: {
      windowInstanceId: MAIN_WINDOW_ID,
      hostEpoch: HOST_EPOCH,
      role: 'main',
      mounts: [],
      pendingTransfer: null,
      layoutRevision: 1,
      pageIds: ['assistants', 'agents', 'settings'],
      preferences: { language: 'en-US', theme: 'dark' }
    }
  }
}

function emptySnapshot() {
  return {
    layoutRevision: 1, activeWorkspaceInstanceKey: null, panels: [], pageLayouts: [], tabs: [],
    persistenceState: 'saved' as const
  }
}

function tabSnapshot() {
  return {
    layoutRevision: 3,
    activeWorkspaceInstanceKey: TAB_KEY,
    recentlyClosedCount: 0,
    tabs: [{
      workspaceInstanceKey: TAB_KEY, pageId: 'settings', menuKey: 'settings', open: true, order: 0,
      mode: 'main' as const, bindingState: 'bound' as const,
      windowInstanceId: MAIN_WINDOW_ID, hostEpoch: HOST_EPOCH
    }]
  }
}

type SurfaceCalls = {
  getHostContext: number
  getSnapshot: number
  command: number
  tabsGetSnapshot: number
  tabsCommand: number
  tabsHostLifecycle: number
}

/**
 * 受控面形状的 fake preload `window.platform.workspace`：与真 preload 逐方法同构。
 * `handshake` 决定同窗角色握手（唯一的就绪正证来源）的时序：
 *  · `pending` —— 握手在飞（启动早期 Main 还没注册 handler ⇒ 真机打 `No handler registered`）；
 *  · `ok`      —— 握手成功（Main 已注册 ⇒ `.tabs.*` 与面板通道同批已注册）；
 *  · `rejected`—— 握手被受控拒绝（能力缺席 / 非本窗）。
 */
function createSurface(input: { handshake: 'pending' | 'ok' | 'rejected' }) {
  const calls: SurfaceCalls = {
    getHostContext: 0, getSnapshot: 0, command: 0, tabsGetSnapshot: 0, tabsCommand: 0, tabsHostLifecycle: 0
  }
  const listeners = new Set<(event: unknown) => void>()
  let settleHandshake: (outcome: 'ok' | 'rejected') => void = () => undefined
  const handshake = new Promise<unknown>((resolve, reject) => {
    settleHandshake = (outcome) => {
      if (outcome === 'ok') resolve(mainContext())
      else reject(new Error("Error invoking remote method 'platform:workspace-get-host-context': Error: No handler registered for 'platform:workspace-get-host-context'"))
    }
  })
  const workspace = {
    getHostContext: async () => {
      calls.getHostContext += 1
      if (input.handshake === 'pending') return handshake
      if (input.handshake === 'ok') return mainContext()
      return { status: 'rejected', errorCode: 'not-owner' }
    },
    getSnapshot: async () => { calls.getSnapshot += 1; return { status: 'ok', snapshot: emptySnapshot() } },
    command: async () => { calls.command += 1; return { status: 'rejected', errorCode: 'invalid-request', snapshot: emptySnapshot() } },
    onEvent: (listener: (event: unknown) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    tabsGetSnapshot: async () => { calls.tabsGetSnapshot += 1; return { status: 'ok', snapshot: tabSnapshot() } },
    tabsCommand: async () => { calls.tabsCommand += 1; return { status: 'rejected', errorCode: 'invalid-request', snapshot: tabSnapshot() } },
    tabsHostLifecycle: async () => { calls.tabsHostLifecycle += 1; return { accepted: true } }
  }
  const host = { platform: { workspace } }
  return {
    host, workspace, calls,
    /** 受控增量事件（Main 侧的 `workspaceEvent`）：只可能来自已注册的 Main ⇒ 本身也是就绪正证。 */
    emit: (event: unknown) => { for (const listener of [...listeners]) listener(event) },
    listenerCount: () => listeners.size,
    /** 兑现/拒绝在飞的握手（模拟 Main 注册完成的时刻）。 */
    settleHandshake: (outcome: 'ok' | 'rejected') => settleHandshake(outcome)
  }
}

type Surface = ReturnType<typeof createSurface>

/** 走**生产同一条**读取路径：`readWorkspaceTabsBridge(host)` ⇒ `createWorkspaceTabClient(bridge)`。 */
async function openTabClient(surface: Surface) {
  const mod = await import('./workspaceClient')
  const bridge = mod.readWorkspaceTabsBridge(surface.host)
  if (bridge === null) throw new Error('expected the controlled .tabs.* bridge to be readable')
  return { mod, client: mod.createWorkspaceTabClient(bridge) }
}

/** 主窗的角色判定读取（真实 `createWorkspaceClient(...).readHostContext()`，就绪正证的唯一生产来源）。 */
async function runWindowHandshake(surface: Surface, mod: typeof import('./workspaceClient')) {
  const bridge = mod.readWorkspaceBridge(surface.host)
  if (bridge === null) throw new Error('expected the controlled workspace bridge to be readable')
  return mod.createWorkspaceClient(bridge).readHostContext()
}

/** 真实 `AppShell` 需要的受控面（与既有 AppShell 用例同口径：只注入受控平台方法）。 */
function installShellPlatform(surface: Surface): void {
  Reflect.set(window, 'platform', {
    app: {
      getInfo: vi.fn(async () => null),
      getProductSummaries: vi.fn(async () => []),
      openExternal: vi.fn(async () => undefined)
    },
    settings: { get: vi.fn(async () => ({ ...createDefaultAppSettings(), language: 'en-US' })) },
    modelProviders: { list: vi.fn(async () => []), upsert: vi.fn(async () => undefined) },
    assistants: {
      list: vi.fn(async () => []),
      listTopics: vi.fn(async () => ({ topics: [] })),
      listTopicMessages: vi.fn(async () => ({ messages: [] })),
      streamAttach: vi.fn(async () => ({ snapshot: { topicId: '', status: 'idle', executions: [] } })),
      onStreamChunk: vi.fn(() => () => undefined),
      onStreamDone: vi.fn(() => () => undefined),
      onStreamError: vi.fn(() => () => undefined),
      onStreamStatusChanged: vi.fn(() => () => undefined)
    },
    workspace: surface.workspace
  })
}

describe('PLAT-05：`.tabs.*` 首次权威读取的能力就绪门控', () => {
  it('① 能力未就绪（角色握手在飞）时首次读取绝不发出 tabsGetSnapshot invoke', async () => {
    const surface = createSurface({ handshake: 'pending' })
    const { client } = await openTabClient(surface)

    const loaded = await client.load()

    // RED（当前实现）：loaded 非 null 且 tabsGetSnapshot 被调用 1 次 ⇒ Main 打 No handler registered。
    expect(surface.calls.tabsGetSnapshot).toBe(0)
    expect(loaded).toBeNull()
    expect(client.getState()).toBeNull()
  })

  it('③ 有界：未就绪持续（真实时间流逝）与握手被拒之后都零重试，行为退化为安全壳', async () => {
    const surface = createSurface({ handshake: 'pending' })
    const { mod, client } = await openTabClient(surface)
    await client.load()
    expect(surface.calls.tabsGetSnapshot).toBe(0)

    // 无定时器、无忙轮询：真实时间流逝之后依然一次 invoke 都没有（当前实现此刻早已打过多次）。
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(surface.calls.tabsGetSnapshot).toBe(0)

    // 反面证据（握手被拒/能力缺席）⇒ 首次权威读取**永久放弃**：事件再多也绝不补打。
    surface.settleHandshake('rejected')
    await runWindowHandshake(surface, mod)
    for (let index = 0; index < 5; index += 1) surface.emit({ type: 'open', layoutRevision: index + 2, scope: {} })
    await settle()

    expect(surface.calls.tabsGetSnapshot).toBe(0)
    expect(client.getState()).toBeNull()
  })

  it('②/④ 就绪正证到达后自动补**恰好一次**权威读取，不重复、不风暴、不需要手动刷新', async () => {
    const surface = createSurface({ handshake: 'pending' })
    const { mod, client } = await openTabClient(surface)
    const notified: number[] = []
    client.observe((state) => notified.push(state.layoutRevision))

    expect(await client.load()).toBeNull()
    expect(surface.calls.tabsGetSnapshot).toBe(0)

    surface.settleHandshake('ok')
    await runWindowHandshake(surface, mod)
    await settle()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await settle()

    expect(surface.calls.tabsGetSnapshot).toBe(1) // ② 恰好一次；④ 自动补读（无人调用 load()）
    expect(client.getState()?.tabs).toHaveLength(1)
    expect(notified).toEqual([3])
    // 就绪探测绝不额外打别的通道：整个用例只用了「既有握手 + 一次权威读取」。
    expect({
      getHostContext: surface.calls.getHostContext, getSnapshot: surface.calls.getSnapshot,
      command: surface.calls.command, tabsCommand: surface.calls.tabsCommand,
      tabsHostLifecycle: surface.calls.tabsHostLifecycle
    }).toEqual({ getHostContext: 1, getSnapshot: 0, command: 0, tabsCommand: 0, tabsHostLifecycle: 0 })
  })

  it('⑤ 生产接线（真实 AppShell）：握手在飞 ⇒ 零 invoke 且不挂 Tab 条；握手成功 ⇒ 自动读取并挂载', { timeout: APP_SHELL_CASE_TIMEOUT_MS }, async () => {
    const surface = createSurface({ handshake: 'pending' })
    installShellPlatform(surface)
    const { AppShell } = await import('../AppShell')

    container = document.createElement('div')
    document.body.append(container)
    const current = createRoot(container)
    root = current
    await act(async () => { current.render(createElement(AppShell)) })
    await settle()

    expect(surface.calls.tabsGetSnapshot).toBe(0)
    expect(container.querySelector('[data-workspace-tab-strip]')).toBeNull()

    surface.settleHandshake('ok')
    await settle()
    await vi.waitFor(() => { expect(surface.calls.tabsGetSnapshot).toBe(1) }, { timeout: CONDITION_TIMEOUT_MS })
    await vi.waitFor(() => { expect(container?.querySelector('[data-tab-item]')).not.toBeNull() }, { timeout: CONDITION_TIMEOUT_MS })
    expect(surface.calls.tabsGetSnapshot).toBe(1)
  })
})
