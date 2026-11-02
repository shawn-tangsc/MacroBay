// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { WorkspacePanelRegistration } from '@platform/workspace/contracts'
import { WorkspaceWindowRoot, type WorkspacePendingTimerPort, type WorkspaceWindowRootProps } from './WorkspaceWindowRoot'

/**
 * Owner: apps/desktop-shell renderer / workspace（**PLAT-28** focused）。回归：本文件。
 *
 * **面板窗**（`kind:'detached-panel'`）被显式排除：它的 `context.preferences` 只在角色解析那一次读取，
 * 因此主窗切语言/主题后已打开的面板窗恒为旧值（plan 记「面板窗主题需重载」为非阻塞项）。
 *
 * 本文件取证渲染侧那一半（不启动 Electron）：
 *  ① 面板窗收到**既有**受控事件（`workspaceEvent` 的既有词汇 `snapshot`，与 P2-09/B3 同一订阅）后，
 *     单飞地**重取一次**受控 `getHostContext()`，可见文案（面板标题 + 正文语言）随之切换，**不重开窗口**；
 *  ② 面板窗根主题属性（`data-theme`，走 `applyRootThemeAttributes`）随之更新（此前只在挂载那一次写入）；
 *  ③ **有界**：一次事件 ⇒ 至多一次上下文重取 + 既有的一次快照重取，此后不再放大；事件订阅仍只有一条；
 *  ④ 未归属（身份不匹配）与错误路径（被拒）**显式**：维持最后一次受控值，绝不改判归属、绝不降级错误壳；
 *  ⑤ **相位不受影响**：准备期（`status:'pending'`）面板窗收到偏好通知时 `target-ready` 仍恰一次、绝不
 *     发源侧相位、绝不重挂；它的跟随来自既有受控重取（事件驱动 + 有界兜底轮询），不依赖偏好通知本身。
 *
 * Main 侧的另一半（受众、投递次数上界、相位链）由
 * `platform/desktop/main/workspace/panelWindowPreferenceFollow.test.ts`（真 compose + 真 P1-04 宿主）取证。
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const WINDOW_ID = 'window-panel-1'
const HOST_EPOCH = 3
const WORKSPACE_KEY = 'ws-panel-1'
const PANEL_KEY = 'panel-1'
const PANEL_ID = 'sample.inspector'
const OPERATION_ID = 'operation-1'
const FLUSH_TURNS = 12

const registration: WorkspacePanelRegistration = {
  panelId: PANEL_ID,
  title: { 'en-US': 'EN-INSPECTOR', 'zh-CN': 'ZH-INSPECTOR' },
  icon: 'file-text',
  module: 'platform.shell.workspace',
  pageIds: [],
  supportedModes: ['embedded', 'docked-right', 'docked-bottom', 'detached'],
  defaultMode: 'embedded',
  allowMultipleInstances: true,
  minSize: { width: 320, height: 240 },
  preferredSize: { width: 480, height: 360 },
  binding: { persistence: 'none', maxKeyBytes: 256 },
  lifecycleEvents: []
}

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
  for (const name of ['data-theme', 'data-theme-mode', 'data-accent']) {
    document.documentElement.removeAttribute(name)
  }
})

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < FLUSH_TURNS; turn += 1) await Promise.resolve()
  })
}

type Preferences = { language: string; theme: string }

type FakePanelWindow = {
  state: {
    contextCalls: number
    snapshotCalls: number
    eventSubscriptions: number
    /** 受控读取返回的形状开关：`mismatch` = 身份不匹配；`rejected` = 上下文不可用。 */
    mode: 'ok' | 'mismatch' | 'rejected'
    /** 已提交面板窗：受控上下文里的 mounts；准备期窗为空。 */
    committed: boolean
  }
  hostLifecycleCalls: { operationId: string; phase: string }[]
  setPreferences: (next: Partial<Preferences>) => void
  emit: (event: unknown) => void
}

/**
 * 面板窗的 fake preload：与真机同形（同一个 `platform.workspace` 命名空间）。计数 getter 是本文件的
 * **有界性观测面**（绝不给生产代码加测试出口）。
 */
