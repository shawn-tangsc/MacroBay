import type { JobRuntime, ScheduledJobDefinition } from '@platform/jobs'

import { createNarwhalCalendarJobHandler, narwhalCalendarSweepPolicy, narwhalCalendarTickPolicy } from './narwhalCalendarJob'
import type { createNarwhalCalendarRuntime } from './narwhalCalendarRuntime'

/**
 * Narwhal 日历的两条作业注册（tick + 日扫），**判定只看源自己**：
 *
 * - 注册条件 = **有凭据 + 该源内建启用**；
 * - **不看 `profile.enabled`**：读者的开关在 `pending` 期间锁着、拨不动，让后台任务的存在
 *   取决于一个拨不动的开关，下次一定有人来问「为什么没采」；
 * - **但解锁之后读者的开关必须重新成为判据**：`readerEnabled()` 一旦返回布尔值（不再是
 *   `undefined`＝仍锁着），关掉它就要 `removeSchedule`——否则解锁那天才发现开关是死的。
 *
 * 这条「解锁后开关必须生效」由用例钉住，不靠注释。
 *
 * **现状（2026-11-13）**：三条 Narwhal 已解锁（`visibility` 不再是 `pending`），所以
 * 「`pending` 就不采」那条判据**今天是死路径、不触发**；留着是给以后先在 `pending` 里试水的
 * 新源用——那时它必须真的挡住采集，而不是只在设置页显示「待接入」。
 *
 * **启动自检**：`interval` + `anchor='lastStart'` 在平台调度器里是朴素 `setInterval`——注册后
 * 第一次触发在**一个间隔之后**。日扫是 24 小时一次，于是新装或重启后的头 24 小时里
 * 「今天..+30 天」一条都不会采，读者看到的就是「下半月空着」。这不是「等它跑」，
 * 是启动后没有补一次。所以注册完立刻查一次「这条定义最近一次成功是什么时候」：
 * 没有记录、或距今 ≥ 一个间隔 → 立刻排一次；没到期就不跑（不因为重启而白拉一遍）。
 * **采集窗口不变**，这里只补触发时机。
 */
export function createNarwhalCalendarScheduler(deps: Readonly<{
  /** 采集前的门：`visibility === 'pending'` 或读者关掉 → 这轮不采（返回 `skipped`，不静默）。 */
  readSourceGate?: () => Promise<Readonly<{ visibility: string; enabled: boolean }> | undefined>
  jobRuntime: Pick<JobRuntime, 'registerHandler' | 'setSchedule' | 'removeSchedule' | 'enqueueDefinition' | 'listRuns'>
  runtime: ReturnType<typeof createNarwhalCalendarRuntime>
  now: () => number
  /** 有密钥才谈得上采集；没配就一个请求都不发（与采集循环同一条判据）。 */
  hasCredential: () => boolean
  /**
   * 读者侧的开关：`undefined` ＝ 还没解锁（`pending` 期间锁着，不参与判断）；
   * 返回布尔值之后开始参与判断——这正是「解锁后开关必须生效」的落点。
   */
  readerEnabled?: () => boolean | undefined
  countries?: readonly string[]
}>) {
  const definitions = [maybeDefinition(narwhalCalendarTickPolicy), maybeDefinition(narwhalCalendarSweepPolicy)]
  let registered = false

  // 平台 handler 收到 `(payload, context)`；我们只关心窗口，payload 里的覆盖值照传。
  function handlers(): Array<[string, (payload: unknown) => Promise<void>]> {
    const wrap = (mode: 'tick' | 'sweep') => async (payload: unknown): Promise<void> => {
      const override = payload as Readonly<{ startDate?: string; endDate?: string }> | undefined
      const run = createNarwhalCalendarJobHandler({ runtime: deps.runtime, now: deps.now, mode,
        ...(deps.countries === undefined ? {} : { countries: deps.countries }),
        ...(deps.readSourceGate === undefined ? {} : { readSourceGate: deps.readSourceGate }) })
      const outcome = await run(override ?? {})
      // 失败必须冒泡给作业运行时，否则"没采到"会被记成"跑过了"。
      if (outcome.state === 'failed') throw new Error(`narwhal calendar ${mode} failed: ${outcome.failureCode}`)
    }
    return [
      [narwhalCalendarTickPolicy.handlerId, wrap('tick')],
      [narwhalCalendarSweepPolicy.handlerId, wrap('sweep')]
    ]
  }

  function enabled(): boolean {
    if (!deps.hasCredential()) return false
    const reader = deps.readerEnabled?.()
    // 锁着（undefined）时读者开关不参与；解锁后它说了算。
    return reader === undefined ? true : reader
  }

  /**
   * 启动自检：到期才补跑。判据只看「最近一次**成功**跑到什么时候」，失败不算数
   * （失败与没跑在读者眼里是同一件事：这几天没有数据）。
   */
  function catchUpIfDue(): void {
    if (!enabled()) return
    const now = deps.now()
    const lastSuccess = deps.jobRuntime.listRuns({ definitionId: narwhalCalendarSweepPolicy.definitionId })
      .filter((run) => run.status === 'completed')
      .map((run) => Date.parse(run.completedAt ?? run.startedAt ?? run.createdAt ?? ''))
      .filter((at) => Number.isFinite(at))
      .sort((a, b) => b - a)[0]
    if (lastSuccess !== undefined && now - lastSuccess < narwhalCalendarSweepPolicy.intervalMs) return
    void deps.jobRuntime.enqueueDefinition(maybeDefinition(narwhalCalendarSweepPolicy))
  }

  return Object.freeze({
    /** 幂等：重复调用只注册一次 handler。 */
    initialize(): void {
      if (!registered) {
        for (const [handlerId, handler] of handlers()) deps.jobRuntime.registerHandler(handlerId, handler)
        registered = true
      }
      this.syncSchedule()
      catchUpIfDue()
    },
    syncSchedule(): void {
      for (const definition of definitions) {
        if (!enabled()) { deps.jobRuntime.removeSchedule(definition.id); continue }
        deps.jobRuntime.setSchedule(definition)
      }
    },
    dispose(): void {
      for (const definition of definitions) deps.jobRuntime.removeSchedule(definition.id)
    }
  })
}

function maybeDefinition(policy: typeof narwhalCalendarTickPolicy | typeof narwhalCalendarSweepPolicy): ScheduledJobDefinition {
  return {
    id: policy.definitionId,
    owner: 'product',
    productId: 'market-intelligence',
    handlerId: policy.handlerId,
    title: { 'zh-CN': '市场日历 · Narwhal', 'en-US': 'Market calendar · Narwhal' },
    audience: policy.audience,
    trigger: { kind: 'interval', intervalMs: policy.intervalMs, anchor: 'lastStart' },
    // 必须与注册表里的 sourceId 逐字一致：`macro-calendar-narwhal` 是个不存在的源。
    payload: { sourceId: 'macro-calendar-narwhal-economic-data' },
    concurrencyKey: policy.handlerId,
    timeoutMs: policy.jobTimeoutMs,
    retryPolicy: policy.jobRetryPolicy
  }
}
