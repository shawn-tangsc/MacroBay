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
 * 白名单是**闭集**（`02` v2.165 / v2.166）：环境类**八**个码，少一个就等于读者少一次自动重试；
 * **可重试的就只有这八个，其余一律不重试**。裸码 `timeout` 已删——日报运行永远不会返回它
 * （AI 调用超时先被映射成 `editorial-timeout`），留着就是"代码自己承认永不发生"的死码；
 * 换进来的两个是**真会发生**的：`provider-error`（模型网关报错）与
 * `agent-turn-output-truncated`（单轮输出被截断），两者都与一次坏输出同类，重写一遍有意义。
 * `run-timeout` 保留：它由运行截止器产生（`dailyBriefingRunDeadline.ts`），不是死码。
 */
export const environmentFailureCodes: readonly string[] = Object.freeze([
  'run-interrupted',
  'editorial-timeout',
  'run-timeout',
  'invalid-json',
  'invalid-shape',
  'schema-validation-failed',
  'provider-error',
  'agent-turn-output-truncated'
])

/** 自动重试那一次尝试的触发值：与读者手点的 `retry` 分开，来源词才不会混。 */
export const autoRetryTrigger = 'auto-retry' as const

/** 补跑窗口：计划时刻之后一小时（与 `dailyBriefingCatchUp.ts` 同一条口径）。 */
export const autoRetryWindowMs = 60 * 60 * 1_000

/** 这个失败码值不值得自动重试一次。 */
export function isEnvironmentFailure(code: string | undefined): boolean {
  return code !== undefined && environmentFailureCodes.includes(code)
}

/**
 * 该不该自动重试：环境类 + 还在一小时窗口内 + 这一次本身不是重试（只重试一次）+
 * **运行时还活着**（应用正在关闭时不重试）。
 *
 * 最后一条是架构师 2026-11-07 的保留项：`run-interrupted` 本身就在环境类里，而它最常见的原因
 * 正是"应用被关了"。那时再起第二次运行，只会多写一条注定失败的尝试、多烧一次会话，读者第二天
 * 看到的是两次失败。所以重试前先问一句还在不在，不在就原样返回第一次的结果。
 */
export function shouldAutoRetry(input: Readonly<{
  failureCode: string | undefined
  /** 这一版的统计截止；窗口从它算起。 */
  cutoff: string
  now: string
  /** 发起这次运行时的触发方式：已经是重试（手动或自动）就不再重试。 */
  runTrigger?: string
  /** 运行时是否还活着；`false` = 应用正在关闭，不许再起一次。由调用方的中止信号给出来。 */
  runtimeAlive?: boolean
}>): boolean {
  if (input.runtimeAlive === false) return false
  if (input.runTrigger === 'retry' || input.runTrigger === autoRetryTrigger) return false
  if (!isEnvironmentFailure(input.failureCode)) return false
  const cutoff = Date.parse(input.cutoff)
  const now = Date.parse(input.now)
  if (!Number.isFinite(cutoff) || !Number.isFinite(now)) return false
  // 窗口是**闭区间**：`[cutoff, cutoff + 1h]`。下界也判——统计截止还在未来时，这一版根本没到点，
  // 重试会把"还没到点"当成"失败过一次"。
  if (now < cutoff) return false
  return now - cutoff <= autoRetryWindowMs
}

/**
 * 包一层"跑一次、必要时重试一次"的运行入口。
 *
 * 接在服务的同一个运行函数外面：重试走**同一条合并键、同一个循环**，只是把触发记成
 * `auto-retry`，于是尝试记录里多出第 2 次，列表上来源写「自动重试」。
 */
export function createAutoRetryingResolve<
  I extends Readonly<{ asOf: string; runTrigger?: string; signal?: AbortSignal }>,
  R extends Readonly<{ state: string; failureCode?: string }>
>(deps: Readonly<{
  run: (input: I, force: boolean) => Promise<R>
  now: () => string
  /**
   * 运行时是否还活着：应用开始退出时返回 `false`，此后不再自动重试。
   *
   * 缺省用**这一次运行自己的中止信号**（job 的 `ctx.signal`，`stopAll` 时会 abort）——那就
   * 是"应用正在关闭"的类型化信号，不用另外发明一个开关，也不从报文里猜。
   */
  isRuntimeAlive?: () => boolean
}>): (input: I, force: boolean) => Promise<R> {
  return async (input, force) => {
    const first = await deps.run(input, force)
    if (first.state === 'available') return first
    const runtimeAlive = deps.isRuntimeAlive?.()
      ?? (input.signal === undefined ? undefined : !input.signal.aborted)
    const retry = shouldAutoRetry({
      failureCode: first.failureCode,
      cutoff: input.asOf,
      now: deps.now(),
      ...(input.runTrigger === undefined ? {} : { runTrigger: input.runTrigger }),
      ...(runtimeAlive === undefined ? {} : { runtimeAlive })
    })
    if (!retry) return first
    return deps.run({ ...input, runTrigger: autoRetryTrigger }, force)
  }
}
