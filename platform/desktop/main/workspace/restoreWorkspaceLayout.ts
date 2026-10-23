import type { WorkspaceCommandResult, WorkspaceSnapshot } from '@platform/workspace/contracts'
import { WorkspaceOwnershipPolicy, WorkspaceRegistrationPolicy } from '@platform/workspace/policies'
import type { createPanelRegistry } from '@platform/workspace/registry/panelRegistry'
import type { createWorkspacePageRegistry } from '@platform/workspace/registry/workspacePageRegistry'
import type { createPanelWorkspaceStore } from '@platform/workspace/runtime/panelWorkspaceStore'
import type { WorkspaceTabLayoutRecord, WorkspaceTabRestoreResult, createWorkspaceTabStore } from '@platform/workspace/runtime/workspaceTabStore'
import {
  dropNonDurableBindingsV2,
  pruneWorkspaceLayoutDocumentV2,
  toPanelLayoutDocumentV1,
  type WorkspaceLayoutDocumentV2
} from '@platform/workspace/persistence/workspaceLayoutDocument'
import type { DockMode } from './workspaceWindowBounds'
import { WorkspaceDockFallbackChain } from './workspaceWindowBounds'

/**
 * Owner: platform/desktop/main/workspace（P2-04）。权威：技术设计 §7（v2 恢复 / 唯一 v1→v2 转换）+ §8。
 *
 * 单一恢复入口：把 v2 文档（或一次性升级后的 v2）接回 **runtime**——面板 runtime store + Tab runtime store。
 * 「文件写出来了」不算证据：本模块存在的意义就是让 v2 真正成为运行期权威，并让每个降级/剪裁可观测。
 *
 * 顺序与失败语义（逐条对齐既有已 Accepted 行为，不放宽任何一条）：
 *  1) 读取由 `panelLayoutStore.load()` 做（有界 + 未知版本保护）；`mayOverwrite === false` ⇒ 一律不恢复；
 *  2) 卸载剪裁只剪对应条目（`pruneWorkspaceLayoutDocumentV2`），绝不整份丢弃/整份保留；
 *  3) 非 durable 绑定（none/session）在恢复前摘掉，绝不把 session key 带进运行期或下一次写盘；
 *  4) 恢复出的 `mode:'detached'` 面板**在本包不物化窗口**（P1-05/P1-06 门槛），按
 *     `lastValidDock → docked-right → docked-bottom → embedded` 降级并记录 `restore-invalid`；
 *     同一姿态适用于 Tab：启动时没有任何源宿主可 ACK，恢复为 `main` 并记录降级；
 *  5) 两个 runtime store 各自 CAS：任一 store 发现 revision 已被用户操作推进 ⇒ 整体报 `stale`。
 */

export type WorkspaceDetachedDowngrade = {
  panelInstanceKey: string
  from: 'detached'
  to: DockMode
  reason: 'restore-invalid'
}
export type WorkspaceDetachedTabDowngrade = {
  workspaceInstanceKey: string
  from: 'detached'
  to: 'main'
  reason: 'restore-invalid'
}

/** P2-04 追加的可观测字段（全部为「恢复到底发生了什么」的计数，不含文档内容）。 */
export type WorkspaceLayoutRestoreSummary = {
  restoredTabs?: number
  prunedWorkspaces?: number
  prunedPanels?: number
  prunedTabs?: number
  droppedBindings?: number
  downgradedDetachedTabs?: readonly WorkspaceDetachedTabDowngrade[]
  /** 本次恢复是否触发了一次性 v1→v2 转换（true = 磁盘上的 v1 已被升级并排队写 v2）。 */
  convertedFromV1?: boolean
  /** 文档里的布局 revision（诊断用；CAS 用的是各 store 自己的 revision）。 */
  persistedLayoutRevision?: number
}

export type WorkspaceLayoutRestoreReport = WorkspaceLayoutRestoreSummary & {
  restore: 'restored' | 'empty' | 'protected' | 'stale'
  restoredPanels: number
  downgradedDetached: readonly WorkspaceDetachedDowngrade[]
  mayOverwrite: boolean
}

export type WorkspaceLayoutRestoreOptions = {
  layoutStore: {
    load: () => Promise<{
      outcome: 'loaded' | 'default'
      document: WorkspaceLayoutDocumentV2
      mayOverwrite: boolean
      convertedFromV1: boolean
    }>
  }
  runtimeStore: Pick<ReturnType<typeof createPanelWorkspaceStore>, '_restoreLayout' | 'getSnapshot'>
  tabStore: Pick<ReturnType<typeof createWorkspaceTabStore>, '_restoreTabs' | 'getSnapshot'>
  panelRegistry: Pick<ReturnType<typeof createPanelRegistry>, 'get'>
  pageRegistry: Pick<ReturnType<typeof createWorkspacePageRegistry>, 'list'>
  /** P2-03/P2-01：恢复也是一条 applied 布局命令；缺省不投递（启动期通常还没有订阅者）。 */
  onPanelsApplied?: (input: { before: WorkspaceSnapshot; result: WorkspaceCommandResult }) => void
  onTabsApplied?: (result: WorkspaceTabRestoreResult) => void
}

