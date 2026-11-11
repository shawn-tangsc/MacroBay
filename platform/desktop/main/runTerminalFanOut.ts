import type { JobRunTerminalHookInput } from '@platform/jobs'

export type RunTerminalListener = (input: JobRunTerminalHookInput) => void

/**
 * 运行终态的两个槽：平台自己的通知生产者 + 产品登记的数据变更发射器。
 *
 * `createJobRuntime` 只收**一个** `onRunTerminal`，而这个函数原先只挂了
 * `wireTaskFailureNotifier`（任务失败通知）。这里做扇出：原有那条原样保留，产品侧的监听器
 * 通过 `registerProductRunTerminalListener` 登记，调用时**每个都跑一遍**。
 *
 * 三条：
 * - 一个监听器抛错不会拦住后面的：先全部跑完，再把第一个错误抛出去（`jobRuntime` 会吞掉它，
 *   调度照旧）。
 * - 登记表在**调用时**读取，不在装配时快照：产品模块晚一点装配也能收到。
 * - 平台不 import 产品：产品从这里登记，不反向让平台认识某个产品。
 */
const listeners = new Set<RunTerminalListener>()

export function registerProductRunTerminalListener(listener: RunTerminalListener): void {
  listeners.add(listener)
}

/** 测试用：清空登记表（生产里登记只发生一次）。 */
export function resetProductRunTerminalListenersForTest(): void {
  listeners.clear()
}

export function runTerminalListeners(): readonly RunTerminalListener[] {
  return [...listeners]
}

/** 扇出：先跑的抛错也不许让后面的收不到。 */
export function fanOutRunTerminal(
  fixed: readonly RunTerminalListener[],
  registered: () => readonly RunTerminalListener[] = runTerminalListeners
): RunTerminalListener {
  return (input) => {
    let firstError: unknown
    for (const listener of [...fixed, ...registered()]) {
      try {
        listener(input)
      } catch (error) {
        if (firstError === undefined) firstError = error
      }
    }
    if (firstError !== undefined) throw firstError
  }
}