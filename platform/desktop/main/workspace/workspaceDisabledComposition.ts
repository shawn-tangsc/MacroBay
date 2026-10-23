import type {
  WorkspacePageLayout,
  WorkspacePanelSnapshot,
  WorkspaceSnapshot
} from '@platform/workspace/contracts'
import type { DetachedHostEvent } from './panelDetachedWindowHost'
import type { TransferPrepareOutcome } from './workspaceTransferPreparePort'
import type { WorkspaceDisposeReport, WorkspaceLayoutFlushReport } from './workspaceLayoutLifecycle'
import type { WorkspaceStartReport } from './composePanelWorkspace'
import type { WorkspaceWindowRecord, WorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace（**PLAT-35 组**抽取；PLAT-30 行数纪律：compose 再改动前先抽走一块）。
 *
 * 禁用态组合（没有任何产品页面）：形状合法的空实现 —— 全部入口 fail closed，绝不假装已接线。
 * 抽取纪律：判据、返回值形状、`DISABLED_SNAPSHOT` 逐字不变；`PanelWorkspaceComposition` 的类型仍由
 * `composePanelWorkspace` 的 `ReturnType` 定义（本模块只作为其中一个合法分支被返回）。
 */

/** 禁用态没有 store，但仍要返回形状合法的空快照，绝不让调用方拿到 undefined。 */
export const DISABLED_SNAPSHOT: WorkspaceSnapshot = Object.freeze({
  layoutRevision: 0,
  activeWorkspaceInstanceKey: null,
  panels: Object.freeze([]) as readonly WorkspacePanelSnapshot[],
  pageLayouts: Object.freeze([]) as readonly WorkspacePageLayout[],
  tabs: Object.freeze([]) as readonly [],
  persistenceState: 'saved' as const
})

export function disabledComposition(
  pageIds: readonly string[],
  windowRegistry: WorkspaceWindowRegistry,
  registrationFailures: number
) {
  const report: WorkspaceStartReport = {
    status: 'disabled', reason: 'no-pages', restore: 'disabled', restoredPanels: 0,
    downgradedDetached: [], registrationFailures, mayOverwrite: false
  }
  const absent = (_input: { webContentsId: number }) => ({ attached: false as const, subscribed: false as const })
  const disabled = async () => Object.freeze([]) as readonly string[]
  return Object.freeze({
    status: 'disabled' as const, reason: 'no-pages' as const, channels: null, panelRegistry: null,
    pageIds, runtimeStore: null, layoutStore: null, windowRegistry, router: null, handlers: null,
    tabHandlers: null, tabStore: null, tabHost: null,
    start: async () => report,
    /** 禁用态没有任何受控通道可注册（fail closed），也没有可对账的受众。 */
    registerChannels: () => undefined,
    notifyPreferencesChanged: async () => false,
    registerMainWindow: (_input: { webContentsId: number; hostEpoch?: number }): WorkspaceWindowRecord | undefined => undefined,
    attachMainWindow: absent, attachHostWindow: absent,
    beginTransferToReservedHost: async (): Promise<TransferPrepareOutcome> =>
      ({ status: 'rejected', errorCode: 'unsupported', reason: 'workspace-disabled', snapshot: DISABLED_SNAPSHOT }),
    transferOrchestrator: null, publishHostEvent: (_event: DetachedHostEvent): boolean => false,
    reconcileTabContainers: disabled, mainHostBridge: null,
    flushLayout: async (): Promise<WorkspaceLayoutFlushReport> => ({ status: 'disabled', outcome: 'skipped', hadPendingWrites: false, layoutRevision: 0 }),
    dispose: async (): Promise<WorkspaceDisposeReport> => ({ status: 'disabled', flushOutcome: 'skipped' })
  })
}
