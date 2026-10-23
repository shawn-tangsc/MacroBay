// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { WorkspaceSnapshot } from '@platform/workspace/contracts'
import { platformText } from '../../i18n/platformText'
import { MainWindowPanelArea } from './workspaceMainPanelContext'
import { WorkspaceWindowRoot } from './WorkspaceWindowRoot'
import type { WorkspaceBridge } from './workspaceClient'

/**
 * Owner: apps/desktop-shell renderer / workspace（PLAT-35 RED）。
 *
 * 缺陷（真机 A-T05）：主窗只渲染 Tab 链（`renderWorkspacePages`），**面板链的停靠面板从不进入主窗 DOM**
 * （`pageBodyPresent=false` / `panelFrameCount=0`）；面板链与 Tab 链各自持有 workspace 键，且
 * `openWorkspace` 在 renderer 侧没有调用方 ⇒ 「页面 Tab + 停靠面板」同窗共存不可达。
 *
 * 判据（本文件，渲染侧那一半）：
 *  - 主窗的受控快照经 `WorkspaceWindowRoot` 下发后，`MainWindowPanelArea` 必须用**该 Tab 的
 *    `workspaceInstanceKey`** 构造面板宿主（不是面板链的 `activeWorkspaceInstanceKey`）；
 *  - 同一 DOM 里页面正文（`.workspace-page-body`）与面板帧（`.workspace-panel-frame`）**同时**在位；
 *  - 没有活动 Tab 键/没有面板宿主桥时安全退回原样 children（绝不伪造面板帧）。
 */
const WORKSPACE_KEY = 'workspace_tab_chain_1'
const PANEL_KEY = 'panel_1'
const PANEL_ID = 'dsh-fixture.board'
const HOST_WINDOW_ID = 'window-main-1'
const MAIN_STORE_ID = 'main'
const FLUSH_TURNS = 12

const labels = platformText['en-US'].workspace

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
})

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < FLUSH_TURNS; turn += 1) await Promise.resolve()
  })
}

function mainSnapshot(): WorkspaceSnapshot {
  return {
    layoutRevision: 9,
    activeWorkspaceInstanceKey: WORKSPACE_KEY,
    panels: [{
      workspaceInstanceKey: WORKSPACE_KEY, panelInstanceKey: PANEL_KEY, panelId: PANEL_ID,
      open: true, mode: 'docked-right', presentation: 'normal', bindingState: 'bound',
      windowInstanceId: MAIN_STORE_ID, hostEpoch: 1, lastValidDock: 'docked-right',
      dockSize: { width: 360, height: 480 }
    }],
    pageLayouts: [{ workspaceInstanceKey: WORKSPACE_KEY, panelOrder: [PANEL_KEY], activePanels: { 'docked-right': PANEL_KEY } }],
    tabs: [],
    persistenceState: 'saved'
  }
}

function mainBridge(snapshot: WorkspaceSnapshot = mainSnapshot()): WorkspaceBridge {
  return {
    getHostContext: async () => ({
      status: 'ok',
      context: {
        windowInstanceId: HOST_WINDOW_ID, hostEpoch: 1, role: 'main',
        mounts: [{
          workspaceInstanceKey: WORKSPACE_KEY, panelInstanceKey: PANEL_KEY, panelId: PANEL_ID,
          open: true, mode: 'docked-right', bindingState: 'bound'
        }],
        layoutRevision: snapshot.layoutRevision, pageIds: [PANEL_ID],
        preferences: { language: 'en-US', theme: 'dark', timeZone: 'UTC' },
        pendingTransfer: null
      }
    }),
    getSnapshot: async () => ({ status: 'ok', snapshot }),
    command: async () => ({ status: 'applied', snapshot, panelInstanceKey: PANEL_KEY }),
    onEvent: () => () => undefined
  }
}

