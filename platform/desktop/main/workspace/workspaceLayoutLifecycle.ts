import type { PanelLayoutDocumentV1 } from '@platform/workspace/persistence/panelLayoutDocument'
import type { PanelLayoutSaveResult } from '@platform/workspace/persistence/panelLayoutStore'
import type { WorkspaceSnapshot } from '@platform/workspace/contracts'
import type { createPanelDetachedWindowHost } from './panelDetachedWindowHost'
import type { WorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace（P2-03，PM 裁决 F2：从 `panelWorkspaceTransferOrchestrator.ts` 拆出）。
 *
 * compose 的**布局落盘生命周期**：退出/显式 flush 与「面板命令关闭后的独立窗收敛」。它与退出编排
 * （`markExiting` + 宿主 appExit + 有界清理）同属一条链，因此单独成模块，让 compose 只做接线、
 * 编排器只做转移。
 *
 * 行为逐字未改：flush 结论 + `hadPendingWrites` + 覆盖 revision 三项照旧如实上报，退出路径绝不 rethrow；
 * 收敛判据只来自权威快照 + registry，动作交给编排器的 `closeClosedPanelWindow`。
 */

/**
 * P1-06m：退出 flush 的**受控报告**（纯数据，注入 log 后即成为日志行）。真机症状（P1-07R）：debounce（实测
 * 261ms）窗口内的最后一次变更在退出时丢失，而 `app.ts` 丢弃了 `dispose()` 的返回值 ⇒ 无法区分「flush 没跑」
 * 与「flush 跑输」。`hadPendingWrites` 就是那个判据：退出瞬间是否真的还有待写。
 */
export type WorkspaceLayoutFlushReport = {
  status: 'ready' | 'disabled'
  outcome: PanelLayoutSaveResult['outcome'] | 'timeout'
  hadPendingWrites: boolean
  /** 本次 flush 覆盖到的 runtime store revision（0 = 禁用态/无 store）。 */
  layoutRevision: number
}

/**
 * 可选字段只为兼容禁用态的最小形状（`{status:'disabled', flushOutcome:'skipped'}`）：禁用态没有任何待写、
 * 宿主或 owner 可谈，缺省即 `false/0`，绝不会被当成「跑过并成功」。
 */
export type WorkspaceDisposeReport = {
  status: 'ready' | 'disabled'
  flushOutcome: PanelLayoutSaveResult['outcome'] | 'timeout'
  hadPendingWrites?: boolean
  layoutRevision?: number
  /** 宿主实际销毁的派生窗数量（未接线/禁用态缺省，绝不谎报）。 */
  destroyedWindows?: number
  /** 宿主撤销的 owner 数量。 */
  ownersRevoked?: number
}

/**
 * 编排器的**结构化端口**（只取本模块真正用到的两项 + dispose）：不 import 编排器类型，
 * 避免「编排器 ←→ 生命周期」的类型环，也让本模块可以独立测试。
 */
export type WorkspaceLayoutLifecycleOrchestratorPort = {
  lifecycle: {
    markExiting: () => void
    closeClosedPanelWindow: (input: { windowInstanceId: string; hostEpoch: number }) => Promise<unknown>
  }
  dispose: () => void
}

/** 有界等待：超时返回 `'timeout'`（绝不把超时当成成功）。 */
function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T | 'timeout'> {
  let cancel: () => void = () => undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), timeoutMs)
    cancel = () => clearTimeout(timer)
  })
  return Promise.race([work, timeout]).finally(cancel)
}