function installPanelWindow(
  initial: Preferences = { language: 'en-US', theme: 'dark' },
  options: { committed?: boolean } = {}
): FakePanelWindow {
  const preferences: Preferences = { ...initial }
  const committed = options.committed !== false
  const state: FakePanelWindow['state'] = {
    contextCalls: 0, snapshotCalls: 0, eventSubscriptions: 0, mode: 'ok', committed
  }
  const hostLifecycleCalls: FakePanelWindow['hostLifecycleCalls'] = []
  const listeners = new Set<(event: unknown) => void>()

  const panel = () => ({
    workspaceInstanceKey: WORKSPACE_KEY, panelInstanceKey: PANEL_KEY, panelId: PANEL_ID,
    open: true, mode: 'detached', presentation: 'normal', bindingState: 'unavailable',
    lastValidDock: 'embedded', windowInstanceId: WINDOW_ID, hostEpoch: HOST_EPOCH
  })
  const mount = () => ({
    workspaceInstanceKey: WORKSPACE_KEY, panelInstanceKey: PANEL_KEY, panelId: PANEL_ID,
    open: true, mode: 'detached', bindingState: 'unavailable'
  })

  Reflect.set(window, 'platform', {
    workspace: {
      getHostContext: async () => {
        state.contextCalls += 1
        if (state.mode === 'rejected') return { status: 'rejected', errorCode: 'not-owner' }
        return {
          status: 'ok',
          context: {
            // 身份唯一来源是受控上下文；`mismatch` 用来取证「未归属 ⇒ 显式不跟随」
            windowInstanceId: state.mode === 'mismatch' ? 'window-someone-else' : WINDOW_ID,
            hostEpoch: HOST_EPOCH,
            role: 'panel',
            mounts: committed ? [mount()] : [],
            layoutRevision: 2,
            pageIds: [],
            preferences: { ...preferences },
            pendingTransfer: committed ? null : {
              status: 'in-flight', operationId: OPERATION_ID, phase: 'awaiting-target-ready',
              workspaceInstanceKey: WORKSPACE_KEY, panelInstanceKey: PANEL_KEY, panelId: PANEL_ID
            }
          }
        }
      },
      getSnapshot: async () => {
        state.snapshotCalls += 1
        return {
          status: 'ok',
          snapshot: {
            layoutRevision: 2, activeWorkspaceInstanceKey: WORKSPACE_KEY,
            // pageLayouts 是 detached 面板帧的挂载判据之一（hostableMounts 会同时校验 panelOrder）
            panels: [panel()],
            pageLayouts: [{ workspaceInstanceKey: WORKSPACE_KEY, panelOrder: [PANEL_KEY], activePanels: {} }],
            tabs: [], persistenceState: 'saved'
          }
        }
      },
      command: async () => ({ status: 'rejected', errorCode: 'invalid-request' }),
      hostLifecycle: async (request: { operationId: string; phase: string }) => {
        hostLifecycleCalls.push({ operationId: request.operationId, phase: request.phase })
        return { accepted: true }
      },
      onEvent: (listener: (event: unknown) => void) => {
        state.eventSubscriptions += 1
        listeners.add(listener)
        return () => { state.eventSubscriptions -= 1; listeners.delete(listener) }
      }
    }
  })

  return {
    state, hostLifecycleCalls,
    setPreferences: (next) => { Object.assign(preferences, next) },
    emit: (event) => { for (const listener of [...listeners]) listener(event) }
  }
}

/** Main 的偏好通知：**既有**事件词汇 + 既有 `workspaceEvent` 订阅（绝不新增通道/词汇）。 */
function panelNotice(revision = 3): unknown {
  return {
    type: 'snapshot', layoutRevision: revision,
    scope: { workspaceInstanceKey: WORKSPACE_KEY, panelInstanceKey: PANEL_KEY }
  }
}

