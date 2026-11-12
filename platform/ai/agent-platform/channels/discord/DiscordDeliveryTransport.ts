import type {
  ChannelDeliveryTransport,
  ChannelDeliveryTransportResult,
  ChannelImageTransport
} from '../ChannelDeliveryContracts'
import { DiscordApiClient, type DiscordSendOutcome } from './DiscordApiClient'
import { decodeDiscordConversation, splitDiscordText } from './DiscordContracts'

/**
 * Discord 出站：文本与图片走**同一个消息接口**，图片也不是两步（先传后发）——
 * 一次 multipart 请求，`payload_json` 带 caption 与附件 id、`files[0]` 带字节。
 *
 * 三件不在这里做的事：大小/格式不重判（投递层已判）、错误码不新开（与文本共用 `mapSendOutcome`）、
 * 会话键解码失败与文本同一个结论（同一个输入不出现两种分类）。
 */
export class DiscordDeliveryTransport implements ChannelDeliveryTransport, ChannelImageTransport {
  private readonly clients = new Map<string, DiscordApiClient>()
  private readonly lifetimes = new Map<string, { isCurrent: () => boolean; signal: AbortSignal }>()
  setClient(channelId: string, client: DiscordApiClient, lifetime: { isCurrent: () => boolean; signal: AbortSignal }): void { this.clients.set(channelId, client); this.lifetimes.set(channelId, lifetime) }
  removeClient(channelId: string): void { this.clients.delete(channelId); this.lifetimes.delete(channelId) }

  async send(input: { channelId: string; providerConversationKey: string; text: string; idempotencyKey: string }): Promise<ChannelDeliveryTransportResult> {
    const client = this.clients.get(input.channelId); const lifetime = this.lifetimes.get(input.channelId); const conversation = decodeDiscordConversation(input.providerConversationKey)
    if (!client || !lifetime || lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
    if (!conversation) return { kind: 'failed', code: 'delivery-provider-rejected' }
    for (const part of splitDiscordText(input.text)) {
      if (lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
      const result = await client.sendText(conversation, part, lifetime.signal)
      if (result !== 'delivered') return mapSendOutcome(result)
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
    const client = this.clients.get(input.channelId); const lifetime = this.lifetimes.get(input.channelId); const conversation = decodeDiscordConversation(input.providerConversationKey)
    if (!client || !lifetime || lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
    if (!conversation) return { kind: 'failed', code: 'delivery-provider-rejected' }
    const result = await client.sendImage(conversation, { mime: input.image.mime, bytes: input.image.bytes, caption: input.caption }, lifetime.signal)
    if (lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
    // 一条请求一条消息：`delivered` 就是整条（图 + caption）到了，不存在「图到了、字没到」的中间态。
    return result === 'delivered' ? { kind: 'delivered' } : mapSendOutcome(result)
  }
}

/** 文本与图片共用的失败分流（一处，不分两套）：限流、上游拒绝、其余按「发出去了但不知道结果」处理。 */
function mapSendOutcome(outcome: Exclude<DiscordSendOutcome, 'delivered'>): ChannelDeliveryTransportResult {
  return outcome === 'rate-limited'
    ? { kind: 'failed', code: 'delivery-rate-limited' }
    : outcome === 'rejected'
      ? { kind: 'failed', code: 'delivery-provider-rejected' }
      : { kind: 'unknown-after-send' }
}
