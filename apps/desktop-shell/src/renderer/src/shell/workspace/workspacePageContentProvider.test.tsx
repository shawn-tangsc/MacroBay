// @vitest-environment happy-dom
/**
 * Owner: apps/desktop-shell renderer / workspace 页面窗正文（P2-03 F1）。回归：本文件。
 * 权威：技术设计 §3/§6、A-T03「每类菜单 Tab 分离/回主窗」、A-T09「流式进行中分离：终态到新窗」，
 * 以及 PM 的 F1 证据要求。
 *
 * 证据口径（刻意不用「provider 被调用」代替 DOM）：
 *  ① 内置页在 detached 页窗里渲染出**真实正文标记**（`AgentPage` 自己的 `section.agent-page`，不是占位壳）；
 *  ② detach 之后一次**受控增量**（`agents.onStateChanged`）使页窗 DOM 更新（新智能体名出现在 DOM 里）；
 *     并同时验证页窗的受控 workspace 订阅到达时正文**不被卸载**（增量不重建、草稿/会话不丢）；
 *  ③ 产品 fixture 页同样渲染真实正文（动态 import 的 fixture 模块 default 组件）；
 *  ④ 非归属窗口 fail closed（error-shell、**0 订阅**）。
 * 全部用 fake preload（不启动 Electron、不读真实 profile/密钥、不加载产品代码）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { act, createElement, useMemo } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentWorkspaceEntity } from '@platform/ai/agent-platform/schemas/workspaceSchemas'
import { createAgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import { createDefaultAppSettings, type AppLanguage } from '@platform/settings/schema/appSettings'
import type { GeneratedProductMenuEntry } from '@platform/product-registry/types'
import type { WorkspaceTabSnapshot } from '@platform/workspace/contracts'
import { platformText } from '../../i18n/platformText'
import { WorkspacePageHost } from './WorkspacePageHost'
import { WorkspaceWindowRoot, type WorkspaceWindowRootProps } from './WorkspaceWindowRoot'
import { createWorkspacePageContentProvider, readDetachedPagePlatform } from './workspacePageContentProvider'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const PAGE_WINDOW_ID = 'window-page-1'
const TAB_KEY = 'workspace-page-1'
const CREATED_AT = '2026-01-01T00:00:00.000Z'

/**
 * PLAT-12：本 describe 的用例渲染**真实页面正文 / 真实页窗宿主**（动态 import + 真实 store），只有平台面是受控的。
 * 实测（单跑 3 次 / 干净并集）：单用例最重 0.15–0.34s；历史 flaky 记录（P2-11/P2-12）为 ② 在并集里
 * 被外部负载饿到 >5s 而触发默认用例超时（同目录同类用例最坏记录 0.31s → 6.9s ≈ 22x）。
 * ⇒ 给**本 describe**（非全局、非全文件）一个有界预算：0.34s × 22 ≈ 7.5s，取 15s。
 * 预算仍然有界：真挂起 / 真回归照样在 15s 失败。断言语义一字未改（本轮只加预算）。
 */
const SHELL_RENDER_TIMEOUT_MS = 15_000

let container: HTMLDivElement | undefined
let root: Root | undefined

afterEach(() => {
  if (root !== undefined) act(() => root?.unmount())
  container?.remove()
  container = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
  window.localStorage.clear()
})

function agent(id: string, name: string): AgentEntity {
  return {
    id, type: 'claude-code', name, model: `provider:${id}`, modelName: id,
    createdAt: CREATED_AT, updatedAt: CREATED_AT, orderKey: id, configuration: {}
  }
}

type Harness = ReturnType<typeof createDetachedPageHarness>

