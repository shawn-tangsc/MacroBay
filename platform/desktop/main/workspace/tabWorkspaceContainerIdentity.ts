import type { WorkspaceTabCommandResult, WorkspaceTabSnapshot } from '@platform/workspace/contracts'
import type { WorkspaceWindowRecord, WorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace（PLAT-35 组按 PLAT-30 行数纪律从 `tabWorkspaceIpcHandlers.ts` 抽出）。
 *
 * 页面容器的**身份翻译**（纯只读）：页面窗的容器身份只有一个权威来源 = 共享 registry 的 `detached-tab`
 * 记录；没有登记就是 main 声明。store 的 `workspaceInstanceKey` 与 registry 的身份在此逐字对齐，
 * 绝不由 renderer 或本模块另造。抽取不改任何判据。
 */
export type TabContainerIdentity = { mode: 'main' | 'detached'; windowInstanceId: string; hostEpoch: number }
export type TabMainContainer = { windowInstanceId: string; hostEpoch: number }

export function createTabContainerIdentity(options: {
  windowRegistry: WorkspaceWindowRegistry
  mainContainer: TabMainContainer
}) {
  const { windowRegistry, mainContainer } = options
  /** 页面窗的容器归属：以共享 registry 的 `detached-tab` 记录为唯一容器权威。 */
  const pageWindowOf = (workspaceInstanceKey: string): WorkspaceWindowRecord | undefined =>
    windowRegistry.listDetachedTabs().find((record) => record.workspaceInstanceKey === workspaceInstanceKey)

  /** `WorkspaceTabSnapshot` 的容器字段：有已登记的页面窗就取它，否则就是 main 声明。 */
  const containerOf = (tab: WorkspaceTabSnapshot): TabContainerIdentity => {
    const record = pageWindowOf(tab.workspaceInstanceKey)
    return record === undefined
      ? { mode: 'main', ...mainContainer }
      : { mode: 'detached', windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch }
  }

  /** 从真实结果里取容器身份（store 的 detachTab 分配它；registry 采纳它，两侧绝不各自 createId）。 */
  const containerClaimOf = (result: WorkspaceTabCommandResult, workspaceInstanceKey: string) => {
    const tab = result.snapshot.tabs.find((entry) => entry.workspaceInstanceKey === workspaceInstanceKey)
    return tab === undefined ? null : { windowInstanceId: tab.windowInstanceId, hostEpoch: tab.hostEpoch }
  }

  return Object.freeze({ pageWindowOf, containerOf, containerClaimOf })
}
