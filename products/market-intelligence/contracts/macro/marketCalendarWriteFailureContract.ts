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
}>

/** 形状守卫：多一个键、码越界、时间不合法，整份不认（调用方按「没带这个键」处理）。 */
export function isMarketCalendarWriteFailureView(value: unknown): value is MarketCalendarWriteFailureView {
  if (!marketExact(value, ['at', 'code'])) return false
  const failure = value as { at: unknown; code: unknown }
  if (!marketInstant(failure.at)) return false
  return failure.code === 'standard-write-failed' || failure.code === 'value-shape-rejected'
}
