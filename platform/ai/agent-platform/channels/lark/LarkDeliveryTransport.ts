import type { ChannelDeliveryTransport, ChannelDeliveryTransportResult } from '../ChannelDeliveryContracts'
import { LarkApiClient } from './LarkApiClient'
import { decodeLarkConversation, splitLarkText } from './LarkContracts'

export class LarkDeliveryTransport implements ChannelDeliveryTransport {
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
    for (const segment of splitLarkText(input.text)) {
      if (lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
      const result = await client.sendText(conversation, segment, lifetime.signal)
      if (lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
      if (!result.ok) return result.code === 'lark-rate-limited'
        ? { kind: 'failed', code: 'delivery-rate-limited' }
        : result.code === 'lark-provider-rejected'
          ? { kind: 'failed', code: 'delivery-provider-rejected' }
          : { kind: 'unknown-after-send' }
    }
    return { kind: 'delivered' }
  }

  supportsIdempotency(): boolean { return false }
}