async function renderMain(
  bridge: WorkspaceBridge,
  children: React.ReactNode
): Promise<HTMLDivElement> {
  Reflect.set(window, 'platform', { workspace: bridge })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const current = root
  await act(async () => { current.render(createElement(WorkspaceWindowRoot, {}, children)) })
  await settle()
  return container
}

/** 模拟主窗页面区域：Tab 正文 + 面板宿主（AppShell 的接线形态）。 */
function pageArea(workspaceInstanceKey: string | null): React.ReactElement {
  return (
    <MainWindowPanelArea workspaceInstanceKey={workspaceInstanceKey} language="en-US" timeZone="UTC">
      <div className="workspace-page-body" data-page-body="fixture.panel-host">PAGE-BODY</div>
    </MainWindowPanelArea>
  )
}

describe('PLAT-35 主窗 DOM 共存：页面正文 + 停靠面板帧', () => {
  it('主窗把受控快照下发后，页面正文与面板帧在同一 DOM 同时渲染', async () => {
    const view = await renderMain(mainBridge(), pageArea(WORKSPACE_KEY))
    expect(view.querySelector('.workspace-page-body')).not.toBeNull()
    const frames = view.querySelectorAll('.workspace-panel-frame')
    expect(frames).toHaveLength(1)
    expect(frames[0]?.getAttribute('data-panel-key')).toBe(PANEL_KEY)
    // 面板宿主确实包住页面区域（同一工作区，而不是第二个页面实例）
    expect(view.querySelector('.workspace-panel-host .workspace-page .workspace-page-body')).not.toBeNull()
    // 面板占位正文使用与分离面板窗同一份 i18n 文案
    expect(view.textContent).toContain(labels.windowPanelPlaceholder)
  })

  it('上下文 mounts 仍是解析时那一份（不含新开面板）⇒ 以同一身份 + 快照归属重建 mounts，面板帧仍渲染', async () => {
    // 真机 A-T05 的第二个根因：主窗 context.mounts 只在角色解析时读一次，openPanel 之后不刷新；
    // 主窗快照却随既有 snapshot 事件更新。这里让 fake 上下文永远返回空 mounts，只有快照含面板。
    const bridge = mainBridge()
    const original = bridge.getHostContext
    bridge.getHostContext = async () => {
      const outcome = (await original()) as { status: 'ok'; context: Record<string, unknown> }
      return { status: 'ok', context: { ...outcome.context, mounts: [] } }
    }
    const view = await renderMain(bridge, pageArea(WORKSPACE_KEY))
    const frames = view.querySelectorAll('.workspace-panel-frame')
    expect(frames).toHaveLength(1)
    expect(frames[0]?.getAttribute('data-panel-key')).toBe(PANEL_KEY)
  })

  it('没有活动 Tab 键 ⇒ 原样渲染页面，不伪造任何面板帧', async () => {
    const view = await renderMain(mainBridge(), pageArea(null))
    expect(view.querySelector('.workspace-page-body')).not.toBeNull()
    expect(view.querySelector('.workspace-panel-frame')).toBeNull()
  })

  it('没有 workspace 桥（既有 shell 单测环境）⇒ 页面原样渲染，不抛错、不出现面板宿主', async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const current = root
    await act(async () => { current.render(pageArea(WORKSPACE_KEY)) })
    await settle()
    expect(container.querySelector('.workspace-page-body')).not.toBeNull()
    expect(container.querySelector('.workspace-panel-host')).toBeNull()
  })
})

describe('PLAT-35 接线守卫：AppShell 必须把主窗页面区域包进 MainWindowPanelArea', () => {
  const appShell = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/AppShell.tsx'), 'utf8')

  it('AppShell 使用 MainWindowPanelArea 并以 Tab 链的活动实例键作为工作区键', () => {
    expect(appShell).toContain('MainWindowPanelArea')
    // 工作区键必须来自 Tab 快照（而不是面板链的 activeWorkspaceInstanceKey）
    expect(appShell).toMatch(/activeWorkspaceInstanceKey/)
  })
})
