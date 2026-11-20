import { marketExact, marketInstant } from './marketCalendarQueryContracts'

/**
 * **标准表写入失败**（用户 2026-11-19 / 架构师契约）：与采集失败分开，键名定死
 * `writeFailure: { at, code }`，`code` 闭集两个值；**没有失败就不带这个键**。
 *
 * 单拆一个模块只为体积门禁（`marketCalendarQueryContracts.ts` 的 500 行硬线）：这里的形状与校验
 * 仍由契约主文件 re-export，调用方看到的路径不变。
 *
 * 简报线用 `at` 比「最后一次成功写入」判先后：失败早于最后一次成功说明已经恢复，按老路走。
 */
export type MarketCalendarWriteFailureView = Readonly<{
  at: string
  code: 'standard-write-failed' | 'value-shape-rejected'
  /**
   * 同一个写入方**最近一次写完落地**的时刻（UTC ISO）。判断「这次失败是不是当前的」要用它:
   * 失败晚于它才算当前失败。缺席=从没成功过（按当前失败算，方向只能是显示）。
   * 判断本身只有一处实现：写入层的 `isCurrentWriteFailure`，读方直接调，不许自己比时间。
   */
  lastSuccessAt?: string
}>

/** 形状守卫：多一个键、码越界、时间不合法，整份不认（调用方按「没带这个键」处理）。 */
export function isMarketCalendarWriteFailureView(value: unknown): value is MarketCalendarWriteFailureView {
  if (!marketExact(value, ['at', 'code'], ['lastSuccessAt'])) return false
  const failure = value as { at: unknown; code: unknown; lastSuccessAt?: unknown }
  if (!marketInstant(failure.at)) return false
  if (failure.lastSuccessAt !== undefined && !marketInstant(failure.lastSuccessAt)) return false
  return failure.code === 'standard-write-failed' || failure.code === 'value-shape-rejected'
}
