import type {
  WorkspacePageRegistration,
  WorkspacePanelSnapshot,
  WorkspaceWorkspaceResult
} from '@platform/workspace/contracts'
import {
  listPendingPanelTargets,
  type WorkspacePreferencePendingPanelTarget
} from './workspacePendingPanelPreference'
import type { WorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace（**PLAT-35 组**：两链桥接的 Main 侧单点）。
 *
 * 从 `composePanelWorkspace.ts` 抽出的**内聚块**（PLAT-30 行数纪律：compose 任何改动前必须先抽走一块）。
 * 这里只回答四个只读/受控问题，绝不持有布局权威、绝不新增通道：
 *  1) `resolvePageWorkspaceKey(pageId)`：该页当前打开的 Tab 实例键（优先活动 Tab）——`openWorkspace` 据此
 *     **采纳**而不是另造一个键（PLAT-35）；
 *  2) `adoptPanelWorkspace({workspaceInstanceKey,pageId})`：`openTab` applied 后把同一键采纳进面板链
 *     （幂等；成功后只触发一次布局落盘）；
 *  3) `resolvePageTitle(registration)`：页窗建窗标题按**当前宿主语言**解析（PLAT-41 的主标题来源）；
 *  4) `listPendingPanelWindows()`：准备期面板目标窗的**定向**受众投影（PLAT-31；判据全在
 *     `listPendingPanelTargets` 里，本模块只接线）。
 *
 * 它不 import electron、不读环境、不写 store；`runtimeStore.adoptWorkspace` 是 Main 内部唯一的写入入口。
 */
export type WorkspaceChainTabView = { workspaceInstanceKey: string; pageId: string; open: boolean }
export type WorkspaceChainTabState = {
  activeWorkspaceInstanceKey: string | null
  tabs: readonly WorkspaceChainTabView[]
}
export type WorkspaceChainBridgeOptions = {
  tabStore: { getSnapshot: () => WorkspaceChainTabState }
  windowRegistry: WorkspaceWindowRegistry
  runtimeStore: {
    getSnapshot: () => { panels: readonly WorkspacePanelSnapshot[]; layoutRevision: number }
    adoptWorkspace: (input: { workspaceInstanceKey: string; pageId: string }) => Promise<WorkspaceWorkspaceResult>
  }
  /** 与 `getHostContext` 同源的受控偏好读取（只读语言；缺省/失败回落到注册信息的 en-US）。 */
  preferences: { getLanguage: () => string | Promise<string> }
  /** 采纳真的把面板链 revision +1 时的布局落盘调度（幂等调用；失败绝不冒泡到 Tab 结论）。 */
  onAdopted?: () => void
}

export function createWorkspaceChainBridge(options: WorkspaceChainBridgeOptions) {
  const activeTabOfPage = (pageId: string): WorkspaceChainTabView | undefined => {
    const state = options.tabStore.getSnapshot()
    const active = state.tabs.find((tab) => tab.open && tab.pageId === pageId
      && tab.workspaceInstanceKey === state.activeWorkspaceInstanceKey)
    if (active !== undefined) return active
    return state.tabs.find((tab) => tab.open && tab.pageId === pageId)
  }

  return Object.freeze({
    /**
     * PLAT-35：`openWorkspace` 的采纳键。没有打开的 Tab ⇒ null（handler 保持既有「自造新键」语义）。
     * 只读：绝不因一次解析失败把键写进任何 store。
     */
    resolvePageWorkspaceKey(pageId: string): string | null {
      return activeTabOfPage(pageId)?.workspaceInstanceKey ?? null
    },

    /**
     * PLAT-35：`openTab` applied 后采纳同键面板 workspace。幂等由 store 的 `adoptWorkspace` 保证；
     * 这里绝不 await（Tab 结论已提交，采纳失败只影响面板链，绝不回滚 Tab）。
     */
    adoptPanelWorkspace(input: { workspaceInstanceKey: string; pageId: string }): void {
      void options.runtimeStore.adoptWorkspace(input)
        .then((result) => { if (result.status === 'applied') options.onAdopted?.() })
        .catch(() => undefined)
    },

    /** PLAT-41：页窗建窗标题（当前语言）；无注册标题 ⇒ 空串（调用方回落到 pageId）。 */
    async resolvePageTitle(registration: WorkspacePageRegistration): Promise<string> {
      if (registration.title === undefined) return ''
      const language = await options.preferences.getLanguage()
      return language.startsWith('zh') ? registration.title['zh-CN'] : registration.title['en-US']
    },

    /** PLAT-31：准备期目标窗的定向受众（按 registry + 权威快照；见 publisher 的纯函数）。 */
    listPendingPanelWindows(): readonly WorkspacePreferencePendingPanelTarget[] {
      return listPendingPanelTargets(options.windowRegistry, options.runtimeStore.getSnapshot())
    }
  })
}

export type WorkspaceChainBridge = ReturnType<typeof createWorkspaceChainBridge>
