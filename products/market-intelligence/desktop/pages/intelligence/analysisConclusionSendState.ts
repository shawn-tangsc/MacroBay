import type { NotificationSuppressedLevel } from '@platform/notifications/contracts/notificationSubmitContracts'

/**
 * 「发送到频道」的回执判定：**回执 → 读者要看的那一种情况**。
 *
 * 一句话：**提交成功不等于手机收到**。四种说法各有各的证据，不许互相顶替：
 * - `sent-accepted` → 「已发到 {通道名}」；
 * - `sent-unconfirmed` → 「已交给 {通道名}，没拿到回执」；
 * - `failed` → 「没发到手机」（原因进折叠区）；
 * - 手机档**缺席**（或平台报「被压下」）→ 「只在应用内」。
 *
 * 三个来源各管一件事，不许互相代替：
 * - **这一次发没发出去**：`push` 那一档 + `suppressed` 的压下原因（都来自记录/回执）；
 * - **通道有几条、叫什么**：`resolvePushChannel` 那一份派生；
 * - **提交本身过没过**：`kind` 与拒绝码。
 *
 * 这里**不认识平台契约类型**：入参是本模块自己的中性形状，接口长什么样由**一个函数边界**翻一次
 * （架构师还在裁「回执扩字段」还是「读记录」；两种实现只换那一个函数，界面与这张表不动）。
 * 文案也不在这里：说法在 `analysisConclusionSendText` 那张表里，口径改了只改表。
 */

/** 平台记录上手机投递那一档，状态名原样照抄（`queued`/`sent-accepted`/`sent-unconfirmed`/`failed`）。 */
export type PushDeliveryReading = Readonly<{
  state: 'queued' | 'sent-accepted' | 'sent-unconfirmed' | 'failed'
  reason?: string
  /** 这次真的发到了哪条通道——**通道名跟着这次提交走**，不从通道列表读。 */
  channelName?: string
}>

/**
 * 被压下的原因。**值域直接取契约**（`NotificationSuppressedLevel['reason']`），不在这里另抄一份：
 * 平台多一个码，这张表跟着多一条；平台少一个码，多余的人话也不会留下。
 */
export type SuppressionReason = NotificationSuppressedLevel['reason']

export type DeliveryReading = Readonly<{
  /** 手机那一档；**缺席**＝没排上（免打扰摘掉的就是这种）。 */
  push?: PushDeliveryReading | undefined
    /**
   * 平台报的压下原因；有它时优先于「缺席」的默认解释。
   * `reason` 收成 `string`：认不出的码也要**如实说「没认出来」**，不许当成「没发」或「已发」。
   */
  suppressed?: readonly Readonly<{ level: string; reason: string }>[] | undefined
}>

/** 一次提交的回执，按判定需要的最小形状。 */
export type SendReceiptView =
  | Readonly<{ kind: 'accepted'; delivery?: DeliveryReading | undefined }>
  | Readonly<{ kind: 'rejected'; reason: string }>

/** 读者面前只有这几种情况；`sending` 是过程，不在这支里。 */
/**
 * 认得的压下原因：**键就是契约的值域**（少一个多一个都编不过），所以人话表也跟着穷尽。
 * 认不出的码在运行时走 `suppressed-unknown`，说「没认出来」，不猜成没发也不猜成已发。
 */
const SUPPRESSED_REASONS: Readonly<Record<SuppressionReason, true>> = {
  'quiet-hours': true,
  'toast-disabled': true,
  'popup-disabled': true,
  'desktop-disabled': true
}

function isKnownSuppression(reason: string): reason is SuppressionReason {
  return Object.hasOwn(SUPPRESSED_REASONS, reason)
}

export type SendOutcomeState =
  | Readonly<{ state: 'sent' }>
  | Readonly<{ state: 'handed' }>
  | Readonly<{ state: 'not-sent'; reason?: string }>
  /** 记录在、应用内有，手机那一档没排上且没给原因。 */
  | Readonly<{ state: 'app-only' }>
  | Readonly<{ state: 'suppressed'; reason: SuppressionReason }>
  /** 平台报了一个这台设备不认识的压下原因：如实说没认出来，别猜成没发也别猜成已发。 */
  | Readonly<{ state: 'suppressed-unknown'; reason: string }>
  /** 平台每日上限：提交就被拒，不是某一档被压下——读者要做的是等明天。 */
  | Readonly<{ state: 'daily-limit' }>
  /** 通道不通（0 条或多条）。条数不在这里判，那是 `resolvePushChannel` 的事。 */
  | Readonly<{ state: 'push-unavailable' }>
  /** 提交层面的其他拒绝，以及请求根本没到（IPC 抛错）。 */
  | Readonly<{ state: 'failed'; reason: string }>

export function classifySendReceipt(receipt: SendReceiptView): SendOutcomeState {
  if (receipt.kind === 'rejected') {
    // 上限是提交被拒（`rejected`），不是某一档被压下：读者下一步是等明天，不是查通道。
    return receipt.reason === 'daily-limit-reached' ? { state: 'daily-limit' } : { state: 'failed', reason: receipt.reason }
  }
  const delivery = receipt.delivery
  const suppressed = delivery?.suppressed?.find(entry => entry.level === 'channel' || entry.level === 'push')
  if (suppressed !== undefined) {
    return isKnownSuppression(suppressed.reason)
      ? { state: 'suppressed', reason: suppressed.reason }
      : { state: 'suppressed-unknown', reason: suppressed.reason }
  }
  const push = delivery?.push
  // 缺席不是失败：记录与中心都在，只是手机那一档没排上。
  if (push === undefined) return { state: 'app-only' }
  if (push.state === 'sent-accepted') return { state: 'sent' }
  if (push.state === 'sent-unconfirmed') return { state: 'handed' }
  if (push.reason === 'push-unavailable') return { state: 'push-unavailable' }
  // `queued` 是「还没发出」：不许说成已发，也不许说成没发——它就是还没到那一步。
  if (push.state === 'queued') return { state: 'app-only' }
  return push.reason === undefined ? { state: 'not-sent' } : { state: 'not-sent', reason: push.reason }
}