function createDetachedPageHarness(options: {
  owned?: boolean
  productEntries?: readonly GeneratedProductMenuEntry[]
} = {}) {
  const state = {
    agentStateSubscribers: 0,
    runtimeStateSubscribers: 0,
    channelRuntimeStateSubscribers: 0,
    workspaceEventSubscribers: 0,
    tabSnapshotCalls: 0,
    releasedWorkspaceListeners: 0,
    settings: createDefaultAppSettings()
  }
  const agentStateListeners = new Set<(next: unknown) => void>()
  const workspaceEventListeners = new Set<(event: unknown) => void>()

  const settingsApi = {
    get: async () => state.settings,
    update: async (patch: unknown) => {
      state.settings = { ...state.settings, ...(patch as Record<string, unknown>) }
      return state.settings
    }
  }
  const tab = {
    workspaceInstanceKey: TAB_KEY, pageId: 'agents', menuKey: 'agents', open: true, order: 0,
    mode: 'detached' as const, bindingState: 'bound' as const,
    windowInstanceId: options.owned === false ? 'window-someone-else' : PAGE_WINDOW_ID, hostEpoch: 1
  }

  Reflect.set(window, 'platform', {
    settings: settingsApi,
    modelProviders: { list: async () => [] },
    window: { setMinimumSize: async () => undefined, resetMinimumSize: async () => undefined },
    // AgentPage 子树在挂载期会读这些受控能力：缺失会让真实正文抛错（这里按真实 preload 形状补齐）
    app: {
      listExternalApps: async () => [],
      launchExternalAppWorkspace: async () => ({ status: 'launched' }),
      onQuotedToMain: () => () => undefined,
      openExternal: async () => undefined,
      openPath: async () => undefined,
      quoteToMainWindow: async () => undefined,
      readTextFile: async () => '',
      selectDirectory: async () => null,
      selectFiles: async () => []
    },
    agents: {
      getState: async () => agentState('Research Agent', 'Research session'),
      replaceState: async () => undefined,
      getRuntimeSnapshot: async () => ({
        sessions: {}, toolApprovals: [], toolApprovalHistory: [], chunksBySessionId: {}, updatedAt: ''
      }),
      getChannelRuntimeSnapshot: async () => ({ channels: [] }),
      getModelGatewayStatus: async () => null,
      onStateChanged: (listener: (next: unknown) => void) => {
        state.agentStateSubscribers += 1
        agentStateListeners.add(listener)
        return () => { state.agentStateSubscribers -= 1 }
      },
      onRuntimeStateChanged: () => {
        state.runtimeStateSubscribers += 1
        return () => { state.runtimeStateSubscribers -= 1 }
      },
      onChannelRuntimeStateChanged: () => {
        state.channelRuntimeStateSubscribers += 1
        return () => { state.channelRuntimeStateSubscribers -= 1 }
      }
    },
    workspace: {
      getHostContext: async () => ({
        status: 'ok',
        context: {
          windowInstanceId: PAGE_WINDOW_ID, hostEpoch: 1, role: 'panel', mounts: [], pendingTransfer: null,
          layoutRevision: 3, pageIds: ['agents'], preferences: { language: 'en-US', theme: 'dark' }
        }
      }),
      getSnapshot: async () => ({
        status: 'ok',
        snapshot: {
          layoutRevision: 3, activeWorkspaceInstanceKey: null, panels: [], pageLayouts: [], tabs: [],
          persistenceState: 'saved'
        }
      }),
      command: async () => ({ status: 'rejected', errorCode: 'unsupported', snapshot: null }),
      tabsGetSnapshot: async () => {
        state.tabSnapshotCalls += 1
        return {
          status: 'ok',
          snapshot: { layoutRevision: 2, activeWorkspaceInstanceKey: TAB_KEY, tabs: [tab] }
        }
      },
      tabsCommand: async () => ({
        status: 'rejected', errorCode: 'invalid-request',
        snapshot: { layoutRevision: 2, activeWorkspaceInstanceKey: null, tabs: [] }
      }),
      onEvent: (listener: (event: unknown) => void) => {
        state.workspaceEventSubscribers += 1
        workspaceEventListeners.add(listener)
        return () => {
          state.workspaceEventSubscribers -= 1
          state.releasedWorkspaceListeners += 1
          workspaceEventListeners.delete(listener)
        }
      }
    }
  })

  return {
    state,
    tab,
    /** 受控增量：Main 推送新的 agent 状态（真实 `agents.onStateChanged` 通道）。 */
    pushAgentState: (next: unknown) => { for (const listener of [...agentStateListeners]) listener(next) },
    /** 受控增量：workspace 定向事件（真实 `platform:workspace-event` 通道）。 */
    pushWorkspaceEvent: (event: unknown) => { for (const listener of [...workspaceEventListeners]) listener(event) },
    productEntries: options.productEntries
  }
}

const workspace: AgentWorkspaceEntity = {
  id: 'workspace-1', name: 'Workspace', path: '/Users/demo/project', type: 'user',
  orderKey: 'workspace-1', createdAt: CREATED_AT, updatedAt: CREATED_AT
}

function session(id: string, agentId: string, name: string): AgentSessionEntity {
  return {
    id, agentId, name, workspaceId: workspace.id, workspace, orderKey: id,
    createdAt: CREATED_AT, updatedAt: CREATED_AT
  }
}

