// @vitest-environment happy-dom
/**
 * Owner: apps/desktop-shell renderer / workspace 窗口组合（P1-06b）。回归：本文件。
 * 权威：P1-06a 的受控 workspace IPC（getHostContext/getSnapshot/command/onEvent）与 P1-03 宿主契约。
 *
 * 本文件用 fake preload 注入 `window.platform.workspace`：不启动 Electron、不读真实 profile/userData/Vault，
 * 不加载任何产品模块。断言目标只有「组合与 IPC 映射」：角色选择、视图构造、快照权威、退订与边界。
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { toThemeAttributes } from '@platform/ui/theme/themeModel'
import type { WorkspacePanelRegistration, WorkspaceSnapshot, WorkspaceTabState } from '@platform/workspace/contracts'
import { platformText } from '../../i18n/platformText'
import { applyRootThemeAttributes, panelRootThemeAttributes, WorkspaceWindowRoot, type WorkspaceWindowRootProps } from './WorkspaceWindowRoot'
import { createWorkspaceClient, type WorkspaceBridge } from './workspaceClient'

/**
 * PLAT-03 观测面：happy-dom 不承载 `layoutRevision`（没有任何 DOM 属性承载它），因此取证落在
 * **组件契约边界**上：记录 `WorkspacePageHost` *收到*的 state。这里只在测试侧 mock 消费点，
 * 不给生产代码加测试专用出口，也不改变 WorkspaceWindowRoot 的任何行为。
 */
const observedPageHostStates = vi.hoisted(() => [] as unknown[])
vi.mock('./WorkspacePageHost', () => ({
  WorkspacePageHost: (props: { state: unknown }) => {
    observedPageHostStates.push(props.state)
    return null
  }
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const labels = platformText['en-US'].workspace
const zhLabels = platformText['zh-CN'].workspace
/** 异步链路（readHostContext → loadSnapshot → observe）的确定性微任务排空轮数，不使用定时器。 */
const FLUSH_TURNS = 12
const WORKSPACE_KEY = 'ws-1'
const PANEL_KEY = 'panel-1'
const PANEL_ID = 'platform.inspector'
const HOST_WINDOW_ID = 'panel-host-1'

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

/** 空转若干微任务轮，验证「act 内没有残留 pending 链路」。 */
async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < FLUSH_TURNS; turn += 1) await Promise.resolve()
  })
}

function snapshotWith(revision: number, options: { open?: boolean; mode?: 'embedded' | 'docked-right' } = {}): WorkspaceSnapshot {
  return {
    layoutRevision: revision,
    activeWorkspaceInstanceKey: WORKSPACE_KEY,
    panels: [{
      workspaceInstanceKey: WORKSPACE_KEY,
      panelInstanceKey: PANEL_KEY,
      panelId: PANEL_ID,
      open: options.open ?? true,
      mode: options.mode ?? 'embedded',
      presentation: 'normal',
      bindingState: 'bound',
      windowInstanceId: HOST_WINDOW_ID,
      hostEpoch: 1,
      lastValidDock: 'embedded'
    }],
    pageLayouts: [{ workspaceInstanceKey: WORKSPACE_KEY, panelOrder: [PANEL_KEY], activePanels: { embedded: PANEL_KEY } }],
    tabs: [],
    persistenceState: 'saved'
  }
}

function hostContext(
  role: 'main' | 'panel',
  overrides: { language?: string; mounts?: unknown[]; revision?: number; theme?: string } = {}
) {
  return {
    status: 'ok',
    context: {
      windowInstanceId: HOST_WINDOW_ID,
      hostEpoch: 1,
      role,
      mounts: overrides.mounts ?? [{
        workspaceInstanceKey: WORKSPACE_KEY, panelInstanceKey: PANEL_KEY, panelId: PANEL_ID,
        open: true, mode: 'embedded', bindingState: 'bound'
      }],
      layoutRevision: overrides.revision ?? 7,
      pageIds: ['platform.demo'],
      preferences: { language: overrides.language ?? 'en-US', theme: overrides.theme ?? 'system' }
    }
  }
}

type FakeBridgeState = {
  listeners: Set<(event: unknown) => void>
  commandRequests: Record<string, unknown>[]
  snapshotCalls: number
  contextCalls: number
  unsubscribes: number
}

function createFakeBridge(options: {
  contextOutcome: unknown
  snapshots?: WorkspaceSnapshot[]
  commandResult?: (request: Record<string, unknown>) => unknown
}): { bridge: WorkspaceBridge; state: FakeBridgeState; emit: (event: unknown) => void; pushSnapshot: (snapshot: WorkspaceSnapshot) => void } {
  const snapshots = options.snapshots ?? [snapshotWith(7)]
  const state: FakeBridgeState = {
    listeners: new Set<(event: unknown) => void>(),
    commandRequests: [],
    snapshotCalls: 0,
    contextCalls: 0,
    unsubscribes: 0
  }
  const bridge: WorkspaceBridge = {
    getHostContext: async () => {
      state.contextCalls += 1
      return options.contextOutcome
    },
    getSnapshot: async () => {
      state.snapshotCalls += 1
      return { status: 'ok', snapshot: snapshots[snapshots.length - 1] }
    },
    command: async (request: unknown) => {
      const record = request as Record<string, unknown>
      state.commandRequests.push(record)
      if (options.commandResult) return options.commandResult(record)
      return { status: 'applied', snapshot: snapshots[snapshots.length - 1], panelInstanceKey: PANEL_KEY }
    },
    onEvent: (listener) => {
      state.listeners.add(listener)
      return () => {
        state.unsubscribes += 1
        state.listeners.delete(listener)
      }
    }
  }
  return {
    bridge,
    state,
    emit: (event) => { for (const listener of [...state.listeners]) listener(event) },
    pushSnapshot: (snapshot) => { snapshots.push(snapshot) }
  }
}

