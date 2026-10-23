import type { ChannelDeliveryTransport, ChannelDeliveryTransportResult } from '../ChannelDeliveryContracts'
import { DiscordApiClient } from './DiscordApiClient'
import { decodeDiscordConversation, splitDiscordText } from './DiscordContracts'

export class DiscordDeliveryTransport implements ChannelDeliveryTransport {
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
      if (result === 'rate-limited') return { kind: 'failed', code: 'delivery-rate-limited' }
      if (result === 'rejected') return { kind: 'failed', code: 'delivery-provider-rejected' }
      if (result === 'unknown') return { kind: 'unknown-after-send' }
    }
    return { kind: 'delivered' }
  }
  supportsIdempotency(): boolean { return false }
}