/** 受控增量载荷：真实 `AgentStoreState`（含一个会话，因此正文 DOM 里会出现会话名）。 */
function agentState(name: string, sessionName: string) {
  return createAgentStoreState({
    agents: [agent('agent-1', name)],
    sessions: [session('session-1', 'agent-1', sessionName)],
    workspaces: [workspace],
    activeAgentId: 'agent-1',
    activeSessionId: 'session-1'
  })
}

async function renderPageWindow(harness: Harness): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const current = root
  await act(async () => {
    current.render(createElement(WorkspaceWindowRoot, {} as WorkspaceWindowRootProps))
  })
  await settle()
  return container
}

async function settle(turns = 12): Promise<void> {
  await act(async () => {
    for (let index = 0; index < turns; index += 1) await Promise.resolve()
  })
}

describe('P2-03 F1：独立页窗渲染真实页面正文', { timeout: SHELL_RENDER_TIMEOUT_MS }, () => {
  it('① renders the real built-in agents page body (not a placeholder) and ④ keeps the page window subscribed once', async () => {
    const harness = createDetachedPageHarness()
    const view = await renderPageWindow(harness)

    // 真实正文：`AgentPage` 自己的根节点（占位壳只会给 data-page-body-status / data-page-missing）
    expect(view.querySelector('section.agent-page')).not.toBeNull()
    expect(view.querySelector('[data-page-body="agents"]')).not.toBeNull()
    expect(view.querySelector('[data-page-body-status]')).toBeNull()
    expect(view.querySelector('[data-page-missing="true"]')).toBeNull()
    expect(view.querySelector('[data-window-shell="error"]')).toBeNull()

    // 受控挂载点与订阅：页窗恰好一条 workspace 订阅 + AgentPage 自己的受控订阅
    expect(harness.state.tabSnapshotCalls).toBeGreaterThan(0)
    expect(harness.state.workspaceEventSubscribers).toBe(1)
    expect(harness.state.agentStateSubscribers).toBe(1)
    expect(harness.state.runtimeStateSubscribers).toBe(1)
  })

  it('② one controlled increment after detach updates the page-window DOM without unmounting the body', async () => {
    const harness = createDetachedPageHarness()
    const view = await renderPageWindow(harness)
    expect(view.textContent ?? '').toContain('Research session')
    expect(view.textContent ?? '').not.toContain('Realtime detached session')

    // 受控增量 ①：Main 推送新的 agent 状态（`agents.onStateChanged`）⇒ 页窗 DOM 就地更新
    await act(async () => { harness.pushAgentState(agentState('Realtime Detached Agent', 'Realtime detached session')) })
    await settle()

    expect(view.textContent ?? '').toContain('Realtime detached session')
    // 正文仍在（增量绝不重建/卸载页面），订阅数不变（无重复订阅、无泄漏）
    expect(view.querySelector('section.agent-page')).not.toBeNull()
    expect(harness.state.agentStateSubscribers).toBe(1)
    expect(harness.state.workspaceEventSubscribers).toBe(1)

    // 受控增量 ②：workspace 定向事件到达 ⇒ 页窗重取受控快照并就地更新（不卸载、订阅数不变）
    harness.state.tabSnapshotCalls = 0
    await act(async () => {
      harness.pushWorkspaceEvent({ type: 'container-changed', layoutRevision: 9, scope: { workspaceInstanceKey: TAB_KEY } })
    })
    await settle()

    expect(harness.state.tabSnapshotCalls).toBeGreaterThan(0)
    expect(view.querySelector('section.agent-page')).not.toBeNull()
    expect(view.textContent ?? '').toContain('Realtime detached session')
    expect(harness.state.workspaceEventSubscribers).toBe(1)
    expect(harness.state.agentStateSubscribers).toBe(1)

    // 页窗卸载（回停靠/关闭）⇒ 受控订阅全部释放（旧 listeners 清零，绝不泄漏）
    await act(async () => { root?.unmount() })
    root = undefined
    expect(harness.state.workspaceEventSubscribers).toBe(0)
    expect(harness.state.agentStateSubscribers).toBe(0)
    expect(harness.state.runtimeStateSubscribers).toBe(0)
    expect(harness.state.channelRuntimeStateSubscribers).toBe(0)
  })

  it('③ renders a product fixture page body through the real dynamic-import loader', async () => {
    const fixtureEntries: GeneratedProductMenuEntry[] = [{
      id: 'dashboard', productId: 'market-intelligence', productName: { 'zh-CN': '情报模块', 'en-US': 'Market Intelligence' },
      title: { 'zh-CN': '行情面板', 'en-US': 'Market dashboard' }, icon: 'chart-candlestick', order: 1,
      routePath: '/market-intelligence/dashboard',
      load: async () => ({
        default: () => createElement('div', { 'data-fixture-page': 'market-intelligence.dashboard' }, 'Market dashboard fixture body')
      })
    }]
    const harness = createDetachedPageHarness({ productEntries: fixtureEntries })
    // 用注入的产品菜单条目装配页窗 provider（生产缺省取生成注册表）
    const provider = createWorkspacePageContentProvider({ menuEntries: fixtureEntries })
    const body = provider.render({ pageId: 'market-intelligence.dashboard', menuKey: '/market-intelligence/dashboard', language: 'en-US', active: true })
    expect(body).not.toBeNull()

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const current = root
    await act(async () => { current.render(createElement('div', null, body)) })
    await settle(20)

    expect(container.querySelector('[data-page-body="market-intelligence.dashboard"]')).not.toBeNull()
    expect(container.querySelector('[data-fixture-page="market-intelligence.dashboard"]')).not.toBeNull()
    expect(container.textContent ?? '').toContain('Market dashboard fixture body')
    expect(harness.productEntries).toBe(fixtureEntries)
  })

  it('④ fails closed for a window that does not own the tab: error shell and zero subscriptions', async () => {
    const harness = createDetachedPageHarness({ owned: false })
    const view = await renderPageWindow(harness)

    expect(view.querySelector('section.agent-page')).toBeNull()
    expect(view.querySelector('[data-page-body="agents"]')).toBeNull()
    expect(view.querySelector('[data-window-shell="page"]')).toBeNull()
    expect(view.querySelector('[data-window-shell="error"]')).not.toBeNull()
    // 未归属的窗口绝不留下任何订阅（含 AgentPage 的受控订阅）
    expect(harness.state.workspaceEventSubscribers).toBe(0)
    expect(harness.state.agentStateSubscribers).toBe(0)
    expect(harness.state.runtimeStateSubscribers).toBe(0)
    expect(harness.state.releasedWorkspaceListeners).toBe(0)
  })

  it('renders the real settings body with the shell nav and the host-only panel boundary declared', async () => {
    const harness = createDetachedPageHarness()
    const provider = createWorkspacePageContentProvider()
    const body = provider.render({ pageId: 'settings', menuKey: 'settings', language: 'en-US', active: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const current = root
    await act(async () => { current.render(createElement('div', null, body)) })
    await settle(20)

    expect(container.querySelector('[data-page-body="settings"]')).not.toBeNull()
    // 真实设置导航（键值来自 shell 同一投影）+ 真实的 web-search 面板正文
    expect(container.querySelector('.settings-nav')).not.toBeNull()
    expect(container.querySelector('[data-page-body-panel="web-search"]')).not.toBeNull()
    expect(container.querySelector('.web-search-settings')).not.toBeNull()
    expect(container.querySelector('[data-page-panel="host-only"]')).toBeNull()
    expect(harness.state.settings.agent).toBeDefined()
  })

  it('keeps the detached page provider and the shell on one dispatch table (source guard)', () => {
    const root = resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/workspace/workspacePageContentProvider.tsx')
    const source = readFileSync(root, 'utf8')
    // 单一派发表：内置页仍走 `builtInPageAdapters`，provider 不自建第二份 pageId → 正文映射
    expect(source).toContain('createBuiltInPageAdapters')
    expect(source).not.toContain('agent-1')
    // PLAT-39 ②：页面窗内容面按 PLAT-02 行数纪律抽到 WorkspacePageWindowSurface.tsx（渲染点随之搬）
    const windowRoot = readFileSync(
      resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/workspace/WorkspacePageWindowSurface.tsx'),
      'utf8'
    )
    expect(windowRoot).toContain('createWorkspacePageContentProvider')
    expect(windowRoot).toContain('WorkspacePageHost')
    // 旧的中性占位壳必须彻底消失（F1：不再使用占位壳）
    // 旧的中性占位壳组件必须消失（panel 内容侧的既有 placeholder 文案与此无关）
    expect(windowRoot).not.toContain('WorkspacePageWindowShell')
  })

  it('reads the detached page platform structurally and fails closed on a partial platform', () => {
    expect(readDetachedPagePlatform({ platform: {}, localStorage: window.localStorage })).toBeNull()
    expect(readDetachedPagePlatform({
      platform: { settings: { get: () => undefined }, modelProviders: { list: () => undefined } },
      localStorage: window.localStorage
    })).toBeNull()
    expect(readDetachedPagePlatform({ platform: { settings: { get: () => undefined, update: () => undefined }, modelProviders: { list: () => undefined } } })).toBeNull()
    // 完整受控面（页窗 harness 安装的 platform）⇒ 可读
    createDetachedPageHarness()
    const complete = readDetachedPagePlatform(window)
    expect(complete).not.toBeNull()
    expect(typeof complete?.settings.update).toBe('function')
  })
})

/**
 * P2-12（同族缺陷审计）：正文派发层的「冻结闭包」等价形态。
 *
 * P2-11 的根因是「memo 化的 provider 把**读取渲染期值的闭包**一起冻结」。同判据落在页窗正文 mounts 上：
 * `WorkspacePageWindowSurface` 以 `useMemo(() => createWorkspacePageContentProvider(), [])` **长期持有**该
 * provider（跨窗口/跨挂载），因此 provider **不得**把渲染期语言写进实例级可变变量、再由 mounts 闭包去读——
 * 那会让正文的语言取决于「provider 创建/上一次调用」而不是「本次 render 的入参」。
 *
 * 证据口径：
 *  - 结构性 RED（修复前失败）：源码里不得存在实例级 `detachedLanguage` 缓存（本文件既有 source guard 同惯例）；
 *  - 行为锁定（修复前后都必须绿，证明改法**行为等价**、不引入回归）：同一个 provider 实例每次 render 都必须用
 *    **当次入参语言**构造正文 —— 用真实 DOM（detached `settings` 正文的设置导航文案）观测。
 */
describe('P2-12：页窗正文语言只在调用时从 render 入参派生', () => {
  it('结构性守卫：provider 不得把渲染期语言写进实例级可变变量', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/workspace/workspacePageContentProvider.tsx'),
      'utf8'
    )
    expect(source).not.toMatch(/\blet\s+detachedLanguage\b/)
  })

  it('行为锁定：同一 provider 实例每次 render 都用当次入参语言构造正文', async () => {
    installProviderOnlyPlatform()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => { root?.render(createElement(LanguageProbe, { language: 'en-US' })) })
    await settle()
    expect(container.textContent).toContain(platformText['en-US'].settings.assistantLibrary)
    expect(container.textContent).not.toContain(platformText['zh-CN'].settings.assistantLibrary)

    await act(async () => { root?.render(createElement(LanguageProbe, { language: 'zh-CN' })) })
    expect(container.textContent).toContain(platformText['zh-CN'].settings.assistantLibrary)
    expect(container.textContent).not.toContain(platformText['en-US'].settings.assistantLibrary)
  })
})