/** 恢复出的 detached 面板不物化窗口：按「用户落点 → 安全链」降级，绝不留下「说 detached 却没有窗口」。 */
function planRestoredDetachedPanels(
  document: WorkspaceLayoutDocumentV2,
  panelRegistry: Pick<ReturnType<typeof createPanelRegistry>, 'get'>
): { document: WorkspaceLayoutDocumentV2; downgraded: readonly WorkspaceDetachedDowngrade[] } {
  const downgraded: WorkspaceDetachedDowngrade[] = []
  const panels = document.panels.map((panel) => {
    if (panel.mode !== 'detached') return panel
    const registration = panelRegistry.get(panel.panelId)
    // 注册整体消失的面板由剪裁丢弃，这里不猜它的落点
    if (!registration) return panel
    const to = [panel.lastValidDock, ...WorkspaceDockFallbackChain].find((mode) => registration.supportedModes.includes(mode))
      ?? WorkspaceRegistrationPolicy.fallbackMode
    downgraded.push({ panelInstanceKey: panel.panelInstanceKey, from: 'detached', to, reason: 'restore-invalid' })
    return { ...panel, mode: to, lastValidDock: to }
  })
  return { document: { ...document, panels }, downgraded }
}

export function createWorkspaceLayoutRestore(options: WorkspaceLayoutRestoreOptions) {
  return Object.freeze({
    async restore(): Promise<WorkspaceLayoutRestoreReport> {
      const panelExpectedRevision = options.runtimeStore.getSnapshot().layoutRevision
      const tabExpectedRevision = options.tabStore.getSnapshot().layoutRevision
      const load = await options.layoutStore.load()
      const empty: WorkspaceLayoutRestoreReport = {
        restore: 'empty', restoredPanels: 0, downgradedDetached: [], mayOverwrite: load.mayOverwrite,
        restoredTabs: 0, prunedWorkspaces: 0, prunedPanels: 0, prunedTabs: 0, droppedBindings: 0,
        downgradedDetachedTabs: [], convertedFromV1: load.convertedFromV1,
        persistedLayoutRevision: load.document.layoutRevision
      }
      // 未知版本/损坏/超时/读取失败：原文件被保护，恢复一个字段都不应用（绝不覆写、也绝不假装恢复）
      if (!load.mayOverwrite) return { ...empty, restore: 'protected' }
      if (load.outcome !== 'loaded') return empty

      const pageIds = new Set(options.pageRegistry.list().map((page) => page.id))
      // 允许清单用的是**注册 id**（panelId / pageId），不是实例键；未注册的条目由剪裁局部丢弃
      const panelIds = new Set(load.document.panels.map((panel) => panel.panelId))
      const uninstalled = pruneWorkspaceLayoutDocumentV2(load.document, { pageIds, panelIds })
      const bindings = dropNonDurableBindingsV2(uninstalled.document, (panelId) => options.panelRegistry.get(panelId)?.binding.persistence)
      const planned = planRestoredDetachedPanels(bindings.document, options.panelRegistry)

      const beforePanels = options.runtimeStore.getSnapshot()
      const panelsApplied = await options.runtimeStore._restoreLayout({
        requestId: 'workspace-restore', requestScope: 'workspace-restore',
        expectedRevision: panelExpectedRevision, document: toPanelLayoutDocumentV1(planned.document)
      })
      if (panelsApplied.status !== 'applied') {
        // 迟到恢复（用户已操作）⇒ 一个字段都不应用；面板与 Tab 必须同进同退
        return { ...empty, restore: 'stale' }
      }
      options.onPanelsApplied?.({ before: beforePanels, result: panelsApplied })

      const downgradedDetachedTabs: WorkspaceDetachedTabDowngrade[] = planned.document.tabs
        .filter((tab) => tab.mode === 'detached')
        .map((tab) => ({
          workspaceInstanceKey: tab.workspaceInstanceKey, from: 'detached' as const, to: 'main' as const,
          reason: 'restore-invalid' as const
        }))
      // 启动期没有任何源宿主可 ACK：detached 页窗在本包不物化，统一恢复为 main 并如实记录降级
      const restoreTabs: WorkspaceTabLayoutRecord[] = planned.document.tabs.map((tab) => ({
        workspaceInstanceKey: tab.workspaceInstanceKey, pageId: tab.pageId, open: tab.open, order: tab.order,
        mode: 'main', ...(tab.detachedBounds === undefined ? {} : { detachedBounds: tab.detachedBounds })
      }))
      const tabsApplied = await options.tabStore._restoreTabs({
        requestId: 'workspace-restore-tabs', requestScope: 'workspace-restore',
        // 恢复只有主窗可以做（布局管理权）：身份声明用平台初始主窗哨兵，绝不由调用方自选
        hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch,
        expectedRevision: tabExpectedRevision,
        tabs: restoreTabs,
        activeWorkspaceInstanceKey: planned.document.activeWorkspaceInstanceKey
      })
      if (tabsApplied.status !== 'applied') return { ...empty, restore: 'stale' }
      options.onTabsApplied?.(tabsApplied)
      return {
        restore: 'restored',
        restoredPanels: options.runtimeStore.getSnapshot().panels.length,
        downgradedDetached: planned.downgraded,
        mayOverwrite: true,
        restoredTabs: tabsApplied.restoredTabs,
        prunedWorkspaces: uninstalled.prunedWorkspaces,
        prunedPanels: uninstalled.prunedPanels,
        prunedTabs: uninstalled.prunedTabs,
        droppedBindings: bindings.droppedBindings,
        downgradedDetachedTabs,
        convertedFromV1: load.convertedFromV1,
        persistedLayoutRevision: planned.document.layoutRevision
      }
    }
  })
}

export type WorkspaceLayoutRestore = ReturnType<typeof createWorkspaceLayoutRestore>