/** 注入 fake preload；`null` 表示该渲染环境根本没有 workspace 桥。 */
function installBridge(bridge: WorkspaceBridge | null, tabs?: Record<string, unknown> | null): void {
  if (bridge === null) {
    Reflect.deleteProperty(window, 'platform')
    return
  }
  Reflect.set(window, 'platform', { workspace: { ...bridge, ...(tabs ?? {}) } })
}

/** P2-03：`.tabs.*` 的 fake 桥（页面窗归属判定与受控挂载点）。 */
function createFakeTabsBridge(owned: boolean): { tabs: Record<string, unknown>; state: { snapshotCalls: number; listeners: number } } {
  const state = { snapshotCalls: 0, listeners: 0 }
  const tab = {
    workspaceInstanceKey: 'ws-page-1',
    pageId: 'agents',
    menuKey: 'agents',
    open: true,
    order: 0,
    mode: 'detached',
    bindingState: 'bound',
    windowInstanceId: HOST_WINDOW_ID,
    hostEpoch: 1
  }
  return {
    state,
    tabs: {
      tabsGetSnapshot: async () => {
        state.snapshotCalls += 1
        return {
          status: 'ok',
          snapshot: {
            layoutRevision: 2,
            activeWorkspaceInstanceKey: 'ws-page-1',
            tabs: [owned ? tab : { ...tab, windowInstanceId: 'window-someone-else' }]
          }
        }
      },
      tabsCommand: async () => ({ status: 'rejected', errorCode: 'invalid-request', snapshot: { layoutRevision: 2, activeWorkspaceInstanceKey: null, tabs: [] } }),
      onEvent: (listener: (event: unknown) => void) => {
        state.listeners += 1
        void listener
        return () => { state.listeners -= 1 }
      }
    }
  }
}

async function renderRoot(
  bridge: WorkspaceBridge | null,
  props: Partial<WorkspaceWindowRootProps> = {},
  children?: ReactNode
): Promise<HTMLDivElement> {
  installBridge(bridge)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const current = root
  await act(async () => {
    current.render(createElement(WorkspaceWindowRoot, props as WorkspaceWindowRootProps, children))
  })
  await settle()
  return container
}

/** P1-06h：待接管目标投影（mounts 恒空 + 受控 pendingTransfer），用于渲染准备期壳。 */
function pendingContext(language: string, theme = 'system'): unknown {
  return {
    status: 'ok',
    context: {
      ...hostContext('panel', { language, mounts: [], theme }).context,
      pendingTransfer: {
        status: 'in-flight', operationId: 'operation-1', phase: 'awaiting-target-ready',
        workspaceInstanceKey: WORKSPACE_KEY, panelInstanceKey: PANEL_KEY, panelId: PANEL_ID
      }
    }
  }
}

/**
 * 渲染「准备期壳」：只有拿到受控待接管视图**且**具备 hostLifecycle 能力的窗口才会进入 pending
 * （否则按 P1-06f 语义维持 error-shell），因此这里显式给 fake 桥补上 ACK 能力。
 */
async function renderPendingRoot(options: {
  language: string
  fallbackLanguage?: WorkspaceWindowRootProps['fallbackLanguage']
  registrations?: readonly WorkspacePanelRegistration[]
  theme?: string
}): Promise<HTMLDivElement> {
  const empty = { ...snapshotWith(7), panels: [], pageLayouts: [], activeWorkspaceInstanceKey: null } as WorkspaceSnapshot
  const fake = createFakeBridge({ contextOutcome: pendingContext(options.language, options.theme ?? 'system'), snapshots: [empty] })
  const bridge: WorkspaceBridge = { ...fake.bridge, hostLifecycle: async () => ({ accepted: false }) }
  return await renderRoot(bridge, {
    fallbackLanguage: options.fallbackLanguage ?? 'en-US',
    ...(options.registrations === undefined ? {} : { registrations: options.registrations })
  })
}

const registration: WorkspacePanelRegistration = {
  panelId: PANEL_ID,
  title: { 'en-US': 'Inspector', 'zh-CN': '检查器' },
  icon: 'file-text',
  module: 'platform.inspector',
  pageIds: ['platform.demo'],
  supportedModes: ['embedded', 'docked-right', 'docked-bottom'],
  defaultMode: 'embedded',
  allowMultipleInstances: false,
  minSize: { width: 200, height: 150 },
  preferredSize: { width: 300, height: 220 },
  binding: { persistence: 'none', maxKeyBytes: 256 },
  lifecycleEvents: ['open', 'close']
}

