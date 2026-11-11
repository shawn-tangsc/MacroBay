import { isChannelFailureCode, type ChannelManagementCode } from './ChannelManagementContracts'

/**
 * 运行时启动失败 → **结果码 + 审计细节**（纯函数）。
 *
 * 为什么单独成模块：服务那一屏已经顶到 500 行硬线，而这段只做一件事——把运行时给的原因
 * 翻译成「界面读的码」和「日志查的细节」。以前它写在服务里，且一律落 `adapter-runtime-start-failed`
 * 这个总桶，于是日志与界面都只能说「连接没能起来」，读者只能一遍遍换 Token。
 *
 * 三条规矩：
 * - 原因只要在失败码闭集里，**原样当结果码**（界面与日志读同一个码，不再各自对一次总桶）；
 * - 不在闭集里（旧实现回布尔、或没给原因）才退回总桶；
 * - `closeCode` / `providerCode` 进 summary：它们是「哪一次、被谁挡的」的唯一线索。
 */
export function runtimeFailureOutcome(started: unknown): {
  code: ChannelManagementCode
  summary?: Record<string, string>
} {
  const failure = typeof started === 'object' && started !== null && (started as { ok?: unknown }).ok === false
    ? started as { reason?: unknown; closeCode?: unknown; providerCode?: unknown }
    : null
  const reason = typeof failure?.reason === 'string' && failure.reason !== '' ? failure.reason : undefined
  if (reason === undefined) return { code: 'adapter-runtime-start-failed' }

  const closeCode = typeof failure?.closeCode === 'number' ? String(failure.closeCode) : undefined
  const providerCode = typeof failure?.providerCode === 'string' && failure.providerCode !== '' ? failure.providerCode : undefined
  const summary: Record<string, string> = {
    runtimeReason: reason,
    ...(closeCode === undefined ? {} : { closeCode }),
    ...(providerCode === undefined ? {} : { providerCode })
  }
  return {
    code: isChannelFailureCode(reason) ? (reason as ChannelManagementCode) : 'adapter-runtime-start-failed',
    summary
  }
}