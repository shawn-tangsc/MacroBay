import type { ChannelExecutionClaim } from './ChannelInboundContracts'
import type { ChannelConversationKind } from './channelContracts'

/**
 * 一条出站消息从哪来。`notification` 是通知推送（通道方案 §2.2）：幂等键是通知记录 id，
 * 与任务的 `task-result` 分开记账——两边的失败语义与重试策略都不一样。
 */
export type ChannelDeliverySource = 'inbound-reply' | 'task-result' | 'agent-notify' | 'notification'
/**
 * Where one delivered message stands. NOT `TaskResultOutcome` (completed/failed/cancelled), which is
 * what happened to the task run and goes into `source_id`. The two never convert into each other;
 * they only meet as separate counts on the delivery-health panel.
 *
 * `sending` is an internal durable lease. Only its matching owner can record a result.
 */
export type ChannelDeliveryStatus = 'pending' | 'sending' | 'delivered' | 'failed' | 'unknown-after-send' | 'skipped'

/**
 * Why a delivery was skipped. A closed set on purpose: a skipped row without a reason tells the
 * user "it was skipped, do not ask" — and each reason needs a different next action.
 */
export type ChannelDeliverySkipReason =
  // Two different user actions: bind a channel, or enable the bound one.
  | 'delivery-no-target-bound'
  | 'delivery-target-disabled'
  | 'delivery-empty-output'
  | 'delivery-not-authorized'
  | 'delivery-retry-not-permitted'
  | 'delivery-owner-invalid'

/**
 * Runtime list of the closed reason set. The UI needs it to tell a reason it can explain from a
 * code it has never heard of, so the union above and this list must not drift.
 */
export const channelDeliverySkipReasons = [
  'delivery-no-target-bound',
  'delivery-target-disabled',
  'delivery-empty-output',
  'delivery-not-authorized',
  'delivery-retry-not-permitted',
  'delivery-owner-invalid'
] as const satisfies readonly ChannelDeliverySkipReason[]

export function isChannelDeliverySkipReason(value: string | null | undefined): value is ChannelDeliverySkipReason {
  return value != null && (channelDeliverySkipReasons as readonly string[]).includes(value)
}

export type ChannelDeliveryTransportResult =
  /**
   * `detail` 是**送到之后的上游凭据**（例如 Telegram 的 `message_id`），只作证据、不参与判定：
   * 没有它，「发到了」与「发到了别处」在库里长得一模一样（2026-11-10 的用户现场）。
   */
  | { kind: 'delivered'; detail?: string }
  /** `detail` 是通道自己给的一句话（已脱敏截断），只用于日志排查，不参与判定。 */
  | {
    kind: 'failed'
    code: ChannelDeliveryFailureCode
    detail?: string
    /**
     * 上游自己说的「等多少毫秒再试」（`delivery-rate-limited` 才有，抓不到就没有）。
     *
     * 只作**调用点内联重发一次**的依据：上游说等多久就等多久，绝不自己编一个退避数字
     * ——编出来的数字在上游还限流时会立刻换来第二次 429，然后被误记成「通道坏了」。
     */
    retryAfterMs?: number
  }
  | { kind: 'unknown-after-send'; detail?: string }

export type ChannelDeliveryFailureCode =
  | 'delivery-host-unavailable'
  | 'delivery-permission-denied'
  | 'delivery-rate-limited'
  | 'delivery-provider-rejected'
  /** 会话键里补不出平台认的目标（例如 Telegram 的 chat id）：这是目标解析问题，不是网络。 */
  | 'delivery-target-invalid'
  /** 图片超出通道上限：**发之前**就判出来，一次网络请求都不发。 */
  | 'delivery-image-too-large'
  /** 这个通道（或这一版）发不了这张图：没有图片能力、格式不认（按字节签名判）、或说明文字超长。 */
  | 'delivery-image-unsupported'
  /** 图取不到：detail 分 `missing`（文件不在了）与 `read-failed`（在但读不出来）——「没有」与「拿不到」分开。 */
  | 'delivery-image-unavailable'
  /** 这张图不许对外发：来源不是「这条助手消息自己带着它」（编辑原图走同一条投递口时会被拒）。 */
  | 'delivery-image-source-not-allowed'
  /** caption 超过通道上限：整条不发（不许截断后假装发全，也不许运行期自动拆成两条）。 */
  | 'delivery-caption-too-long'

export type ChannelDeliveryTransport = {
  send: (input: {
    channelId: string
    providerConversationKey: string
    text: string
    idempotencyKey: string
  }) => Promise<ChannelDeliveryTransportResult>
  typing?: (input: { channelId: string; providerConversationKey: string }) => Promise<void>
  supportsIdempotency: (channelId: string) => boolean
}

