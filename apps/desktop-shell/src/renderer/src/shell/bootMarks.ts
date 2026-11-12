/**
 * 渲染层的启动打点（**纯观测**）：只输出一行带毫秒的时刻，不改变任何渲染顺序。
 *
 * 走 `console.warn` 是有原因的：主进程只把 `warning`/`error` 级的 console 消息转发进 `app.log`
 * （见 `platform/desktop/window/rendererProcessDiagnostics.ts`），`info` 不会落盘。
 * `at` 与主进程的 `boot.mark` 同为 `Date.now()`，两边直接相减；`sinceEntry` 只用于渲染层内部自查。
 */
export function markRendererBoot(mark: string): void {
  console.warn(
    `[boot.mark.renderer] ${JSON.stringify({ mark, at: Date.now(), sinceEntry: Math.round(performance.now()) })}`
  )
}
