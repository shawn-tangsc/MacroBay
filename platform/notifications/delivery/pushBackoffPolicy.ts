/**
 * 通道推送的熔断策略（通道方案 §3）：**纯函数**，不读文件、不碰通道服务、不碰时钟实现。
 *
 * N=3 / 30 分钟只写在这一处：任何地方再写一遍这两个数字，产品改数时就会两处不同步，
 * 而「暂停了却还在发」与「没暂停却已停发」都不会自己暴露。
 *
 * 写入点归 runtime（`delivery.push` 与 `pushBackoff` 都在同一份通知 JSON 里，由 runtime 落盘）；
 * 这里只回答三件事：
 *   1. 窗口内该不该跳过这一次投递；
 *   2. 一次结果之后，计数与暂停到什么时候；
 *   3. 这次结果是否**跨过**了暂停/解除的边界——供发 P6a/P6b 用，免得写入点再判一遍。
 */
import type { NotificationPushBackoff } from '../contracts/notificationContracts'

/** 连续失败到这个次数就进入退避。 */
export const PUSH_BACKOFF_FAILURES = 3
/** 退避窗口长度。 */
export const PUSH_BACKOFF_WINDOW_MS = 30 * 60 * 1000

/**
 * 端口能给回的三种结果。
 *
 * `unknown-after-send` 既不是成功也不是失败：我们已经发出去了，只是没拿到确认。
 * 把它算成失败会在一次断网后把一条正常通道推进暂停；算成成功会抹掉已有的失败计数。
 * 所以它**不计数、也不清零**（契约 §8，Chief 2026-11-02 定）。
 */
export type PushDeliveryOutcome = 'sent-accepted' | 'unknown-after-send' | 'failed'

export type PushBackoffTransition = 'suspended' | 'resumed'

export type PushBackoffDecision = {
  failures: number
  pausedUntil: string | null
  /** 这次结果跨过的边界；同一次失败把窗口往后推不算第二次「暂停」。 */
  transition: PushBackoffTransition | null
  /**
   * 这次结果是否**改动了**该通道的熔断状态。
   * 为 false 时写入口不要落库：`unknown-after-send` 原样返回，写一条 `{failures:0,pausedUntil:null}`
   * 会给一个从没失败过的通道凭空造出一行状态，也让「没有熔断记录」这件事无法表达。
   */
  changed: boolean
}

function parseInstant(value: string | null | undefined): number | null {
  if (value == null) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * 窗口内为真：这一次不该调用端口。
 *
 * 坏时间戳按「没暂停」处理——一个读不出来的 `pausedUntil` 如果被当成「还在暂停」，
 * 读者的推送会永远停着，而且界面上说不出恢复时间。
 */
export function shouldSkipPush(current: NotificationPushBackoff | undefined, now: string): boolean {
  const pausedUntil = parseInstant(current?.pausedUntil)
  const at = parseInstant(now)
  if (pausedUntil === null || at === null) return false
  return pausedUntil > at
}

/**
 * 记一次结果，返回新的计数、新的暂停截止时间、这次是否跨过边界，以及**要不要落库**。
 *
 * - 成功：清零并解除（此前确实暂停过才算一次 `resumed`）；原本没有记录时 `changed` 为 false；
 * - `unknown-after-send`：原样返回，`transition` 为 null，`changed` 为 false；
 * - 失败：计数 +1，达到 3 次就暂停 30 分钟；窗口值变了才算一次 `suspended`。
 */
export function recordPushOutcome(
  current: NotificationPushBackoff | undefined,
  outcome: PushDeliveryOutcome,
  now: string
): PushBackoffDecision {
  const failures = current?.failures ?? 0
  const pausedUntil = current?.pausedUntil ?? null

  if (outcome === 'sent-accepted') {
    return {
      failures: 0,
      pausedUntil: null,
      transition: pausedUntil === null ? null : 'resumed',
      changed: current !== undefined && (failures !== 0 || pausedUntil !== null)
    }
  }
  if (outcome === 'unknown-after-send') {
    return { failures, pausedUntil, transition: null, changed: false }
  }

  const nextFailures = failures + 1
  const at = parseInstant(now)
  const nextPausedUntil = nextFailures >= PUSH_BACKOFF_FAILURES && at !== null
    ? new Date(at + PUSH_BACKOFF_WINDOW_MS).toISOString()
    : pausedUntil
  return {
    failures: nextFailures,
    pausedUntil: nextPausedUntil,
    transition: nextPausedUntil !== null && nextPausedUntil !== pausedUntil ? 'suspended' : null,
    changed: true
  }
}
