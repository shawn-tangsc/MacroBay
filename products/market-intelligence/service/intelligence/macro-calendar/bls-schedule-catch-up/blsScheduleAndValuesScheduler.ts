import type { JobRuntime, ScheduledJobDefinition } from '@platform/jobs'
import type { BlsScheduleAndValuesSyncWorkflow } from './blsScheduleAndLatestValuesSyncWorkflow'

/**
 * Automatic refresh policy for the BLS official release values.
 *
 * The catch-up workflow already selects only schedule groups whose release date
 * has passed, so a tick that finds nothing new reports `not-required` and spends
 * no value request. This policy owns the cadence, the year derivation and the
 * job envelope; it deliberately does not add historical backfill or a persisted
 * backlog.
 */
export const blsScheduleAndValuesSchedulerPolicy = Object.freeze({
  definitionId: 'market-intelligence.syncBlsScheduleAndValues.automatic',
  handlerId: 'market-intelligence.syncBlsScheduleAndValues',
  title: 'Sync BLS schedule and latest values',
  audience: 'user' as const,
  /** BLS releases are monthly; six hours keeps a released value visible the same day. */
  intervalMs: 6 * 60 * 60 * 1_000,
  /** One tick syncs the schedule and at most two value requests. */
  jobTimeoutMs: 3 * 60 * 1_000,
  jobRetryPolicy: { maxAttempts: 1, backoff: 'none' as const, baseDelayMs: 0, maxDelayMs: 0 }
})

export type BlsScheduleAndValuesScheduler = Readonly<{ initialize: () => void; dispose: () => void }>

/**
 * BLS 官方日历的同步作业（**自动排期已于 2026-11-08 停止**，见 `initialize` 与
 * `blsOfficialCalendarAvailability.ts`）。
 *
 * 保留这个工厂而不是删掉，是为了让「恢复」只改一处判定 + 两行排期：工作流、年份推导与作业
 * 信封都还在原处；停掉的只有排期本身。停止后 `listSchedules()` 里不会再有这个 definition，
 * 设置页因此显示「未安排」，而不是从开关反推出一个假的「已注册」。
 */
export function createBlsScheduleAndValuesScheduler(deps: Readonly<{
  jobRuntime: Pick<JobRuntime, 'registerHandler' | 'setSchedule' | 'removeSchedule' | 'enqueueDefinition'>
  workflow: Pick<BlsScheduleAndValuesSyncWorkflow, 'sync'>
  /** The same enabled gate the other calendar jobs use: a disabled source does nothing. */
  readEnabled: () => boolean | Promise<boolean>
  now: () => Date
}>): BlsScheduleAndValuesScheduler {
  const policy = blsScheduleAndValuesSchedulerPolicy
  let disposed = false

  function automaticDefinition(): ScheduledJobDefinition {
    return {
      id: policy.definitionId,
      owner: 'product',
      productId: 'market-intelligence',
      handlerId: policy.handlerId,
      title: policy.title,
      audience: 'user' as const,
      trigger: { kind: 'interval', intervalMs: policy.intervalMs, anchor: 'lastStart' },
      payload: {},
      concurrencyKey: policy.handlerId,
      timeoutMs: policy.jobTimeoutMs,
      retryPolicy: policy.jobRetryPolicy
    }
  }

  /**
   * **自动同步已停止**（用户 2026-11-08 决定）。
   *
   * 停的原因写在 `blsOfficialCalendarAvailability.ts`：BLS 两个端点在当前网络被 CDN 边缘
   * 直接 403，直连与代理都一样，不是作业本身坏了。这一天 8 次自动运行全部失败、官方修订表
   * 最后一次写入停在 2026-10-22——再排期只会每 6 小时重演一次，并在作业列表里继续留失败记录。
   *
   * 因此这里**不再** `registerHandler` / `setSchedule` / `enqueueDefinition`，也不靠
   * `readEnabled` 早退来「假装停掉」（那样仍会每 6 小时跑一次）。这里只做一件事：把旧版本
   * 可能已经落盘的排期删掉——不删的话它照旧会触发。
   *
   * 恢复（BLS 通了的判定见同一个常量文件）：把 `state` 改成 `'available'`，再把注册 handler
   * 与 `setSchedule` 两行放回来即可；`deps.workflow` / `readEnabled` / `now` 保留在此就是为这一步。
   */
  function initialize(): void {
    if (disposed) return
    deps.jobRuntime.removeSchedule(policy.definitionId)
  }

  function dispose(): void {
    disposed = true
    deps.jobRuntime.removeSchedule(policy.definitionId)
  }

  return Object.freeze({ initialize, dispose })
}
