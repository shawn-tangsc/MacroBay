import { createContext, useContext, type ReactNode } from 'react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { WorkspaceSnapshot } from '@platform/workspace/contracts'
import { WorkspaceOwnershipPolicy } from '@platform/workspace/policies'
import { WorkspacePanelHost } from './WorkspacePanelHost'
import type { WorkspacePanelHostPort } from './workspaceHostAdapter'
import { buildPanelViews, hostableMounts, usePageSize } from './workspaceWindowSurfaces'
import type { WorkspaceHostContext } from './workspaceClient'

/**
 * Owner: apps/desktop-shell renderer / workspace（**PLAT-35**：主窗「页面 Tab + 停靠面板」共存）。
 *
 * 缺陷（真机 A-T05）：主窗只渲染 Tab 链（`renderWorkspacePages`），面板链的停靠面板**从不进入主窗 DOM**
 * （`pageBodyPresent=false` / `panelFrameCount=0`）；两条链各自持有 workspace 键，而 renderer 侧没有任何
 * `openWorkspace` 调用方 ⇒ 停靠面板永远不在主窗显示的 Tab 页里。
 *
 * 修法的渲染侧那一半（Main 侧见 `composePanelWorkspace.resolvePageWorkspaceKey` / `adoptPanelWorkspace`）：
 *  - `WorkspaceWindowRoot` 在 `role:'main'` 且已取得权威快照时，把**同一个**受控客户端（快照 + 宿主端口）
 *    经本 context 下发给主窗 shell；
 *  - `MainWindowPanelArea` 只用 **Tab 链的活动 `workspaceInstanceKey`** 构造 `WorkspacePanelHost`，因此
 *    面板帧与页面正文同属一个工作区实例（绝不拿面板链的 `activeWorkspaceInstanceKey` 冒充）；
 *  - 没有桥/没有活动 Tab 时**原样渲染 children**（绝不伪造面板帧，也不改变既有 shell 单测环境）。
 *
 * 权威纪律不变：renderer 不持有第二份布局权威；快照只来自 `workspace.getSnapshot`/既有事件重取，
 * 端口只发既有受控命令。
 */

export type WorkspaceMainPanelBridge = {
  context: WorkspaceHostContext
  snapshot: WorkspaceSnapshot
  port: WorkspacePanelHostPort
  /** 命令返回的权威快照立即写回窗口根（不必等事件往返；仍是 Main 的权威值）。 */
  reportSnapshot: (snapshot: WorkspaceSnapshot) => void
}

const WorkspaceMainPanelContext = createContext<WorkspaceMainPanelBridge | null>(null)

export function WorkspaceMainPanelProvider(props: {
  value: WorkspaceMainPanelBridge
  children: ReactNode
}): React.ReactElement {
  return <WorkspaceMainPanelContext.Provider value={props.value}>{props.children}</WorkspaceMainPanelContext.Provider>
}

/** 主窗 shell 读取受控面板桥；非主窗/未取得快照时为 null（调用方据此原样渲染）。 */
export function useWorkspaceMainPanelBridge(): WorkspaceMainPanelBridge | null {
  return useContext(WorkspaceMainPanelContext)
}

/**
 * 主窗的宿主上下文**投影**：`context.mounts` 来自角色解析那一次受控读取，之后不会随面板命令刷新；
 * 主窗快照则会随既有 `snapshot` 事件持续更新。因此这里用「上下文身份（权威）+ 快照里的归属」重建 mounts：
 * 只有 `windowInstanceId/hostEpoch` 与本窗逐字一致的面板才算本窗承载（绝不放宽归属），再交给 `hostableMounts`
 * 校验它确实在该页面实例的 `panelOrder` 里。这是**只读**投影，不产生第二份布局权威。
 */
function mainWindowPanelContext(context: WorkspaceHostContext, snapshot: WorkspaceSnapshot): WorkspaceHostContext {
  /**
   * 身份翻译：`context.windowInstanceId` 是 **registry** 的窗口身份（主窗也是 `window_*`），而快照里的面板
   * 归属用的是 **store** 身份（主窗恒为 `WorkspaceOwnershipPolicy.initialWindowInstanceId`）。两者的映射在
   * Main 的 `toStoreHostIdentity` 里是唯一权威；renderer 只按同一口径读 policy 常量（不硬编码字面量）。
   */
  const hostStoreWindowId = context.role === 'main'
    ? WorkspaceOwnershipPolicy.initialWindowInstanceId
    : context.windowInstanceId
  const owned = snapshot.panels
    .filter((panel) => panel.windowInstanceId === hostStoreWindowId && panel.hostEpoch === context.hostEpoch)
    .map((panel) => ({
      workspaceInstanceKey: panel.workspaceInstanceKey,
      panelInstanceKey: panel.panelInstanceKey,
      panelId: panel.panelId,
      open: panel.open,
      mode: panel.mode,
      bindingState: panel.bindingState
    }))
  return { ...context, mounts: owned }
}

/**
 * 主窗页面区域的最小尺寸（DIP）：与面板窗的页面保留尺寸同源（同一具名常量，`WorkspaceWindowRoot` 复用）。
 */
export const MAIN_WINDOW_PANEL_PAGE_MIN_SIZE = Object.freeze({ width: 480, height: 320 })

/**
 * 主窗的「页面 + 停靠面板」区域：`workspaceInstanceKey` **必须**是 Tab 链当前活动的实例键。
 * 返回 `null` 桥/`null` 键 ⇒ 原样 children（安全退化，绝不伪造面板帧）。
 */
export function MainWindowPanelArea(props: {
  workspaceInstanceKey: string | null
  language: AppLanguage
  timeZone: string
  children: ReactNode
}): React.ReactElement {
  const bridge = useWorkspaceMainPanelBridge()
  const pageSize = usePageSize(MAIN_WINDOW_PANEL_PAGE_MIN_SIZE)
  if (bridge === null || props.workspaceInstanceKey === null) return <>{props.children}</>
  const mounts = hostableMounts(mainWindowPanelContext(bridge.context, bridge.snapshot), bridge.snapshot)
  const views = buildPanelViews({ mounts, language: props.language })
  return (
    <WorkspacePanelHost
      workspaceInstanceKey={props.workspaceInstanceKey}
      snapshot={bridge.snapshot}
      pageSize={pageSize}
      pageMinSize={MAIN_WINDOW_PANEL_PAGE_MIN_SIZE}
      language={props.language}
      timeZone={props.timeZone}
      views={views}
      port={bridge.port}
      onSnapshot={bridge.reportSnapshot}>
      {props.children}
    </WorkspacePanelHost>
  )
}
