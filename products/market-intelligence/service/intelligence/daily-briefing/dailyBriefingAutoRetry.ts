/**
 * 失败后自动重试一次：**只对环境类原因**（`02` v2.156，用户 2026-11-06 定）。
 *
 * 两档的理由不一样：
 * - **环境类**（应用被关闭/运行被中断、超时、AI 返回不是合法 JSON）重试有意义——那一次是被环境
 *   打断的，同一份事实再写一遍通常就成。用户那天正是"写作时应用被关"，重试即可自愈。
 * - **配置类**（模型没配、供应商停用、缺 API Key、额度不足）重试只会再失败一次：多烧一次调用、
 *   多等一轮，读者还得再读一遍同样的原因。
 *
 * 约束三条：仍在**一小时补跑窗口**内、**只重试一次**、**留痕**（那一次尝试的触发是 `retry`，
 * 列表上来源显示「重试」，读者不会以为自己点了两次）。
 */
export const environmentFailureCodes: readonly string[] = Object.freeze([
  'run-interrupted',
  'editorial-timeout',
  'run-timeout',
  'invalid-json'
])

/** 补跑窗口：计划时刻之后一小时（与 `dailyBriefingCatchUp.ts` 同一条口径）。 */
export const autoRetryWindowMs = 60 * 60 * 1_000

/** 这个失败码值不值得自动重试一次。 */
export function isEnvironmentFailure(code: string | undefined): boolean {
  return code !== undefined && environmentFailureCodes.includes(code)
}

/** 该不该自动重试：环境类 + 还在一小时窗口内 + 这一次本身不是重试（只重试一次）。 */
export function shouldAutoRetry(input: Readonly<{
  failureCode: string | undefined
  /** 这一版的统计截止；窗口从它算起。 */
  cutoff: string
  now: string
  /** 发起这次运行时的触发方式：已经是 `retry` 就不再重试。 */
  runTrigger?: string
}>): boolean {
  if (input.runTrigger === 'retry') return false
  if (!isEnvironmentFailure(input.failureCode)) return false
  const cutoff = Date.parse(input.cutoff)
  const now = Date.parse(input.now)
  if (!Number.isFinite(cutoff) || !Number.isFinite(now)) return false
  return now - cutoff <= autoRetryWindowMs
}

/**
 * 包一层"跑一次、必要时重试一次"的运行入口。
 *
 * 接在服务的同一个运行函数外面：重试走**同一条合并键、同一个循环**，只是把触发记成 `retry`，
 * 于是尝试记录里多出一条第 2 次，列表上来源显示「重试」。
 */
export function createAutoRetryingResolve<
  I extends Readonly<{ asOf: string; runTrigger?: string }>,
  R extends Readonly<{ state: string; failureCode?: string }>
>(deps: Readonly<{
  run: (input: I, force: boolean) => Promise<R>
  now: () => string
}>): (input: I, force: boolean) => Promise<R> {
  return async (input, force) => {
    const first = await deps.run(input, force)
    if (first.state === 'available') return first
    if (!shouldAutoRetry({ failureCode: first.failureCode, cutoff: input.asOf, now: deps.now(), ...(input.runTrigger ? { runTrigger: input.runTrigger } : {}) })) return first
    return deps.run({ ...input, runTrigger: 'retry' }, force)
  }
}
