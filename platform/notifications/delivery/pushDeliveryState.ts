import type { NotificationDeliveryState } from '../contracts/notificationContracts'

/** 通道层的一次结果（`ok` + 原因码 + 可选的通道回执号）。 */
export type PushAttemptResult = Readonly<{ ok: boolean; reason?: string; messageId?: string }>

/**
 * **唯一**的「一次推送结果 → 记录上的投递状态」映射（2026-11-08）。
 *
 * 四档沿用记录现有的词，不新造：`queued / sent-accepted / sent-unconfirmed / failed`。
 *
 * 以前两处各写一份，同一件事两种说法：新提交路径把「已经发出去了、但没拿到回执」
 * （`unknown-after-send`）写成 `failed`，手动重投则按 `messageId` 写成 `sent-unconfirmed`。
 * 同一件事一个口径才说得清「没到」和「拿不到」——把「拿不到」说成「没有」是红线。
 */
export function pushDeliveryState(
  result: PushAttemptResult
): Readonly<Pick<NotificationDeliveryState, 'state' | 'reason'>> {
  if (result.ok) {
    // 通道受理了但没有回执号：`sent-unconfirmed`（受理 ≠ 拿到回执）。
    return result.messageId === undefined ? { state: 'sent-unconfirmed' } : { state: 'sent-accepted' }
  }
  // 已经发出去了、只是没拿到确认：这是「不知道」，不是「没到」。
  if (result.reason === 'unknown-after-send') return { state: 'sent-unconfirmed', reason: result.reason }
  return { state: 'failed', reason: result.reason ?? 'channel-rejected' }
}