export function createWorkspaceLayoutLifecycle(options: {
  layoutStore: {
    pendingWriteCount: () => number
    flush: () => Promise<PanelLayoutSaveResult>
    schedule: (document: PanelLayoutDocumentV1) => void
  }
  runtimeStore: {
    getSnapshot: () => WorkspaceSnapshot
    exportLayoutDocument: (input: { savedAt: string }) => { status: string; document?: PanelLayoutDocumentV1 }
    prepareForAppExit: () => Promise<unknown>
  }
  /** 完整 P1-04 宿主（缺省 = 未接线：走本模块自己的有界 flush，不碰派生窗）。 */
  fullDetachedHost: ReturnType<typeof createPanelDetachedWindowHost> | null
  orchestrator: WorkspaceLayoutLifecycleOrchestratorPort | null
  windowRegistry: Pick<WorkspaceWindowRegistry, 'listDetachedHosts'>
  savedAtNow: () => string
  disposeTimeoutMs: number
  resetRouter: () => void
}) {
  const scheduleLayoutSave = (): void => {
    const exported = options.runtimeStore.exportLayoutDocument({ savedAt: options.savedAtNow() })
    if (exported.status === 'ok' && exported.document !== undefined) options.layoutStore.schedule(exported.document)
  }

  return Object.freeze({
    scheduleLayoutSave,

    /**
     * 面板命令关闭后的独立窗收敛（`closePanel` 只把 `open` 置 false，窗口不会自己消失）：
     * 判据只来自权威快照 + registry，动作全部交给编排器的 `closeClosedPanelWindow`，本层不重复实现。
     */
    convergeClosedPanelWindows(): void {
      const orchestrator = options.orchestrator
      if (orchestrator === null) return
      const current = options.runtimeStore.getSnapshot()
      for (const record of options.windowRegistry.listDetachedHosts()) {
        const panelInstanceKey = record.panelInstanceKey
        if (panelInstanceKey === null) continue
        const panel = current.panels.find((entry) => entry.panelInstanceKey === panelInstanceKey)
        if (panel !== undefined && panel.open) continue
        void orchestrator.lifecycle.closeClosedPanelWindow({
          windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch
        }).catch(() => undefined)
      }
    },

    /** 退出/显式 flush：先把最新导出压进待写槽，再有界落盘，并如实回报判据（绝不抛）。 */
    async flushLayout(): Promise<WorkspaceLayoutFlushReport> {
      const hadPendingWrites = options.layoutStore.pendingWriteCount() > 0
      const layoutRevision = options.runtimeStore.getSnapshot().layoutRevision
      try {
        scheduleLayoutSave()
        const outcome = await withTimeout(options.layoutStore.flush(), options.disposeTimeoutMs)
        return {
          status: 'ready', outcome: outcome === 'timeout' ? 'timeout' : outcome.outcome,
          hadPendingWrites, layoutRevision
        }
      } catch {
        return { status: 'ready', outcome: 'failed', hadPendingWrites, layoutRevision }
      }
    },

    /**
     * 退出：冻结分离意图 → 冻结布局 → 导出真实文档 → 有界 flush → 清空路由目标与编排残留。
     * 绝不写 open=false，也不新建回停靠窗口；返回完整可观测报告（绝不只回一个 flushOutcome）。
     */
    async dispose(): Promise<WorkspaceDisposeReport> {
      let flushOutcome: WorkspaceDisposeReport['flushOutcome'] = 'skipped'
      let layoutOutcome: WorkspaceDisposeReport['flushOutcome'] = 'skipped'
      const hadPendingWrites = options.layoutStore.pendingWriteCount() > 0
      const layoutRevision = options.runtimeStore.getSnapshot().layoutRevision
      let destroyedWindows = 0
      let ownersRevoked = 0
      const host = options.fullDetachedHost
      options.orchestrator?.lifecycle.markExiting()
      try {
        await options.runtimeStore.prepareForAppExit()
        scheduleLayoutSave()
        if (host === null) {
          const outcome = await withTimeout(options.layoutStore.flush(), options.disposeTimeoutMs)
          flushOutcome = outcome === 'timeout' ? 'timeout' : outcome.outcome
        } else {
          const summary = await host.appExit({
            flush: async () => { layoutOutcome = (await options.layoutStore.flush()).outcome }
          })
          destroyedWindows = summary.destroyedWindowIds.length
          ownersRevoked = summary.ownersRevoked
          flushOutcome = summary.flushOutcome === 'timeout' ? 'timeout'
            : summary.flushOutcome === 'failed' ? 'failed' : layoutOutcome
        }
      } catch (error) {
        // 先清理、再把原始消费者失败原样抛出；只有失败是对象时才有 appExitSummary。退出路径绝不 rethrow。
        const summary = (error as {
          appExitSummary?: { flushOutcome?: string; destroyedWindowIds?: readonly string[]; ownersRevoked?: number }
        } | null)?.appExitSummary
        if (summary?.destroyedWindowIds !== undefined) destroyedWindows = summary.destroyedWindowIds.length
        if (typeof summary?.ownersRevoked === 'number') ownersRevoked = summary.ownersRevoked
        flushOutcome = summary?.flushOutcome === 'timeout' ? 'timeout'
          : summary?.flushOutcome === 'flushed' ? layoutOutcome
          : 'failed'
      } finally {
        options.orchestrator?.dispose()
        options.resetRouter()
      }
      return { status: 'ready', flushOutcome, hadPendingWrites, layoutRevision, destroyedWindows, ownersRevoked }
    }
  })
}