describe('WorkspaceWindowRoot 角色选择', () => {
  it('role:main 渲染注入的 shell children，且不挂载面板宿主', async () => {
    const fake = createFakeBridge({ contextOutcome: hostContext('main') })
    const host = await renderRoot(fake.bridge, {}, createElement('div', { 'data-shell': 'yes' }, 'SHELL-CONTENT'))
    expect(host.textContent).toContain('SHELL-CONTENT')
    expect(host.querySelector('.workspace-panel-host')).toBeNull()
    // P1-06f：主窗必须订阅权威快照，否则「源 source-prepared / source-released」无人发出（D1 的根因之一）；
    // 订阅只用于 ACK 链与布局同步，主窗渲染结果仍完全是 children，绝不挂载面板宿主
    expect(fake.state.listeners.size).toBe(1)
    // P1-06g 非阻塞③：对称断言 —— 卸载后必须退订回 0（主窗不释放 listener 就是事件泄漏）
    const current = root
    root = undefined
    await act(async () => { current?.unmount() })
    expect(fake.state.unsubscribes).toBe(1)
    expect(fake.state.listeners.size).toBe(0)
  })

  it('role:panel 只为上下文里自己承载的面板构造宿主，占位视图不 import 产品', async () => {
    const fake = createFakeBridge({ contextOutcome: hostContext('panel') })
    const host = await renderRoot(fake.bridge, { registrations: [registration] }, createElement('div', {}, 'SHELL-CONTENT'))
    expect(host.querySelector('.workspace-panel-host')).not.toBeNull()
    const frame = host.querySelector<HTMLElement>('section[data-panel-key="' + PANEL_KEY + '"]')
    expect(frame?.getAttribute('aria-label')).toBe('Inspector')
    // 面板宿主窗口绝不渲染主窗 shell 内容
    expect(host.textContent).not.toContain('SHELL-CONTENT')
    expect(host.textContent).toContain(labels.windowPanelPlaceholder)
  })

  it('role:panel 缺注册信息时退回安全占位注册（标题取受控 context 的 panelId）', async () => {
    const fake = createFakeBridge({ contextOutcome: hostContext('panel') })
    const host = await renderRoot(fake.bridge)
    const frame = host.querySelector<HTMLElement>('section[data-panel-key="' + PANEL_KEY + '"]')
    expect(frame?.getAttribute('aria-label')).toBe(PANEL_ID)
    expect(host.textContent).toContain(labels.windowPanelPlaceholder)
  })

  it('渲染环境没有 workspace 桥时保持既有 shell 行为（主窗兜底，不渲染 error-shell）', async () => {
    const host = await renderRoot(null, {}, createElement('div', {}, 'SHELL-CONTENT'))
    expect(host.textContent).toContain('SHELL-CONTENT')
    expect(host.textContent).not.toContain(labels.windowHostUnavailableTitle)
  })
})

describe('WorkspaceWindowRoot error-shell 与边界', () => {
  it('宿主上下文被拒绝时渲染安全 error-shell，不渲染 children、不抛异常', async () => {
    const fake = createFakeBridge({ contextOutcome: { status: 'rejected', errorCode: 'not-owner' } })
    const host = await renderRoot(fake.bridge, {}, createElement('div', {}, 'SHELL-CONTENT'))
    expect(host.textContent).toContain(labels.windowHostUnavailableTitle)
    expect(host.textContent).toContain(labels.windowHostUnavailableContext)
    expect(host.textContent).not.toContain('SHELL-CONTENT')
    expect(host.querySelector('[data-panel-key]')).toBeNull()
  })

  it('宿主返回畸形上下文（缺 windowInstanceId）时同样 fail closed', async () => {
    const broken = hostContext('panel') as { context: Record<string, unknown> }
    const fake = createFakeBridge({ contextOutcome: { status: 'ok', context: { ...broken.context, windowInstanceId: '' } } })
    const host = await renderRoot(fake.bridge, {}, createElement('div', {}, 'SHELL-CONTENT'))
    expect(host.textContent).toContain(labels.windowHostUnavailableTitle)
    expect(host.textContent).not.toContain('SHELL-CONTENT')
  })

  it('面板宿主没有任何可承载挂载时渲染安全 error-shell', async () => {
    const fake = createFakeBridge({ contextOutcome: hostContext('panel', { mounts: [] }) })
    const host = await renderRoot(fake.bridge)
    expect(host.textContent).toContain(labels.windowHostUnavailableTitle)
    expect(host.textContent).toContain(labels.windowHostUnavailablePanel)
  })

  it('挂载在权威快照里不存在时渲染安全 error-shell，不伪造面板', async () => {
    const empty = { ...snapshotWith(7), panels: [], pageLayouts: [], activeWorkspaceInstanceKey: null } as WorkspaceSnapshot
    const fake = createFakeBridge({ contextOutcome: hostContext('panel'), snapshots: [empty] })
    const host = await renderRoot(fake.bridge)
    expect(host.textContent).toContain(labels.windowHostUnavailablePanel)
    expect(host.querySelector('[data-panel-key]')).toBeNull()
  })

  it('完全忽略 URL 参数：伪造 pageId/panelId 不改变任何渲染结果', async () => {
    window.history.replaceState({}, '', '/?pageId=forged-page&panelId=forged-panel#/panel/forged-panel')
    const fake = createFakeBridge({ contextOutcome: hostContext('panel') })
    const host = await renderRoot(fake.bridge)
    expect(host.querySelector('section[data-panel-key="forged-panel"]')).toBeNull()
    expect(host.querySelectorAll('[data-panel-key]')).toHaveLength(1)
    expect(host.querySelector('section[data-panel-key="' + PANEL_KEY + '"]')).not.toBeNull()
    expect(host.textContent).not.toContain('forged')
    expect(fake.state.contextCalls).toBe(1)
  })
})

