/**
 * 退出编排：**唯一的退出入口**，不含任何 Electron 全局。
 *
 * 两件事各归各的：
 * - `createRuntimeDisposer`：`disposePlatformRuntimes()` 的有序清理链。顺序是硬性的，错位只在退出瞬间
 *   出错（定时器在 teardown 里再跑一次、fence 之后 adapter 还写一次），全量测试永远看不见，所以这里
 *   每一步都是显式端口，顺序由本文件唯一决定。
 * - `createQuitOrchestrator`：`before-quit` 的五步——置退出期标记 → `preventDefault()` → 一次性保护 →
 *   有界 dispose → 放行一次 `app.quit()`；`budgetMs`、`setTimeout`、`clearTimeout` 与 `quit` 都可注入，
 *   测试用假时钟拨过 15 秒，不真等。
 *
 * `app.on` / `process.on` 的注册留在 `app.ts`：新模块只接收「一次退出事件」。
 */

export type RuntimeDisposerPorts<WorkspaceReport = unknown> = Readonly<{
  /** 先关产品 IPC 入口，再拆产品服务/DB。 */
  markProductIpcClosed: () => void
  /** 有界落盘待写布局；绝不在这一步抛。 */
  flushPanelWorkspaceLayout: () => Promise<void>
  /** 维护定时器（实测 3 个：任务自动化 / 运行记录保留 / 渠道维护）。 */
  disposeMaintenanceTimers: ReadonlyArray<() => void>
  /** 6 个渠道 adapter 的 dispose，按传入顺序逐个 await。 */
  disposeAdapters: ReadonlyArray<() => Promise<unknown>>
  /** adapter 全部停下之后才 fence。 */
  fenceChannels: () => void
  stopTaskScheduler: () => void
  stopJobs: () => void
  disposeProductServices: () => Promise<void>
  /** agent runtime / MCP 两个运行时的 dispose（并发，结果不阻断退出）。 */
  disposeAgentRuntimes: ReadonlyArray<() => Promise<unknown>>
  /** 工作区组合体的 dispose；返回报告或 undefined。 */
  disposeWorkspace: () => Promise<WorkspaceReport | undefined>
  reportWorkspaceDispose: (report: WorkspaceReport) => void
  closeJobRunStore: () => void
}>

export type RuntimeDisposer = {
  /** 幂等：重复调用只执行一次。 */
  dispose: () => Promise<void>
  isDisposed: () => boolean
}

export function createRuntimeDisposer<WorkspaceReport = unknown>(
  ports: RuntimeDisposerPorts<WorkspaceReport>
): RuntimeDisposer {
  let disposed = false

  async function dispose(): Promise<void> {
    if (disposed) return
    disposed = true
    ports.markProductIpcClosed()
    await ports.flushPanelWorkspaceLayout()
    for (const stop of ports.disposeMaintenanceTimers) stop()
    for (const stopAdapter of ports.disposeAdapters) await stopAdapter()
    ports.fenceChannels()
    ports.stopTaskScheduler()
    ports.stopJobs()
    await ports.disposeProductServices()
    await Promise.allSettled(ports.disposeAgentRuntimes.map((stop) => stop()))
    const report = await ports.disposeWorkspace()
    if (report !== undefined) ports.reportWorkspaceDispose(report)
    ports.closeJobRunStore()
  }

  return { dispose, isDisposed: () => disposed }
}

export type QuitEvent = { preventDefault: () => void }

export type QuitOrchestratorPorts = Readonly<{
  dispose: () => Promise<void>
  quit: () => void
  budgetMs?: number
  setTimeout?: (callback: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}>

export type QuitOrchestrator = {
  /** 退出期标记：派生窗据此不再 preventDefault。 */
  isQuitting: () => boolean
  /** 退出清理是否已结束（放行后再次 `quit()` 不再挂起）。 */
  isSettled: () => boolean
  handleBeforeQuit: (event: QuitEvent) => void
}

/** 清理挂起本轮退出的上界：清理再慢也绝不让进程永远退不出去。 */
export const QUIT_DISPOSE_BUDGET_MS = 15_000

export function createQuitOrchestrator(ports: QuitOrchestratorPorts): QuitOrchestrator {
  const budgetMs = ports.budgetMs ?? QUIT_DISPOSE_BUDGET_MS
  const scheduleTimeout = ports.setTimeout ?? ((callback: () => void, ms: number) => setTimeout(callback, ms))
  const cancelTimeout =
    ports.clearTimeout ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  let quitting = false
  let disposeStarted = false
  let settled = false

  function handleBeforeQuit(event: QuitEvent): void {
    quitting = true
    if (settled) return
    event.preventDefault()
    if (disposeStarted) return
    disposeStarted = true
    let released = false
    const releaseQuit = (): void => {
      if (released) return
      released = true
      settled = true
      ports.quit()
    }
    const escape = scheduleTimeout(releaseQuit, budgetMs)
    ;(escape as { unref?: () => void } | undefined)?.unref?.()
    void ports
      .dispose()
      .catch(() => undefined)
      .finally(() => {
        cancelTimeout(escape)
        releaseQuit()
      })
  }

  return { isQuitting: () => quitting, isSettled: () => settled, handleBeforeQuit }
}
