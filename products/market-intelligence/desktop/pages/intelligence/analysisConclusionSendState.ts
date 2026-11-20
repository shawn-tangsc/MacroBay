import type { NotificationSuppressedLevel } from '@platform/notifications/contracts/notificationSubmitContracts'

/**
 * 「发送到频道」的回执判定：**回执 → 读者要看的那一种情况**。
 *
 * 一句话：**提交成功不等于手机收到**。多通道是合法配置（一条消息发到所有已启用通道），
 * 所以读者要看到的是**计数**而不是一个「成功」：
 * - 每条通道都 `sent-accepted` → 「{n} 条通道都收到了」；
 * - 有收到有没到 → 「{ok} 条通道收到，{failed} 条没到」；
 * - 一条都没到 → 「没有任何通道收到（共 {n} 条）」；
 * - 有 `sent-unconfirmed`（发出去了、没拿到回执）→ 中性占位，既不说收到也不说没到；
 * - 手机档**缺席**（或平台报「被压下」）→ 「只在应用内」。
 *
 * 三个来源各管一件事，不许互相代替：
 * - **这一次到没到**：逐通道 `channels[]` 是计数与逐条说明的唯一来源；没有它的老记录按聚合档单条读；
 * - **通道有几条**：只从回执里数，不从点击前那份派生反推；
 * - **提交本身过没过**：`kind` 与拒绝码。
 *
 * 这里**不认识平台契约类型**：入参是本模块自己的中性形状，接口长什么样由**一个函数边界**翻一次。
 * 文案也不在这里：说法在 `analysisConclusionSendText` 那张表里，口径改了只改表。
 */

/** 平台记录上手机投递那一档，状态名原样照抄（`queued`/`sent-accepted`/`sent-unconfirmed`/`failed`）。 */
export type PushChannelReading = Readonly<{
  /** 读者在通道页看到的那个名字；平台没给就不编一个品牌名。 */
  channelName?: string
  state: 'queued' | 'sent-accepted' | 'sent-unconfirmed' | 'failed'
  /** 平台给的原因码：界面翻成人话，**码不上屏**。 */
  reason?: string
}>

export type PushDeliveryReading = Readonly<{
  /** 聚合档：有一条没送到就不许是 `sent-accepted`（平台侧同一条硬判据）。 */
  state: 'queued' | 'sent-accepted' | 'sent-unconfirmed' | 'failed'
  reason?: string
  /**
   * 逐通道结果（多通道方案）：**读者看到的总括数字只从这些行数出来**，不从聚合档反推。
   * 老记录没有它——那时确实只有一条通道，按聚合档单条渲染，不回填、不报错。
   */
  channels?: readonly PushChannelReading[]
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

/**
 * 读者面前只有这几种情况；`sending` 是过程，不在这支里。
 *
 * 前三档是**计数**（多通道方案定稿）：读者要看到的是「几条收到、几条没到」，不是一句
 * 「发送成功」——一条消息发到所有已启用通道之后，成败本来就不是一个布尔值。
 */
export type SendOutcomeState =
  /** 每条通道都受理了。 */
  | Readonly<{ state: 'delivered'; total: number }>
  /** 有收到、也有没到；两边都是**已经确定**的（没有「未确认」混在里面）。 */
  | Readonly<{ state: 'partial'; received: number; total: number }>
  /** 一条都没收到（全部确定没到）。 */
  | Readonly<{ state: 'none-received'; total: number }>
  /**
   * 有通道「发出去但没收到回执」：既不能说收到（假成功），也不能说没到（假失败）。
   * 这一档的说法产品还在定，界面先用中性占位句；逐条真相在 ⓘ 里。
   */
  | Readonly<{ state: 'unconfirmed' }>
  /** 记录在、应用内有，手机那一档没排上且没给原因。 */
  | Readonly<{ state: 'app-only' }>
  | Readonly<{ state: 'suppressed'; reason: SuppressionReason }>
  /** 平台报了一个这台设备不认识的压下原因：如实说没认出来，别猜成没发也别猜成已发。 */
  | Readonly<{ state: 'suppressed-unknown'; reason: string }>
  /** 平台每日上限：提交就被拒，不是某一档被压下——读者要做的是等明天。 */
  | Readonly<{ state: 'daily-limit' }>
  /** 一条可用通道都没有（多条是合法配置，这里只指 0 条）。 */
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
  return classifyPushReading(push)
}

/**
 * 手机那一档 → 读者面前的计数。
 *
 * 三条计数规矩（一条消息发到所有已启用通道）：
 * - **收到**只认 `sent-accepted`；
 * - **没到**认 `failed` 与 `queued`（`queued` 是退避跳过，这一次请求根本没发出去）；
 * - `sent-unconfirmed` **既不算收到也不算没到**：只要有一条处在这一档，总括句就走中性占位，
 *   绝不把它并进任何一边——ⓘ 里逐条照实说。
 */
function classifyPushReading(push: PushDeliveryReading): SendOutcomeState {
  const channels = push.channels !== undefined && push.channels.length > 0 ? push.channels : undefined
  if (channels === undefined) {
    // 老记录：只有聚合档，那时确实只有一条通道。
    if (push.reason === 'push-unavailable') return { state: 'push-unavailable' }
    if (push.state === 'sent-accepted') return { state: 'delivered', total: 1 }
    if (push.state === 'sent-unconfirmed') return { state: 'unconfirmed' }
    return { state: 'none-received', total: 1 }
  }
  const total = channels.length
  if (channels.some(channel => channel.state === 'sent-unconfirmed')) return { state: 'unconfirmed' }
  const received = channels.filter(channel => channel.state === 'sent-accepted').length
  if (received === total) return { state: 'delivered', total }
  if (received === 0) return { state: 'none-received', total }
  return { state: 'partial', received, total }
}