describe('WorkspaceWindowRoot 快照权威与订阅', () => {
  it('onEvent 的 snapshot 与增量事件都触发权威重取，未知事件被忽略', async () => {
    const fake = createFakeBridge({ contextOutcome: hostContext('panel'), snapshots: [snapshotWith(7)] })
    const host = await renderRoot(fake.bridge)
    const frame = () => host.querySelector<HTMLElement>('section[data-panel-key="' + PANEL_KEY + '"]')
    expect(frame()?.dataset.dock).toBe('embedded')
    expect(fake.state.snapshotCalls).toBe(1)

    fake.pushSnapshot(snapshotWith(8, { mode: 'docked-right' }))
    fake.emit({ type: 'snapshot', layoutRevision: 8, scope: { workspaceInstanceKey: WORKSPACE_KEY } })
    await settle()
    expect(fake.state.snapshotCalls).toBe(2)
    expect(frame()?.dataset.dock).toBe('docked-right')

    fake.pushSnapshot(snapshotWith(9))
    fake.emit({ type: 'container-changed', layoutRevision: 9, scope: { panelInstanceKey: PANEL_KEY } })
    await settle()
    expect(fake.state.snapshotCalls).toBe(3)
    expect(frame()?.dataset.dock).toBe('embedded')

    fake.emit({ type: 'not-a-workspace-event', layoutRevision: 99, scope: {} })
    fake.emit({ type: 'snapshot', layoutRevision: 'stale', scope: {} })
    await settle()
    expect(fake.state.snapshotCalls).toBe(3)
  })

  it('persistence-state 事件（revision 不变）也刷新权威快照', async () => {
    const fake = createFakeBridge({ contextOutcome: hostContext('panel'), snapshots: [snapshotWith(7)] })
    await renderRoot(fake.bridge)
    fake.pushSnapshot({ ...snapshotWith(7), persistenceState: 'pending' })
    fake.emit({ type: 'persistence-state', layoutRevision: 7, scope: {} })
    await settle()
    expect(fake.state.snapshotCalls).toBe(2)
  })

  it('卸载即退订：onEvent 的退订函数被调用且 listener 归零', async () => {
    const fake = createFakeBridge({ contextOutcome: hostContext('panel') })
    await renderRoot(fake.bridge)
    expect(fake.state.listeners.size).toBe(1)
    const current = root
    root = undefined
    await act(async () => { current?.unmount() })
    await settle()
    expect(fake.state.unsubscribes).toBeGreaterThanOrEqual(1)
    expect(fake.state.listeners.size).toBe(0)
  })
})

describe('WorkspaceWindowRoot 语言来源', () => {
  it('只取 context.preferences.language 白名单值，忽略 localStorage / URL / document.lang', async () => {
    window.localStorage.setItem('platform.language', 'zh-CN')
    window.localStorage.setItem('language', 'zh-CN')
    window.history.replaceState({}, '', '/?language=zh-CN&lang=zh-CN')
    document.documentElement.lang = 'zh-CN'
    const fake = createFakeBridge({ contextOutcome: hostContext('panel', { language: 'en-US' }) })
    const host = await renderRoot(fake.bridge)
    expect(host.textContent).toContain(labels.windowPanelPlaceholder)
    expect(host.textContent).not.toContain(zhLabels.windowPanelPlaceholder)
  })

  it('白名单外的语言值退回默认语言而不是照抄', async () => {
    const fake = createFakeBridge({ contextOutcome: hostContext('panel', { language: 'de-DE' }) })
    const host = await renderRoot(fake.bridge)
    expect(host.textContent).toContain(labels.windowPanelPlaceholder)
  })

  it('context 语言为 zh-CN 时用中文文案（注册信息标题也随之本地化）', async () => {
    const fake = createFakeBridge({ contextOutcome: hostContext('panel', { language: 'zh-CN' }) })
    const host = await renderRoot(fake.bridge, { registrations: [registration] })
    expect(host.textContent).toContain(zhLabels.windowPanelPlaceholder)
    expect(host.querySelector('section[data-panel-key]')?.getAttribute('aria-label')).toBe('检查器')
  })
})

