import type { ChannelDeliveryTransport, ChannelDeliveryTransportResult } from '../ChannelDeliveryContracts'
import { SlackApiClient } from './SlackApiClient'
import { decodeSlackConversation, splitSlackText } from './SlackContracts'

/** Runtime-owned API clients ensure neither Vault refs nor tokens reach the unified delivery ledger. */
export class SlackDeliveryTransport implements ChannelDeliveryTransport {
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
      if (!result.ok) return result.code === 'slack-rate-limited'
        ? { kind: 'failed', code: 'delivery-rate-limited' }
        : result.code === 'slack-provider-rejected'
          ? { kind: 'failed', code: 'delivery-provider-rejected' }
          : { kind: 'unknown-after-send' }
    }
    return { kind: 'delivered' }
  }
  supportsIdempotency(): boolean { return false }

  async typing(input: { channelId: string; providerConversationKey: string }): Promise<void> {
    // Slack has no generic channel typing endpoint. Final delivery remains the only supported action.
    const lifetime = this.lifetimes.get(input.channelId)
    if (!lifetime || lifetime.signal.aborted || !lifetime.isCurrent()) return
  }
}
