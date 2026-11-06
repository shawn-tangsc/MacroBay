/**
 * 上游断流重试一次。
 *
 * 只对 `upstream-aborted` 开这一格：那是「连接在生成中途断了」，换一次请求真有可能拿到答案。
 * 限流、连不上、超时、其他错误都不重试——立刻再来一遍只会把同一件事再烧一次钱，而它们的
 * 原因不在这一次请求上。
 *
 * 三条边界，缺一条就会变成重试风暴：
 * - **同一次运行内重试**，不新起运行行：新行会让额度的分母、通知的样本、运行记录的条数一起变大；
 * - **同一触发键每 UTC 日一次**，先占后跑：崩溃时宁可今天不试，也不能一天试十几遍；
 * - **一次运行调用上限 3 次**（初次 + 传输重试 + 修复），两笔预算不叠成第四次。
 */
export type UpstreamRetryDecision =
  | Readonly<{ retry: true }>
  | Readonly<{ retry: false; reason: 'not-aborted' | 'attempts-spent' | 'already-used-today' }>

export const analysisUpstreamRetryPolicy = Object.freeze({
  version: 'analysisUpstreamRetry.v1',
  /** The only detail code that earns a retry. */
  retryableDetailCode: 'upstream-aborted' as const,
  backoffMs: 20_000,
  /** Calls per run: initial, transport retry, repair. Never a fourth. */
  maximumCallsPerRun: 3,
  /** How far back "today" reaches; one claim per trigger key per UTC day. */
  dailyWindowMs: 24 * 60 * 60 * 1_000
})

export function decideUpstreamRetry(input: Readonly<{
  failureDetailCode: string | null
  /** Calls already spent on this run, including the one that just failed. */
  callsSpent: number
  /** When this trigger key last claimed its retry, if ever. */
  lastRetryAt: string | null
  now: string
}>): UpstreamRetryDecision {
  if (input.failureDetailCode !== analysisUpstreamRetryPolicy.retryableDetailCode) return { retry: false, reason: 'not-aborted' }
  if (input.callsSpent >= analysisUpstreamRetryPolicy.maximumCallsPerRun - 1) return { retry: false, reason: 'attempts-spent' }
  // A retry is claimed before it runs, so a crash still spends the day's one allowance: fail-closed.
  if (input.lastRetryAt && input.lastRetryAt.slice(0, 10) === input.now.slice(0, 10)) {
    return { retry: false, reason: 'already-used-today' }
  }
  return { retry: true }
}
