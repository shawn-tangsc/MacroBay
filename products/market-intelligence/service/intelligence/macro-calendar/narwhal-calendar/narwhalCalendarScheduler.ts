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
 */
export function createNarwhalCalendarScheduler(deps: Readonly<{
  jobRuntime: Pick<JobRuntime, 'registerHandler' | 'setSchedule' | 'removeSchedule' | 'enqueueDefinition'>
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
      const run = createNarwhalCalendarJobHandler({ ...deps, mode })
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

  return Object.freeze({
    /** 幂等：重复调用只注册一次 handler。 */
    initialize(): void {
      if (!registered) {
        for (const [handlerId, handler] of handlers()) deps.jobRuntime.registerHandler(handlerId, handler)
        registered = true
      }
      this.syncSchedule()
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
