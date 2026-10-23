import { useEffect, type Dispatch, type SetStateAction } from 'react'

import type {
  WorkspacePendingTransferView,
  WorkspaceSnapshot,
  WorkspaceTabSnapshot
} from '@platform/workspace/contracts'
import type {
  WorkspaceClient,
  WorkspaceHostContext,
  WorkspaceTabClient,
  WorkspaceTabPendingDetach
} from './workspaceClient'

/**
 * Owner: apps/desktop-shell renderer / workspace —— 窗口根的**状态形状与页窗订阅**。
 *
 * PLAT-02（行数纪律）：状态机类型与页窗订阅 effect 原先内联在 `WorkspaceWindowRoot.tsx`；它们同属
 * 「窗口根状态」这一族，因此搬到本文件（呈现面在同目录 `workspaceWindowSurfaces.tsx`，回停靠控件在
 * `PageWindowRedockControl.tsx`）。
 *
 * 搬运纪律：**只有位置变了**——订阅语义（事件到达即重取、卸载即退订并 dispose）与状态形状逐字不变。
 */

/**
 * 窗口根的状态机（角色判定结果）。页面窗那条分支（P2-03）在受控上下文里没有面板挂载，因此由
 * `.tabs.*` 的受控快照判定：恰好一个 `open` 的 Tab 且容器身份就是本窗；判定只来自 Main（身份 + epoch
 * 逐字一致），renderer 不能自选实例。
 *
 * P2-07：`pendingDetach` 是 `.tabs.getSnapshot` 的受控待 ACK 投影（页窗据此报 `target-ready`，每个
 * operationId 只报一次，绝不重试、绝不伪造后续相位）。
 *
 * PLAT-03：`layoutRevision` 是**权威 Tab store revision**（同一次受控快照读取里的真实值），供页窗
 * `state.layoutRevision` 使用；**绝不用 `tab.order`**（Tab 在条带里的位置，是另一个值空间）冒充它。
 */
export type HostState =
  | { status: 'shell' }
  | { status: 'resolving' }
  | { status: 'main'; context: WorkspaceHostContext; snapshot: WorkspaceSnapshot | null; client: WorkspaceClient }
  | { status: 'panel'; context: WorkspaceHostContext; snapshot: WorkspaceSnapshot; client: WorkspaceClient }
  | {
      status: 'page'
      context: WorkspaceHostContext
      tabClient: WorkspaceTabClient
      /** PLAT-10：角色解析建立的那**同一个**受控客户端（偏好重取唯一出口；卸载即随角色解析释放）。 */
      client: WorkspaceClient
      tab: WorkspaceTabSnapshot
      layoutRevision: number
      pendingDetach: WorkspaceTabPendingDetach | null
    }
  | {
      status: 'pending'
      context: WorkspaceHostContext
      snapshot: WorkspaceSnapshot
      transfer: WorkspacePendingTransferView
      client: WorkspaceClient
    }
  | { status: 'error'; reason: 'context-unavailable' | 'panel-unmounted' }

/**
 * 独立页面窗订阅 Tab 权威快照：任何受控事件到达即重取（含容器漂移/回停靠后的收敛）。
 *
 * P2-07：待 ACK 投影与快照**同源更新**（同一个受控读取），页窗 ACK 链据此收敛；
 * PLAT-03：`layoutRevision` 与 `tab` 同源，页窗绝不自行推导 revision。
 * 卸载即退订并 dispose（订阅幂等由 workspaceClient 的既有语义保证）。
 *
 * PLAT-10（页窗语言/主题跟随主窗）：受控事件到达时**同时**单飞地重取一次受控 `getHostContext()`
 * （既有受控读取，不新增通道/preload 方法）—— `context.preferences` 是窗口级解析结果，只在重取时刷新，
 * 因此「跟随」= 收到既有 `workspaceEvent` 后重取一次受控上下文：
 *  - **有界**：单飞 + 至多合并一次（`reading`/`queued`）⇒ 事件再多也不会让受控读取次数无界放大，
 *    更不会自我驱动（重取本身绝不产生事件 ⇒ 无自持环）；
 *  - **未归属/失败显式**：只有「读取成功且身份与本窗受控上下文逐字一致」才写回；否则维持最后一次受控值，
 *    绝不改判归属、绝不把页面窗降级成错误壳（那一判据只属于角色解析那一次读取）。
 */