describe('workspaceClient 端口映射', () => {
  it('P1-06d 提供 detach：复用 command 通道的 detachPanel，且只带 panelInstanceKey', async () => {
    const fake = createFakeBridge({
      contextOutcome: hostContext('panel'),
      commandResult: () => ({ status: 'applied', snapshot: snapshotWith(8), panelInstanceKey: PANEL_KEY })
    })
    const client = createWorkspaceClient(fake.bridge)
    await client.readHostContext()
    await client.loadSnapshot()

    const result = await client.port.detach?.({ panelInstanceKey: PANEL_KEY })
    expect(result?.status).toBe('applied')
    expect(fake.state.commandRequests).toHaveLength(1)
    expect(fake.state.commandRequests[0]).toMatchObject({
      method: 'detachPanel', panelInstanceKey: PANEL_KEY,
      expectedRevision: 7, windowInstanceId: HOST_WINDOW_ID, hostEpoch: 1
    })
    // renderer 不携带任何目标窗口身份/operationId/bounds：字段面就是 command 白名单
    expect(Object.keys(fake.state.commandRequests[0] ?? {}).sort()).toEqual(
      ['expectedRevision', 'hostEpoch', 'method', 'panelInstanceKey', 'requestId', 'windowInstanceId']
    )
  })

  it('命令带单调有界的 requestId、最近一次权威快照的 expectedRevision 与宿主身份', async () => {
    const fake = createFakeBridge({ contextOutcome: hostContext('panel') })
    const client = createWorkspaceClient(fake.bridge)
    expect((await client.readHostContext()).status).toBe('ok')
    await client.loadSnapshot()

    await client.port.activate({ panelInstanceKey: PANEL_KEY })
    await client.port.switchContainer({ panelInstanceKey: PANEL_KEY, mode: 'docked-bottom' })
    await client.port.close({ panelInstanceKey: PANEL_KEY })
    await client.port.resize({ panelInstanceKey: PANEL_KEY, size: { width: 320, height: 400 } })
    await client.port.reset({ panelInstanceKey: PANEL_KEY })
    await client.port.reopen({ panelInstanceKey: PANEL_KEY })

    const methods = fake.state.commandRequests.map((request) => request.method)
    expect(methods).toEqual(['activatePanel', 'switchContainer', 'closePanel', 'resizePanel', 'resetPanelSize', 'reopenPanel'])
    const ids = fake.state.commandRequests.map((request) => String(request.requestId))
    expect(new Set(ids).size).toBe(ids.length)
    ids.forEach((id, index) => {
      expect(id.length).toBeGreaterThan(0)
      expect(id.length).toBeLessThanOrEqual(200)
      if (index > 0) expect(id > ids[index - 1]).toBe(true)
    })
    for (const request of fake.state.commandRequests) {
      expect(request.expectedRevision).toBe(7)
      expect(request.windowInstanceId).toBe(HOST_WINDOW_ID)
      expect(request.hostEpoch).toBe(1)
    }
    expect(fake.state.commandRequests[3].dockSize).toEqual({ width: 320, height: 400 })
    expect(fake.state.commandRequests[1].mode).toBe('docked-bottom')
  })

  it('只消费权威 result.snapshot：畸形响应 fail closed 且不自造 revision', async () => {
    const fake = createFakeBridge({ contextOutcome: hostContext('panel'), commandResult: () => ({ status: 'applied' }) })
    const client = createWorkspaceClient(fake.bridge)
    await client.readHostContext()
    await expect(client.port.activate({ panelInstanceKey: PANEL_KEY })).rejects.toThrow()
    expect(client.getRevision()).toBe(7)
  })

  it('没有宿主身份/权威 revision 时拒绝发命令（fail closed）', async () => {
    const fake = createFakeBridge({ contextOutcome: hostContext('panel') })
    const client = createWorkspaceClient(fake.bridge)
    await expect(client.port.activate({ panelInstanceKey: PANEL_KEY })).rejects.toThrow()
    expect(fake.state.commandRequests).toHaveLength(0)
  })

  it('命令结果里的权威 snapshot 会被采纳为下一次命令的 expectedRevision', async () => {
    const fake = createFakeBridge({
      contextOutcome: hostContext('panel'),
      commandResult: () => ({ status: 'applied', snapshot: snapshotWith(11), panelInstanceKey: PANEL_KEY })
    })
    const client = createWorkspaceClient(fake.bridge)
    await client.readHostContext()
    await client.port.activate({ panelInstanceKey: PANEL_KEY })
    expect(client.getRevision()).toBe(11)
    await client.port.close({ panelInstanceKey: PANEL_KEY })
    expect(fake.state.commandRequests[1].expectedRevision).toBe(11)
  })

  it('observe 的退订函数幂等：退订后 onEvent listener 归零且不再收事件', async () => {
    const fake = createFakeBridge({ contextOutcome: hostContext('panel') })
    const client = createWorkspaceClient(fake.bridge)
    const seen: WorkspaceSnapshot[] = []
    const unsubscribe = client.observe((snapshot) => { seen.push(snapshot) })
    expect(fake.state.listeners.size).toBe(1)
    unsubscribe()
    unsubscribe()
    expect(fake.state.unsubscribes).toBe(1)
    expect(fake.state.listeners.size).toBe(0)
    fake.emit({ type: 'snapshot', layoutRevision: 8, scope: { workspaceInstanceKey: WORKSPACE_KEY } })
    await settle()
    expect(seen).toHaveLength(0)
  })
})

/**
 * P1-06h（N2）：面板窗的**准备期壳**与 **error-shell** 必须双语且必须有样式。
 * 真机症状（P1-07 记录项 N2）：面板窗 error-shell 恒英文（AppShell 没传 fallbackLanguage，缺省 en-US），
 * 且两个壳只有类名、`workspaceLayout.css` 里没有任何规则 ⇒ 未样式化错误页。
 */
