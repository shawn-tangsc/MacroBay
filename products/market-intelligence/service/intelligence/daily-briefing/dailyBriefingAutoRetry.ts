/**
 * 失败后自动重试一次：**只对环境类原因**（`02` v2.156，用户 2026-11-06 定）。
 *
 * 两档的理由不一样：
 * - **环境类**（应用被关闭/运行被中断、超时、AI 返回不合法或不合格式）重试有意义——那一次是被
 *   环境或一次坏输出打断的，同一份事实再写一遍通常就成。用户那天正是"写作时应用被关"。
 * - **配置类**（模型没配、供应商停用、缺 API Key、额度不足）重试只会再失败一次：多烧一次调用、
 *   多等一轮，读者还得再读一遍同样的原因。
 *
 * 约束三条：仍在**一小时补跑窗口**内、**只重试一次**、**留痕**——那一次尝试的触发记成
 * `auto-retry`，列表上来源写「自动重试」，与读者手点的「重试」不是同一个词（`02` v2.158：
 * 两种同词即红，否则读者会以为自己点了两次）。
 *
 * 白名单是**闭集**（`02` v2.158）：环境类七个码，少一个就等于读者少一次自动重试。
 */
export const environmentFailureCodes: readonly string[] = Object.freeze([
  'run-interrupted',
  // 日报运行不会直接返回裸 `timeout`（AI 调用超时先被映射成 `editorial-timeout`）；留着是照条文
  // 的闭集，不改变行为。
  'timeout',
  'editorial-timeout',
  'run-timeout',
  'invalid-json',
  'invalid-shape',
  'schema-validation-failed'
])

/** 自动重试那一次尝试的触发值：与读者手点的 `retry` 分开，来源词才不会混。 */
export const autoRetryTrigger = 'auto-retry' as const

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
  /** 发起这次运行时的触发方式：已经是重试（手动或自动）就不再重试。 */
  runTrigger?: string
}>): boolean {
  if (input.runTrigger === 'retry' || input.runTrigger === autoRetryTrigger) return false
  if (!isEnvironmentFailure(input.failureCode)) return false
  const cutoff = Date.parse(input.cutoff)
  const now = Date.parse(input.now)
  if (!Number.isFinite(cutoff) || !Number.isFinite(now)) return false
  return now - cutoff <= autoRetryWindowMs
}

/**
 * 包一层"跑一次、必要时重试一次"的运行入口。
 *
 * 接在服务的同一个运行函数外面：重试走**同一条合并键、同一个循环**，只是把触发记成
 * `auto-retry`，于是尝试记录里多出第 2 次，列表上来源写「自动重试」。
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
    const retry = shouldAutoRetry({
      failureCode: first.failureCode,
      cutoff: input.asOf,
      now: deps.now(),
      ...(input.runTrigger === undefined ? {} : { runTrigger: input.runTrigger })
    })
    if (!retry) return first
    return deps.run({ ...input, runTrigger: autoRetryTrigger }, force)
  }
}
