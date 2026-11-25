/**
 * 「这个地址能不能交给 shell 打开」的**唯一判据**。
 *
 * 为什么放在契约层：主进程的出口（`windowIpc.ts` 的 `shellOpenExternal`）与渲染层的动作按钮
 * 都要判一次，两处各写一套就一定漂——2026-11-24 就是这样：主进程 `startsWith('https://')`
 * 大小写敏感，抽屉的正则带 `i`，于是 `HTTP://x` 抽屉画得出按钮、点下去主进程 `throw`，
 * 而调用点 `void openExternal(...)` 把 rejection 吞掉 → 一个点了没反应的空按钮。
 *
 * 判据四条（两处结论必须一致）：`http://` / `https://` 放行，`HTTP://` 放行（协议大小写不敏感），
 * `javascript:` 及其余 scheme 一律拒。
 */
export function isExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  const protocol = parsed.protocol.toLowerCase()
  return protocol === 'http:' || protocol === 'https:'
}