describe('P1-06h：准备期壳与 error-shell 的本地化', () => {
  const zhWorkspace = platformText['zh-CN'].workspace

  it('error-shell 跟随 fallbackLanguage：zh-CN ⇒ 全中文文案（不再恒英文）', async () => {
    const fake = createFakeBridge({ contextOutcome: { status: 'rejected', errorCode: 'not-owner' } })
    const host = await renderRoot(fake.bridge, { fallbackLanguage: 'zh-CN' }, createElement('div', {}, 'SHELL-CONTENT'))

    expect(host.textContent).toContain(zhLabels.windowHostUnavailableTitle)
    expect(host.textContent).toContain(zhLabels.windowHostUnavailableContext)
    expect(host.textContent).not.toContain(labels.windowHostUnavailableTitle)
    expect(host.querySelector('[role="alert"]')?.className).toContain('workspace-window-error')
  })

  it('error-shell 白名单外的 fallbackLanguage ⇒ 安全回退 en-US，绝不照抄未知语言', async () => {
    const fake = createFakeBridge({ contextOutcome: { status: 'rejected', errorCode: 'not-owner' } })
    const host = await renderRoot(fake.bridge, { fallbackLanguage: 'de-DE' as never }, createElement('div', {}, 'SHELL-CONTENT'))

    expect(host.textContent).toContain(labels.windowHostUnavailableTitle)
    expect(host.textContent).toContain(labels.windowHostUnavailableContext)
  })

  /**
   * 面板窗里 `AppShellContent` 不会挂载 ⇒ 语言只能由 AppShell 自己从 settings 读取后下发；
   * 这里用源码护栏固定接线（不 import AppShell：那会把整个 shell + 产品页面依赖树拉进本文件的类型检查图，
   * 与「scoped tsc 只覆盖本包改动文件」的验收口径冲突）。语义本身由上面的 fallbackLanguage 用例覆盖。
   */
  it('AppShell 把当前语言下发给 WorkspaceWindowRoot（N2 真机回归护栏）', () => {
    const appShell = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/AppShell.tsx'), 'utf8')
    expect(appShell).toContain('<WorkspaceWindowRoot fallbackLanguage={appLanguage}>')
    // 旧写法（不传语言 ⇒ 组件缺省 en-US，面板窗错误页恒英文）绝不允许回归
    expect(appShell).not.toMatch(/<WorkspaceWindowRoot>\s*\n\s*<AppShellContent/u)
    // 与 shell 同源：语言来自 settings.get()，并由 shell 内容回传以跟随用户切换
    expect(appShell).toContain('window.platform.settings')
    expect(appShell).toContain('onLanguageChange')
  })

  it('准备期壳用受控上下文语言：context zh-CN ⇒ 中文正文与中文标题', async () => {
    const host = await renderPendingRoot({ language: 'zh-CN', fallbackLanguage: 'en-US', registrations: [registration] })
    const shell = host.querySelector<HTMLElement>('.workspace-window-preparing')
    expect(shell).not.toBeNull()
    expect(shell?.textContent).toContain(zhWorkspace.windowPreparingDetail)
    expect(shell?.getAttribute('aria-label')).toBe('检查器')
    expect(host.textContent).not.toContain(labels.windowHostUnavailableTitle)
  })

  it('准备期壳的 EN 用例：context en-US ⇒ 英文正文与英文标题', async () => {
    const host = await renderPendingRoot({ language: 'en-US', fallbackLanguage: 'zh-CN', registrations: [registration] })
    const shell = host.querySelector<HTMLElement>('.workspace-window-preparing')
    expect(shell?.textContent).toContain(labels.windowPreparingDetail)
    expect(shell?.getAttribute('aria-label')).toBe('Inspector')
  })

  it('准备期标题缺上下文语言条目时用 fallbackLanguage 兜底，绝不渲染 undefined', async () => {
    const englishOnly: WorkspacePanelRegistration = { ...registration, title: { 'en-US': 'Inspector' } as WorkspacePanelRegistration['title'] }
    const host = await renderPendingRoot({ language: 'zh-CN', fallbackLanguage: 'en-US', registrations: [englishOnly] })
    const shell = host.querySelector<HTMLElement>('.workspace-window-preparing')
    expect(shell?.getAttribute('aria-label')).toBe('Inspector')
    expect(host.textContent).not.toContain('undefined')
  })
})

describe('P1-06h：两个壳必须有样式（workspaceLayout.css）', () => {
  /** 壳样式的唯一来源：类必须真实存在于 CSS，且颜色只能来自主题变量。 */
  function shellRules(className: string): string[] {
    const css = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/workspace/workspaceLayout.css'), 'utf8')
    return css.match(new RegExp(`\\.${className}[^{]*\\{[^}]*\\}`, 'g')) ?? []
  }

  it('error-shell 与准备期壳的类都有真实规则，且只用主题变量、无硬编码色值', () => {
    for (const className of ['workspace-window-error', 'workspace-window-preparing']) {
      const rules = shellRules(className)
      expect(rules.length).toBeGreaterThan(0)
      for (const rule of rules) {
        expect(rule).toMatch(/var\(--/)
        expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
        expect(rule).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/)
      }
    }
    const css = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/workspace/workspaceLayout.css'), 'utf8')
    // 主题切换只由 root 的 data-theme + token 完成，壳不得自带第二套调色板
    expect(css).toContain('data-theme')
  })

  it('error-shell DOM 根节点带 workspace-window-error 类；准备期壳带 workspace-window-preparing 类', async () => {
    const fake = createFakeBridge({ contextOutcome: { status: 'rejected', errorCode: 'not-owner' } })
    const errorHost = await renderRoot(fake.bridge, { fallbackLanguage: 'en-US' }, createElement('div', {}, 'SHELL-CONTENT'))
    expect(errorHost.querySelector('.workspace-window-error')).not.toBeNull()

    const pendingHost = await renderPendingRoot({ language: 'en-US', fallbackLanguage: 'en-US' })
    expect(pendingHost.querySelector('.workspace-window-preparing')).not.toBeNull()
  })
})

/**
 * P1-06i（A）：面板窗根主题。
 * 真机症状（P1-06h 独立审查）：面板窗不挂载 `AppShellContent`（主窗才有那段 settings → root 属性效果），
 * `documentElement` 上没有任何主题属性 ⇒ 浅色用户在独立面板窗命中 `:root` 的暗色默认 token，
 * 且 `:root[data-theme='light'] .workspace-window-shell` 永不匹配。
 * 本组固定：唯一可信来源是受控 `context.preferences.theme`（N3 之后与 app 设置同源），
 * 绝不读 OS/URL/localStorage，也绝不自造默认值；主窗路径行为不变。
 */
