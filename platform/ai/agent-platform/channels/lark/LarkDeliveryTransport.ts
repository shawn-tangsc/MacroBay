import type {
  ChannelDeliveryTransport,
  ChannelDeliveryTransportResult,
  ChannelImageTransport
} from '../ChannelDeliveryContracts'
import { LarkApiClient } from './LarkApiClient'
import { decodeLarkConversation, splitLarkText, type LarkApiFailure } from './LarkContracts'
import { toLarkPlainText } from './larkPlainText'

/**
 * 飞书出站：文本一条 `text`；图片**先上传拿 image_key、再发一条消息**。
 *
 * 图片的两种形态都由 `LarkApiClient.sendImage` 决定，两种都只有**一条**消息：
 * 没有说明 → `msg_type: image`；有说明 → `msg_type: post`（img 段在前、text 段在后）。
 * 这里只做「上传 → 发消息」的串联与失败分流，不重判大小/格式（投递层已判）。
 */
export class LarkDeliveryTransport implements ChannelDeliveryTransport, ChannelImageTransport {
  private readonly clients = new Map<string, LarkApiClient>()
  private readonly lifetimes = new Map<string, { isCurrent: () => boolean; signal: AbortSignal }>()

  setClient(channelId: string, client: LarkApiClient, lifetime: { isCurrent: () => boolean; signal: AbortSignal }): void {
    this.clients.set(channelId, client)
    this.lifetimes.set(channelId, lifetime)
  }
  removeClient(channelId: string): void { this.clients.delete(channelId); this.lifetimes.delete(channelId) }

  async send(input: { channelId: string; providerConversationKey: string; text: string; idempotencyKey: string }): Promise<ChannelDeliveryTransportResult> {
    const client = this.clients.get(input.channelId)
    const lifetime = this.lifetimes.get(input.channelId)
    const conversation = decodeLarkConversation(input.providerConversationKey)
    if (!client || !lifetime || lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
    if (!conversation) return { kind: 'failed', code: 'delivery-provider-rejected' }
    // 飞书文本消息不渲染 markdown：先转纯文本，再按长度切段（转换只此一处）。
    for (const segment of splitLarkText(toLarkPlainText(input.text))) {
      if (lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
      const result = await client.sendText(conversation, segment, lifetime.signal)
      if (lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
      if (!result.ok) return mapApiFailure(result.code)
    }
    return { kind: 'delivered' }
  }

  supportsIdempotency(): boolean { return false }

  /** 与文本同一份运行时所有权：客户端在、代际没被围栏，才谈得上发图。 */
  supportsImage(channelId: string): boolean {
    const client = this.clients.get(channelId)
    const lifetime = this.lifetimes.get(channelId)
    return Boolean(client && lifetime && !lifetime.signal.aborted && lifetime.isCurrent())
  }

  async sendImage(input: {
    channelId: string
    providerConversationKey: string
    image: { mime: string; bytes: Uint8Array }
    caption: string
    idempotencyKey: string
  }): Promise<ChannelDeliveryTransportResult> {
    const client = this.clients.get(input.channelId)
    const lifetime = this.lifetimes.get(input.channelId)
    const conversation = decodeLarkConversation(input.providerConversationKey)
    if (!client || !lifetime || lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
    if (!conversation) return { kind: 'failed', code: 'delivery-provider-rejected' }

    const uploaded = await client.uploadImage({ mime: input.image.mime, bytes: input.image.bytes }, lifetime.signal)
    if (lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
    // 上传没成就不发消息：否则读者会收到一条只有说明、没有图的消息。
    if (!uploaded.ok) return mapApiFailure(uploaded.code)

    const sent = await client.sendImage(
      conversation,
      // caption 走与文本同一个转换：post 的 text 元素不认 markdown，留着星号会让读者看到字面符号。
      { imageKey: uploaded.value.imageKey, caption: toLarkPlainText(input.caption) },
      lifetime.signal
    )
    if (lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
    return sent.ok ? { kind: 'delivered' } : mapApiFailure(sent.code)
  }
}

/** 文本与图片共用的失败分流（一处，不分两套）：限流、上游拒绝、其余按「发出去了但不知道结果」处理。 */
function mapApiFailure(code: LarkApiFailure): ChannelDeliveryTransportResult {
  return code === 'lark-rate-limited'
    ? { kind: 'failed', code: 'delivery-rate-limited' }
    : code === 'lark-provider-rejected'
      ? { kind: 'failed', code: 'delivery-provider-rejected' }
      : { kind: 'unknown-after-send' }
}
