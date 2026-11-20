/**
 * 启动时间线的打点（**纯观测**）。
 *
 * 为什么需要：窗口先以 `about:blank` 显示、之后才加载渲染器，那段白屏从来没有计时点——
 * 主进程只知道 `app.ready`，不知道窗口什么时候可见、渲染器什么时候加载完。这里只写「什么时候到」，
 * 不决定任何先后：删掉本文件与它的调用，启动行为逐字不变。
 *
 * 时间统一取 `Date.now()`（毫秒）：主进程写进 `app.log` 的 `boot.mark`，渲染层用
 * `console.warn` 输出同一套毫秒，两边可以相减。渲染层走 warn 是因为日志只转发 warning/error 级。
 */
export type BootMarkSink = (mark: string, at: number) => void

let sink: BootMarkSink | null = null

/** 由日志的拥有者注册（`composition/platformCore.ts`），让打点与其它启动事件落在同一个 `app.log`。 */
export function registerBootMarkSink(next: BootMarkSink): void {
  sink = next
}

/** 记录一个时刻；写日志失败也绝不抛——观测不能影响启动。 */
export function markBoot(mark: string): void {
  const at = Date.now()
  try {
    sink?.(mark, at)
  } catch {
    // 观测失败只留在控制台。
  }
  console.info(`[boot.mark] ${mark} at=${at}`)
}