export function usePageWindowTabSubscription(
  pageTabClient: WorkspaceTabClient | null,
  pageClient: WorkspaceClient | null,
  setState: Dispatch<SetStateAction<HostState>>
): void {
  useEffect(() => {
    if (pageTabClient === null) return
    let cancelled = false
    let reading = false
    let queued = false
    const refreshContext = async (): Promise<void> => {
      if (pageClient === null) return
      // 事件风暴/StrictMode 双调用都只保留一个在飞读取（并发时合并为至多一次追读）
      if (reading) { queued = true; return }
      reading = true
      try {
        do {
          queued = false
          const outcome = await pageClient.readHostContext().catch(() => null)
          if (cancelled) return
          if (outcome !== null && outcome.status === 'ok') {
            const next: WorkspaceHostContext = outcome.context
            setState((previous) => previous.status === 'page' && previous.tabClient === pageTabClient
              && previous.context.windowInstanceId === next.windowInstanceId
              && previous.context.hostEpoch === next.hostEpoch
              ? { ...previous, context: next }
              : previous)
          }
        } while (queued && !cancelled)
      } finally { reading = false }
    }
    const stop = pageTabClient.observe((next) => {
      if (cancelled) return
      const own = next.tabs.filter((tab) => tab.open && tab.windowInstanceId === next.tabs[0]?.windowInstanceId)
      // P2-07：待 ACK 投影与快照同源更新（同一个受控读取），页窗 ACK 链据此收敛
      const pending = pageTabClient.pendingDetach()
      setState((previous) => previous.status === 'page' && previous.tabClient === pageTabClient && own.length === 1
        ? { ...previous, tab: own[0] as WorkspaceTabSnapshot, layoutRevision: next.layoutRevision, pendingDetach: pending }
        : previous)
      // PLAT-10：事件只是「去重取一次」的信号；偏好值仍只来自受控上下文
      void refreshContext()
    })
    return () => { cancelled = true; stop(); pageTabClient.dispose() }
  }, [pageClient, pageTabClient, setState])
}

/**
 * 已取得角色的窗口（主窗/面板窗）订阅权威快照：受控事件到达即重取，按 `previous.client` 守卫写回快照正文。
 *
 * PLAT-02（行数纪律）：本 effect 原先内联在 `WorkspaceWindowRoot.tsx`；它与窗口根的状态机同族，因此整体搬到
 * 这里。**搬运纪律：主窗语义逐字不变** —— 同一条 `observe`、同一个写回守卫、同一份依赖。
 *
 * PLAT-28（面板窗语言/主题跟随主窗）：面板窗在同一条订阅里**顺带**单飞地重取一次受控 `getHostContext()`
 * （`context.preferences` 是窗口级解析结果，只在重取时刷新；`followPreferences` 为真时启用）：
 *  - **有界**：单飞 + 至多合并一次追读（`reading`/`queued`）⇒ 事件再多也不会让受控读取次数无界放大，
 *    更不会自我驱动（重取本身绝不产生事件 ⇒ 无自持环）；
 *  - **未归属/失败显式**：只有「读取成功且身份与本窗受控上下文逐字一致」才写回；否则维持最后一次受控值，
 *    绝不改判归属、绝不把面板窗降级成错误壳（那一判据只属于角色解析那一次读取）；
 *  - **相位无关**：只写 `context`，绝不触碰 `transfer`/ACK ⇒ 偏好通知既不被当作相位推进信号，
 *    也不触发快照重挂（快照正文仍只由上面那条既有写回路径更新）。
 */
export function useWorkspaceSnapshotSubscription(
  observableClient: WorkspaceClient | null,
  followPreferences: boolean,
  setState: Dispatch<SetStateAction<HostState>>
): void {
  useEffect(() => {
    if (observableClient === null) return
    let cancelled = false
    let reading = false
    let queued = false
    const refreshContext = async (): Promise<void> => {
      if (!followPreferences) return
      // 事件风暴/StrictMode 双调用都只保留一个在飞读取（并发时合并为至多一次追读）
      if (reading) { queued = true; return }
      reading = true
      try {
        do {
          queued = false
          const outcome = await observableClient.readHostContext().catch(() => null)
          if (cancelled) return
          if (outcome !== null && outcome.status === 'ok') {
            const next: WorkspaceHostContext = outcome.context
            setState((previous) => previous.status === 'panel' && previous.client === observableClient
              && previous.context.windowInstanceId === next.windowInstanceId
              && previous.context.hostEpoch === next.hostEpoch
              ? { ...previous, context: next }
              : previous)
          }
        } while (queued && !cancelled)
      } finally { reading = false }
    }
    const stop = observableClient.observe((snapshot) => {
      setState((previous) => (previous.status === 'main' || previous.status === 'panel') && previous.client === observableClient
        ? { ...previous, snapshot }
        : previous)
      // PLAT-28：事件只是「去重取一次」的信号；偏好值仍只来自受控上下文（事件绝不承载偏好值）
      void refreshContext()
    })
    return () => { cancelled = true; stop() }
  }, [observableClient, followPreferences, setState])
}