/** 页窗正文数据面的最小受控形状（`readDetachedPagePlatform` 要求 settings/modelProviders/localStorage 齐备）。 */
function installProviderOnlyPlatform(): void {
  Object.defineProperty(window, 'platform', {
    configurable: true,
    value: {
      settings: {
        get: async () => ({ ...createDefaultAppSettings(), language: 'en-US' }),
        update: async () => createDefaultAppSettings()
      },
      modelProviders: { list: async () => [] }
    } as unknown as Window['platform']
  })
}

const languageProbeTab: WorkspaceTabSnapshot = Object.freeze({
  workspaceInstanceKey: 'workspace-language-probe', pageId: 'settings', menuKey: 'settings', open: true, order: 0,
  mode: 'main', bindingState: 'bound', windowInstanceId: PAGE_WINDOW_ID, hostEpoch: 1
})

/** 与 `WorkspacePageWindowSurface` 同姿态：provider 在一个 `useMemo(..., [])` 里跨渲染长期持有。 */
function LanguageProbe({ language }: { language: AppLanguage }): React.ReactElement {
  const provider = useMemo(() => createWorkspacePageContentProvider(), [])
  return createElement(WorkspacePageHost, {
    language,
    state: { layoutRevision: 1, activeWorkspaceInstanceKey: languageProbeTab.workspaceInstanceKey, tabs: [languageProbeTab] },
    renderPage: ({ tab }) => provider.render({ pageId: tab.pageId, menuKey: tab.menuKey, language, active: true })
  })
}