async function renderPanelWindow(props: Partial<WorkspaceWindowRootProps> = {}): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const current = root
  await act(async () => {
    current.render(createElement(WorkspaceWindowRoot, {
      registrations: [registration],
      renderPanelContent: ({ language }) => createElement('p', { 'data-visible-language': language }, language),
      ...props
    } as WorkspaceWindowRootProps))
  })
  await settle()
  return container
}

const panelTitle = (view: HTMLDivElement): string | null =>
  view.querySelector<HTMLElement>(`[data-panel-key="${PANEL_KEY}"]`)?.getAttribute('aria-label') ?? null
const visibleLanguage = (view: HTMLDivElement): string | null =>
  view.querySelector<HTMLElement>('[data-visible-language]')?.getAttribute('data-visible-language') ?? null
const preparingTitle = (view: HTMLDivElement): string | null =>
  view.querySelector<HTMLElement>('[data-window-shell="preparing"]')?.getAttribute('aria-label') ?? null

describe('PLAT-28 ①：主窗切语言 ⇒ 已打开面板窗可见文案跟随（复用既有受控事件 + 一次受控重取）', () => {
  it('收到既有 snapshot 事件后重取一次 getHostContext，标题与正文语言从 EN 切到 ZH', async () => {
    const fake = installPanelWindow()
    const view = await renderPanelWindow()
    expect(view.querySelector('.workspace-panel-window')).not.toBeNull()
    expect(visibleLanguage(view)).toBe('en-US')
    expect(panelTitle(view)).toBe('EN-INSPECTOR')

    fake.setPreferences({ language: 'zh-CN' })
    await act(async () => { fake.emit(panelNotice()) })
    await settle()

    expect(visibleLanguage(view)).toBe('zh-CN')
    expect(panelTitle(view)).toBe('ZH-INSPECTOR')
    // 不重开窗口：同一个面板帧、同一个身份，DOM 不重建
    expect(view.querySelector(`[data-panel-key="${PANEL_KEY}"]`)).not.toBeNull()
    // 也不新增事件订阅（observe 幂等；第二次 observe 不得再挂一条 IPC listener）
    expect(fake.state.eventSubscriptions).toBe(1)
  })
})