describe('P1-06i（A）：面板窗根主题只跟随受控上下文', () => {
  afterEach(() => {
    for (const name of ['data-theme', 'data-theme-mode', 'data-accent']) {
      document.documentElement.removeAttribute(name)
    }
    vi.unstubAllGlobals()
  })

  it('context theme=light ⇒ 根节点 data-theme="light"：不读 OS/URL/localStorage，也不取暗色默认值', async () => {
    // 环境里到处都在喊「暗色」：OS 报暗、URL 与 localStorage 都伪造 dark，唯一可信来源只有受控上下文
    vi.stubGlobal('matchMedia', () => ({
      matches: true, addEventListener: () => undefined, removeEventListener: () => undefined
    }))
    window.localStorage.setItem('theme', 'dark')
    window.localStorage.setItem('platform.theme', 'dark')
    window.history.replaceState({}, '', '/?theme=dark#/panel/forged-panel')

    const fake = createFakeBridge({ contextOutcome: hostContext('panel', { theme: 'light' }) })
    await renderRoot(fake.bridge)

    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('context theme=dark ⇒ 根节点 data-theme="dark"', async () => {
    const fake = createFakeBridge({ contextOutcome: hostContext('panel', { theme: 'dark' }) })
    await renderRoot(fake.bridge)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('准备期壳（pending）同样跟随受控上下文主题，不回落默认值', async () => {
    await renderPendingRoot({ language: 'en-US', fallbackLanguage: 'en-US', theme: 'light' })
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('上下文主题为未解析的 system（renderer 绝不读 OS 自行解析）⇒ 不写属性', async () => {
    const fake = createFakeBridge({ contextOutcome: hostContext('panel', { theme: 'system' }) })
    await renderRoot(fake.bridge)
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
  })

  it('上下文主题是白名单外脏字符串 ⇒ 不写属性，绝不照抄到根节点', async () => {
    const fake = createFakeBridge({ contextOutcome: hostContext('panel', { theme: 'not-a-theme' }) })
    await renderRoot(fake.bridge)
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
  })

  it('role:main 不由本组件改写根属性（主窗属性仍由 shell 的 settings 效果负责）', async () => {
    const fake = createFakeBridge({ contextOutcome: hostContext('main', { theme: 'light' }) })
    await renderRoot(fake.bridge, {}, createElement('div', {}, 'SHELL-CONTENT'))
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
    expect(document.documentElement.getAttribute('data-accent')).toBeNull()
  })

  it('共享写入函数逐字写入主窗属性组（data-theme/data-theme-mode/data-accent 不被过滤或改名）', () => {
    applyRootThemeAttributes(toThemeAttributes('system', 'cyan', true))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme-mode')).toBe('system')
    expect(document.documentElement.getAttribute('data-accent')).toBe('cyan')
  })

  it('panelRootThemeAttributes 只产出 data-theme（不臆造 mode/accent），白名单外一律 null', () => {
    expect(panelRootThemeAttributes('dark')).toEqual({ 'data-theme': 'dark' })
    expect(panelRootThemeAttributes('light')).toEqual({ 'data-theme': 'light' })
    for (const rejected of ['system', '', 'Dark', 'light ', 'light;color:red']) {
      expect(panelRootThemeAttributes(rejected)).toBeNull()
    }
  })

  it('面板窗不写也不删自己不掌控的 data-accent（accent 尚不在受控 context 里，本包不越权）', async () => {
    document.documentElement.setAttribute('data-accent', 'violet')
    const fake = createFakeBridge({ contextOutcome: hostContext('panel', { theme: 'light' }) })
    await renderRoot(fake.bridge)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.getAttribute('data-accent')).toBe('violet')
  })

  it('主窗的 settings 效果改用同一写入函数（源码护栏：属性口径逐字一致）', () => {
    const appShell = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/AppShell.tsx'), 'utf8')
    expect(appShell).toContain('applyRootThemeAttributes(toThemeAttributes(settings.themeMode, settings.accentColor, media.matches))')
  })
})

describe('P2-03 独立页面窗（.tabs.* 受控归属）', () => {
  it('renders the scoped page-window shell for the window that owns the tab, and attaches a subscription', async () => {
    const { bridge } = createFakeBridge({ contextOutcome: hostContext('panel', { mounts: [] }) })
    const tabs = createFakeTabsBridge(true)
    installBridge(bridge, tabs.tabs)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const current = root
    await act(async () => {
      current.render(createElement(WorkspaceWindowRoot, {} as WorkspaceWindowRootProps))
    })
    await settle()

    const shell = container.querySelector('[data-window-shell="page"]')
    expect(shell).not.toBeNull()
    expect(shell?.getAttribute('data-page-id')).toBe('agents')
    // 受控挂载点被调用（Main 在此为该窗建立 router 订阅），且页面窗持有恰好一条订阅
    expect(tabs.state.snapshotCalls).toBeGreaterThan(0)
    expect(tabs.state.listeners).toBe(1)
    // 绝不渲染「没有可承载内容」的 error-shell：页面窗已正确归属
    expect(container.querySelector('[data-window-shell="error"]')).toBeNull()
  })

  it('keeps failing closed to the error shell when the tab belongs to another window', async () => {
    const { bridge } = createFakeBridge({ contextOutcome: hostContext('panel', { mounts: [] }) })
    const tabs = createFakeTabsBridge(false)
    installBridge(bridge, tabs.tabs)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const current = root
    await act(async () => {
      current.render(createElement(WorkspaceWindowRoot, {} as WorkspaceWindowRootProps))
    })
    await settle()

    expect(container.querySelector('[data-window-shell="page"]')).toBeNull()
    expect(container.querySelector('[data-window-shell="error"]')?.getAttribute('data-window-shell')).toBe('error')
    // 未归属的窗口绝不留下订阅
    expect(tabs.state.listeners).toBe(0)
  })
})

/**
 * PLAT-03：页窗 `state.layoutRevision` 的**语义**。
 *
 * 缺陷前：`WorkspacePageWindowSurface` 用 `tab.order`（Tab 在条带里的**位置**）冒充
 * `state.layoutRevision`（**布局权威 revision**）。两者是不同空间的值，因此
 *  - 页窗报出的 revision 与权威 Tab store 不一致（`tab.order` 是 0..n-1 的小整数）；
 *  - 顺序相同、revision 不同的两个 Tab 在页窗里**不可区分**（`order` 相同即看起来一样）；
 *  - 一旦 order 与 revision 不同，页窗拿到的是 order 而不是 revision。
 * 权威来源只有一个：`.tabs.getSnapshot` 的受控投影 `WorkspaceTabState.layoutRevision`
 * （Main 的 Tab runtime store 真实值，renderer 绝不合成/推导）。
 */
function observedPageStates(): WorkspaceTabState[] {
  return observedPageHostStates as WorkspaceTabState[]
}

const PAGE_TAB_KEY = 'ws-page-1'

/**
 * 页窗受控挂载点：权威快照按 `entries` 序列推进，`order` 与 `layoutRevision` **故意解耦**
 * （两者相等就证不出「没有误用 order」）。
 */
function createPageTabsHarness(entries: readonly { revision: number; order: number }[]): {
  tabs: Record<string, unknown>
  state: { snapshotCalls: number; listeners: Set<(event: unknown) => void> }
  advance: (index: number) => void
  emit: (event: unknown) => void
} {
  let index = 0
  const state = { snapshotCalls: 0, listeners: new Set<(event: unknown) => void>() }
  const current = () => entries[Math.min(index, entries.length - 1)] as { revision: number; order: number }
  return {
    state,
    advance: (next) => { index = next },
    emit: (event) => { for (const listener of [...state.listeners]) listener(event) },
    tabs: {
      tabsGetSnapshot: async () => {
        state.snapshotCalls += 1
        const entry = current()
        return {
          status: 'ok',
          snapshot: {
            layoutRevision: entry.revision,
            activeWorkspaceInstanceKey: PAGE_TAB_KEY,
            recentlyClosedCount: 0,
            tabs: [{
              workspaceInstanceKey: PAGE_TAB_KEY, pageId: 'agents', menuKey: 'agents', open: true,
              order: entry.order, mode: 'detached', bindingState: 'bound',
              windowInstanceId: HOST_WINDOW_ID, hostEpoch: 1
            }]
          }
        }
      },
      tabsCommand: async () => ({
        status: 'rejected', errorCode: 'invalid-request',
        snapshot: { layoutRevision: current().revision, activeWorkspaceInstanceKey: null, tabs: [] }
      }),
      onEvent: (listener: (event: unknown) => void) => {
        state.listeners.add(listener)
        return () => { state.listeners.delete(listener) }
      }
    }
  }
}

async function renderPageWindowRoot(tabs: Record<string, unknown>): Promise<HTMLDivElement> {
  const { bridge } = createFakeBridge({ contextOutcome: hostContext('panel', { mounts: [] }) })
  installBridge(bridge, tabs)
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

describe('PLAT-03：页窗 state.layoutRevision 必须是权威 Tab store revision', () => {
  it('① 页窗 state.layoutRevision 等于权威 Tab store revision', async () => {
    observedPageHostStates.length = 0
    // order(4) 与 revision(21) 故意不同：相等就证不出语义
    const harness = createPageTabsHarness([{ revision: 21, order: 4 }])
    await renderPageWindowRoot(harness.tabs)

    const states = observedPageStates()
    expect(states.length).toBeGreaterThan(0)
    expect(states[states.length - 1]?.layoutRevision).toBe(21)
  })

  it('② 两个 order 相同但 revision 不同的 Tab 在页窗里可区分', async () => {
    observedPageHostStates.length = 0
    const harness = createPageTabsHarness([{ revision: 5, order: 7 }, { revision: 9, order: 7 }])
    await renderPageWindowRoot(harness.tabs)

    const before = observedPageStates().at(-1)?.layoutRevision
    harness.advance(1)
    await act(async () => { harness.emit({ type: 'snapshot', layoutRevision: 9 }) })
    await settle()

    const after = observedPageStates().at(-1)?.layoutRevision
    // order 相同（7 === 7）⇒ 只看 order 无法区分这两个快照；revision 必须能区分
    const orders = new Set(observedPageStates().flatMap((state) => state.tabs.map((tab) => tab.order)))
    expect([...orders]).toEqual([7])
    expect(before).toBe(5)
    expect(after).toBe(9)
    expect(before).not.toBe(after)
  })

  it('③ order 与 revision 故意不同时，页窗拿到的是 revision（不再误用 order）', async () => {
    observedPageHostStates.length = 0
    const harness = createPageTabsHarness([{ revision: 33, order: 2 }])
    await renderPageWindowRoot(harness.tabs)

    const state = observedPageStates().at(-1)
    expect(state?.layoutRevision).toBe(33)
    expect(state?.tabs[0]?.order).toBe(2)
    expect(state?.layoutRevision).not.toBe(state?.tabs[0]?.order)
  })
})

describe('PLAT-02：WorkspaceWindowRoot 行数纪律与页窗回停靠控件抽取', () => {
  it('④ WorkspaceWindowRoot.tsx < 500 行且 PageWindowRedockControl.tsx 存在', () => {
    const dir = resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/workspace')
    const controlPath = resolve(dir, 'PageWindowRedockControl.tsx')
    expect(existsSync(controlPath)).toBe(true)

    const source = readFileSync(resolve(dir, 'WorkspaceWindowRoot.tsx'), 'utf8')
    const lines = source.endsWith('\n') ? source.split('\n').length - 1 : source.split('\n').length
    expect(lines).toBeLessThan(500)
  })
})