export type ChannelDeliveryRequest = {
  channelId: string
  agentId: string
  conversationId: string
  source: ChannelDeliverySource
  sourceId: string
  text: string
  executionClaim?: ChannelExecutionClaim
  retryUnknown?: boolean
}

export type ChannelDeliveryResult = {
  status: ChannelDeliveryStatus
  attemptId: string | null
  errorCode: string | null
  /** 上游给的「等多久再试」；只有 `delivery-rate-limited` 可能带，调用点据此内联重发一次。 */
  retryAfterMs?: number
}

export type ChannelDeliveryAttemptView = {
  id: string
  channelId: string
  agentId: string
  conversationId: string
  source: ChannelDeliverySource
  status: ChannelDeliveryStatus
  errorCode: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type ChannelDeliveryAuditView = {
  id: string
  channelId: string
  attemptId: string | null
  code: string
  createdAt: string
}

/**
 * 出站图片的输入（P2：仅应用生成的图；哪几个平台能发由适配器有没有实现 `sendImage` 决定）。
 *
 * `image.mime` 是**嗅探结果**，不是存储声明的那个：声明 png、实际 webp 的图存在，
 * 判定只看字节签名（见 `channelImageDelivery.sniffImageMime`）。
 */
export type ChannelImageDeliveryRequest = {
  channelId: string
  agentId: string
  conversationId: string
  source: ChannelDeliverySource
  sourceId: string
  image: { mime: string; bytes: Uint8Array }
  caption: string
  retryUnknown?: boolean
}

/** 通道的图片能力：`supportsImage` 为假时投递层直接判 `delivery-image-unsupported`，一次网络都不发。 */
export type ChannelImageTransport = {
  supportsImage: (channelId: string) => boolean
  /**
   * 可选：按**这条通道绑定的会话种类**再收窄一次能力。
   *
   * 为什么需要：`supportsImage(channelId)` 只看通道与连接，看不到目标会话是什么。QQ 的频道（guild）
   * 没有素材上传接口——对一条通道是「能发图」，对一条**绑到频道会话**的通道却「不能」。
   * 没有这一档，能力会画出一个必然失败的按钮，并把「按设计走文字」变成一次失败尝试。
   *
   * 不实现 = 所有会话种类都支持（其余适配器的行为一字不变）。拿不到目标会话时也不收窄：
   * 判不出来就不改变现状。
   */
  supportsImageForConversationKind?: (kind: ChannelConversationKind) => boolean
  sendImage: (input: {
    channelId: string
    providerConversationKey: string
    image: { mime: string; bytes: Uint8Array }
    caption: string
    idempotencyKey: string
  }) => Promise<ChannelDeliveryTransportResult>
}

/**
 * 图片投递的 `sourceId`：**固定后缀**，只由「产物种类」决定。
 *
 * 文字用 `<recordId>`（现状不动），图片用 `<recordId>:image`。`claim` 的去重键是
 * `(channel, conversation, source, sha256(sourceId))`：两者共用一个 id 时，第二次 claim 会命中
 * 第一次那条已送达的记录、直接返回成功，而图根本没发出去。
 */
export function channelImageSourceId(recordId: string): string {
  return `${recordId}:image`
}

/**
 * 「只发图片」用的第三个固定键：`<recordId>:image:bare`。
 *
 * 与「图片带说明」**不是同一条尝试**：caption 超长导致整条失败时，那条 failed 行原样留在审计里；
 * 「只发图片」是一次新的、可独立回退的投递，点第二次返回同一个终态、不重发。
 */
/**
 * 日报海报（图 + 导读一条消息）的 `sourceId` 后缀（海报方案 §5）。
 * 与图片的 `:image` 是**不同产物形态**，所以另用一个后缀；同样不加通道维度（通道在唯一键第一列）。
 */
export function channelPosterSourceId(recordId: string): string {
  return `${recordId}:poster`
}

/** 不支持图片的通道收纯导读文字：同一动作、**另一条产物形态**，所以另用一个后缀。 */
export function channelPosterTextSourceId(recordId: string): string {
  return `${recordId}:poster-text`
}

export function channelImageBareSourceId(recordId: string): string {
  return `${recordId}:image:bare`
}

/**
 * 简报海报**随推送**发出的 `sourceId`：`<recordId>:image:<contentHash>`（方案 §12.4）。
 *
 * **必须带内容版本**，否则同一把键会被两版海报共用：重生成后要么命中旧那条终态、海报永远发不出去，
 * 要么被当成同一条尝试。带 hash 之后，同一张图重投仍是同一个键（幂等），换了一张图就是新键。
 * 聊天里那张生成图不带版本（它不会重生成），所以那两个键不合并。
 */
export function channelPosterPushSourceId(recordId: string, contentHash: string): string {
  return `${recordId}:image:${contentHash}`
}
