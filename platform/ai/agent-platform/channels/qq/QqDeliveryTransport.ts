import { createHash } from 'node:crypto'

import type {
  ChannelDeliveryTransport,
  ChannelDeliveryTransportResult,
  ChannelImageTransport
} from '../ChannelDeliveryContracts'
import type { ChannelConversationKind } from '../channelContracts'
import { QqApiClient } from './QqApiClient'
import { decodeQqConversation, splitQqText } from './QqContracts'

/**
 * QQ 图片出站的能力开关（与飞书同一个做法）：实现已落，但**没有真机验过一次就不开门**。
 * 关着的时候 router 判 `delivery-image-unsupported`，聊天卡片也不会画「发到频道」。
 */
const QQ_IMAGE_EGRESS_ENABLED = false

/** 素材复用键：内容 hash（同一张图第二次发走缓存，不重复上传——100 张配额是硬上限）。 */
type MediaCacheEntry = { url: string; expiresAt: number }

export class QqDeliveryTransport implements ChannelDeliveryTransport, ChannelImageTransport {
  private readonly clients = new Map<string, QqApiClient>()
  private readonly lifetimes = new Map<string, { isCurrent: () => boolean; signal: AbortSignal }>()
  /** 素材复用：内容 hash → `qqbot-media://` 引用。**不按版本/文件名**，只按内容。 */
  private readonly media = new Map<string, MediaCacheEntry>()
  setClient(channelId: string, client: QqApiClient, lifetime: { isCurrent: () => boolean; signal: AbortSignal }): void { this.clients.set(channelId, client); this.lifetimes.set(channelId, lifetime) }
  removeClient(channelId: string): void { this.clients.delete(channelId); this.lifetimes.delete(channelId) }
  async send(input: { channelId: string; providerConversationKey: string; text: string; idempotencyKey: string }): Promise<ChannelDeliveryTransportResult> {
    const client = this.clients.get(input.channelId); const lifetime = this.lifetimes.get(input.channelId); const conversation = decodeQqConversation(input.providerConversationKey)
    if (!client || !lifetime || lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
    if (!conversation) return { kind: 'failed', code: 'delivery-provider-rejected' }
    for (const part of splitQqText(input.text)) {
      if (lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
      const result = await client.sendText(conversation, part, lifetime.signal)
      if (result === 'rate-limited') return { kind: 'failed', code: 'delivery-rate-limited' }
      if (result === 'rejected') return { kind: 'failed', code: 'delivery-provider-rejected' }
      if (result === 'unknown') return { kind: 'unknown-after-send' }
    }
    return { kind: 'delivered' }
  }
  supportsIdempotency(): boolean { return false }

  /**
   * 能不能在**一条消息**里同时承载图与说明。频道（guild）没有素材上传接口，声明不支持——
   * 不许假装能发，也不许拆成两步偷偷发。
   */
  supportsImage(channelId: string): boolean {
    if (!QQ_IMAGE_EGRESS_ENABLED) return false
    const client = this.clients.get(channelId)
    const lifetime = this.lifetimes.get(channelId)
    return Boolean(client && lifetime && !lifetime.signal.aborted && lifetime.isCurrent())
  }

  /**
   * 再按**目标会话种类**收窄：单聊、群聊能发图，频道（guild）不能。
   *
   * 为什么需要这一档：`supportsImage(channelId)` 看不到目标会话，于是一条**绑到频道**的 QQ 通道
   * 会被判成「能发图」——界面画出按钮、点了报 `delivery-image-unsupported`，而它本该直接走文字。
   * 有了这一档，海报/图片投影就知道给这条通道发纯文字，界面也不画那个按钮。
   */
  supportsImageForConversationKind(kind: ChannelConversationKind): boolean {
    return kind !== 'channel'
  }

  /**
   * 图 + 说明：**一条** Markdown 消息（`msg_type: 2`），素材引用是 `qqbot-media://`。
   *
   * 三步上传（申请 → PUT → 完成）只在缓存没命中时发生；缓存键是内容 hash，命中时一次上传都不发，
   * 只发那一条消息。缓存条目带素材自己的 TTL（默认 90 天滑动过期），过期就当没有、重新上传。
   */
  async sendImage(input: {
    channelId: string
    providerConversationKey: string
    image: { mime: string; bytes: Uint8Array }
    caption: string
    idempotencyKey: string
  }): Promise<ChannelDeliveryTransportResult> {
    const client = this.clients.get(input.channelId)
    const lifetime = this.lifetimes.get(input.channelId)
    if (!client || !lifetime || lifetime.signal.aborted || !lifetime.isCurrent()) {
      return { kind: 'failed', code: 'delivery-host-unavailable' }
    }
    const conversation = decodeQqConversation(input.providerConversationKey)
    if (!conversation) return { kind: 'failed', code: 'delivery-provider-rejected' }
    // 频道没有素材上传接口：这类通道声明不支持图片，走文字降级（不在这里偷偷拆成两条）。
    if (conversation.kind === 'channel') return { kind: 'failed', code: 'delivery-image-unsupported' }

    const hash = createHash('sha256').update(input.image.bytes).digest('hex')
    let media = this.media.get(hash)
    if (media !== undefined && media.expiresAt <= Date.now()) {
      this.media.delete(hash)
      media = undefined
    }
    if (media === undefined) {
      const uploaded = await client.uploadMarkdownImage({ bytes: input.image.bytes, mime: input.image.mime, signal: lifetime.signal })
      if (lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
      if (!uploaded.ok) return mapOutcome(uploaded.outcome)
      // `ttl = 0` = 可长期使用：给一个远未来，别把长期素材当成已过期。
      const expiresAt = uploaded.ttlSeconds > 0 ? Date.now() + uploaded.ttlSeconds * 1_000 : Number.POSITIVE_INFINITY
      media = { url: uploaded.url, expiresAt }
      this.media.set(hash, media)
    }

    // 图在上、说明在下（与其余几家一致）；说明为空时只发图，仍是**一条**消息。
    const markdown = input.caption.trim().length > 0 ? `![](${media.url})\n\n${input.caption}` : `![](${media.url})`
    const sent = await client.sendMarkdown(conversation, markdown, lifetime.signal)
    if (lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
    return sent === 'delivered' ? { kind: 'delivered' } : mapOutcome(sent)
  }
}

/** 与文本那条同一处分流：限流 / 上游拒绝 / 其余「发出去了但不知道结果」。 */
function mapOutcome(outcome: 'rejected' | 'rate-limited' | 'unknown'): ChannelDeliveryTransportResult {
  return outcome === 'rate-limited'
    ? { kind: 'failed', code: 'delivery-rate-limited' }
    : outcome === 'rejected'
      ? { kind: 'failed', code: 'delivery-provider-rejected' }
      : { kind: 'unknown-after-send' }
}
