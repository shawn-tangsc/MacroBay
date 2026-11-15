/**
 * **发布后状态怎么翻**（产品口径 2026-11-16）：五态闭集 + 24 小时补值窗口。
 *
 * 今天的 bug 就是这条规则不存在：CPI 11-10 那四条在表里，但 `status` 一直挂着 `scheduled`，
 * 于是卡片写「未提供」、月历不显示成已发布。**过期后永远不许再出现 `scheduled`。**
 *
 * 规则（纯函数，判据只有一处）：
 * - `published`：有实际值（**不管日期**，早到也算已发布）；
 * - `cancelled`：源明确取消（源的判断优先，不看日期）；
 * - `scheduled`：还没到发布时点（`scheduledDate > today`）；
 * - `backfilling`：已过发布时点、没有值，且仍在 24 小时补值窗口内；
 * - `missing`：窗口已过（或尝试次数用尽）仍没有值；旧行的 `unknown` 也归这一档
 *   （「来源未提供状态」），不单开第六态——状态是固定枚举，多一个就多一处解释。
 */
export const releaseStatusBackfillPolicy = Object.freeze({
  /** 补值窗口：官方序列是二传手（源 → FRED → 我们），超过一天基本就是这一期没有。 */
  windowMs: 24 * 60 * 60 * 1_000,
  /** 节拍：发布起 10 分钟首试，之后 30 分钟 / 2 小时 / 6 小时 / 24 小时，共 5 次。 */
  attemptOffsetsMs: Object.freeze([10 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 6 * 60 * 60_000,
    24 * 60 * 60_000] as const),
  maximumAttempts: 5
} as const)

export type DerivedReleaseStatus = 'scheduled' | 'published' | 'backfilling' | 'missing' | 'cancelled'

export function deriveReleaseStatus(input: Readonly<{
  /** 源给的状态；`unknown` 与缺省都按「来源没说」处理。 */
  sourceStatus?: 'scheduled' | 'published' | 'cancelled' | 'unknown'
  scheduledDate: string
  /** 今天（`YYYY-MM-DD`，读者时区），由调用方给，不在这里读时钟。 */
  today: string
  hasActual: boolean
  /** 已经为该行发过几次补值请求。 */
  attempts: number
  /** 当前时刻，用来判 24 小时窗口；与 `scheduledDate` 的时间基准相同（UTC 毫秒）。 */
  nowMs: number
  /** 发布时点（UTC 毫秒）：有时刻用时刻，只有日期用当天 00:00。 */
  releaseAtMs: number
}>): DerivedReleaseStatus {
  if (input.sourceStatus === 'cancelled') return 'cancelled'
  if (input.hasActual) return 'published'
  // 还没到发布日：只有这一种情况允许 `scheduled`。
  if (input.scheduledDate > input.today) return 'scheduled'
  // 已过发布时点、没有值：窗口内是「待补值」，窗口外（或次数用尽）是「未提供」。
  if (input.attempts >= releaseStatusBackfillPolicy.maximumAttempts) return 'missing'
  return input.nowMs - input.releaseAtMs <= releaseStatusBackfillPolicy.windowMs ? 'backfilling' : 'missing'
}
