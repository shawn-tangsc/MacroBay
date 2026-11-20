import type {
  ChannelDeliveryTransport,
  ChannelDeliveryTransportResult,
  ChannelImageTransport
} from '../ChannelDeliveryContracts'
import { SlackApiClient } from './SlackApiClient'
import type { SlackApiFailure } from './SlackContracts'
import { decodeSlackConversation, splitSlackText } from './SlackContracts'

/** Runtime-owned API clients ensure neither Vault refs nor tokens reach the unified delivery ledger. */
export class SlackDeliveryTransport implements ChannelDeliveryTransport, ChannelImageTransport {
  private readonly clients = new Map<string, SlackApiClient>()
  private readonly lifetimes = new Map<string, { isCurrent: () => boolean; signal: AbortSignal }>()

  setClient(channelId: string, client: SlackApiClient, lifetime: { isCurrent: () => boolean; signal: AbortSignal }): void {
    this.clients.set(channelId, client)
    this.lifetimes.set(channelId, lifetime)
  }
  removeClient(channelId: string): void { this.clients.delete(channelId); this.lifetimes.delete(channelId) }

  async send(input: { channelId: string; providerConversationKey: string; text: string; idempotencyKey: string }): Promise<ChannelDeliveryTransportResult> {
    const client = this.clients.get(input.channelId)
    const lifetime = this.lifetimes.get(input.channelId)
    if (!client || !lifetime || lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
    const conversation = decodeSlackConversation(input.providerConversationKey)
    if (!conversation) return { kind: 'failed', code: 'delivery-provider-rejected' }
    for (const segment of splitSlackText(input.text)) {
      if (lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
      const result = await client.sendMessage(conversation, segment, lifetime.signal)
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

  /**
   * 发一张图 + caption（三步上传，见 `SlackApiClient.uploadImage`）。
   *
   * 三件不在这里做的事：大小/格式不重判（投递层已判）、错误码不新开（与文本共用 `mapApiFailure`）、
   * 会话键解码失败与文本同一个结论（同一个输入不出现两种分类）。
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
    if (!client || !lifetime || lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
    const conversation = decodeSlackConversation(input.providerConversationKey)
    if (!conversation) return { kind: 'failed', code: 'delivery-provider-rejected' }

    const result = await client.uploadImage({
      conversation, mime: input.image.mime, bytes: input.image.bytes, caption: input.caption, signal: lifetime.signal
    })
    if (lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
    if (!result.ok) return mapApiFailure(result.code)
    // 上游 file id 只作证据（「发到了」与「发到了别处」要能分开），拿不到就不写。
    return {
      kind: 'delivered',
      ...(result.value.fileId === null ? {} : { detail: JSON.stringify({ slackFileId: result.value.fileId }) })
    }
  }

  async typing(input: { channelId: string; providerConversationKey: string }): Promise<void> {
    // Slack has no generic channel typing endpoint. Final delivery remains the only supported action.
    const lifetime = this.lifetimes.get(input.channelId)
    if (!lifetime || lifetime.signal.aborted || !lifetime.isCurrent()) return
  }
}

/** 文本与图片共用的失败分流（一处，不分两套）：限流、上游拒绝、其余按「发出去了但不知道结果」处理。 */
function mapApiFailure(code: SlackApiFailure): ChannelDeliveryTransportResult {
  return code === 'slack-rate-limited'
    ? { kind: 'failed', code: 'delivery-rate-limited' }
    : code === 'slack-provider-rejected'
      ? { kind: 'failed', code: 'delivery-provider-rejected' }
      : { kind: 'unknown-after-send' }
}