describe('PLAT-28 ②：主窗切主题 ⇒ 面板窗根主题属性跟随（applyRootThemeAttributes 路径）', () => {
  it('面板窗根 data-theme 在切换后更新（此前只在挂载那一次写入、此后恒为旧值）', async () => {
    const fake = installPanelWindow({ language: 'en-US', theme: 'light' })
    await renderPanelWindow()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    fake.setPreferences({ theme: 'dark' })
    await act(async () => { fake.emit(panelNotice()) })
    await settle()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('语言与主题在同一次受控重取里更新（同一份上下文，绝不分叉）', async () => {
    const fake = installPanelWindow({ language: 'en-US', theme: 'light' })
    const view = await renderPanelWindow()
    fake.setPreferences({ language: 'zh-CN', theme: 'dark' })
    await act(async () => { fake.emit(panelNotice()) })
    await settle()
    expect(visibleLanguage(view)).toBe('zh-CN')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})

describe('PLAT-28 ③：一次切换的更新次数有上界（单飞 + 有界，绝不自持环）', () => {
  it('一次事件 ⇒ 恰好一次上下文重取 + 既有的一次快照重取，此后不再放大', async () => {
    const fake = installPanelWindow()
    await renderPanelWindow()
    const contextAfterMount = fake.state.contextCalls
    const snapshotsAfterMount = fake.state.snapshotCalls
    expect(contextAfterMount).toBe(1)
    expect(snapshotsAfterMount).toBe(1)

    fake.setPreferences({ language: 'zh-CN' })
    await act(async () => { fake.emit(panelNotice()) })
    await settle()
    expect(fake.state.contextCalls).toBe(contextAfterMount + 1)
    expect(fake.state.snapshotCalls).toBe(snapshotsAfterMount + 1)

    await settle()
    expect(fake.state.contextCalls).toBe(contextAfterMount + 1)
    expect(fake.state.snapshotCalls).toBe(snapshotsAfterMount + 1)
  })

  it('连续三个事件 ⇒ 上下文重取不超过三次（单飞合并，绝不风暴）', async () => {
    const fake = installPanelWindow()
    await renderPanelWindow()
    const before = fake.state.contextCalls
    fake.setPreferences({ language: 'zh-CN' })
    await act(async () => {
      fake.emit(panelNotice(3))
      fake.emit(panelNotice(4))
      fake.emit(panelNotice(5))
    })
    await settle()
    const delta = fake.state.contextCalls - before
    expect(delta).toBeGreaterThanOrEqual(1)
    expect(delta).toBeLessThanOrEqual(3)
  })
})

describe('PLAT-28 ④：未归属与错误路径显式（维持最后一次受控值，绝不放宽归属）', () => {
  it('重取的上下文身份与本窗不符 ⇒ 显式不跟随（维持原语言主题，绝不改判归属）', async () => {
    const fake = installPanelWindow({ language: 'en-US', theme: 'dark' })
    const view = await renderPanelWindow()
    fake.setPreferences({ language: 'zh-CN', theme: 'light' })
    fake.state.mode = 'mismatch'
    await act(async () => { fake.emit(panelNotice()) })
    await settle()

    expect(visibleLanguage(view)).toBe('en-US')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(fake.state.contextCalls).toBeGreaterThan(1)
  })

  it('重取被拒（上下文不可用）⇒ 维持最后一次受控值，绝不把面板窗降级成错误壳', async () => {
    const fake = installPanelWindow({ language: 'en-US', theme: 'dark' })
    const view = await renderPanelWindow()
    fake.state.mode = 'rejected'
    await act(async () => { fake.emit(panelNotice()) })
    await settle()

    expect(view.querySelector('.workspace-panel-window')).not.toBeNull()
    expect(view.querySelector('[data-window-shell="error"]')).toBeNull()
    expect(visibleLanguage(view)).toBe('en-US')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})

describe('PLAT-28 ⑤：面板链相位不受偏好通知影响（pending 窗绝不当成相位推进/快照重挂信号）', () => {
  it('准备期收到偏好通知 ⇒ target-ready 仍恰一次、绝不发源侧相位，语言/主题仍跟随', async () => {
    const fake = installPanelWindow({ language: 'en-US', theme: 'light' }, { committed: false })
    const timerEntries: { run: () => void; cancelled: boolean }[] = []
    const timers: WorkspacePendingTimerPort = {
      // 「绝不让兜底定时器无界累积」的观测面：每次 schedule 都取消上一个，因此在飞定时器恒 ≤1
      schedule: (_delayMs, run) => {
        const entry = { run, cancelled: false }
        timerEntries.push(entry)
        return () => { entry.cancelled = true }
      },
      now: () => 0
    }
    const view = await renderPanelWindow({ pendingTimers: timers })
    const shell = view.querySelector('[data-window-shell="preparing"]')
    expect(shell).not.toBeNull()
    expect(preparingTitle(view)).toBe('EN-INSPECTOR')
    // 准备期只报一次 target-ready（每个 operationId 恰一次，P2-07 语义）
    expect(fake.hostLifecycleCalls).toEqual([{ operationId: OPERATION_ID, phase: 'target-ready' }])

    fake.setPreferences({ language: 'zh-CN', theme: 'dark' })
    await act(async () => {
      fake.emit(panelNotice(3))
      fake.emit(panelNotice(4))
      fake.emit(panelNotice(5))
    })
    await settle()

    // 偏好通知绝不推进相位、绝不自造后续相位（源侧相位只由源窗发）
    expect(fake.hostLifecycleCalls).toEqual([{ operationId: OPERATION_ID, phase: 'target-ready' }])
    expect(preparingTitle(view)).toBe('ZH-INSPECTOR')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    // 兜底轮询仍在既有节奏上（有界）：任何时刻至多一个在飞定时器，偏好通知没有让它变成忙轮询
    expect(timerEntries.filter((entry) => !entry.cancelled).length).toBeLessThanOrEqual(1)
  })
})
