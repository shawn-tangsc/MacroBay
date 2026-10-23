import type { ChannelDeliveryTransport, ChannelDeliveryTransportResult } from '../ChannelDeliveryContracts'
import { TelegramApiClient } from './TelegramApiClient'
import { splitTelegramText } from './TelegramContracts'

/** Runtime-owned clients avoid exposing a token/reference to the delivery ledger or its DTOs. */
export class TelegramDeliveryTransport implements ChannelDeliveryTransport {
  private readonly clients = new Map<string, TelegramApiClient>()
  private readonly lifetimeByChannel = new Map<string, { isCurrent: () => boolean; signal: AbortSignal }>()

  setClient(channelId: string, client: TelegramApiClient, lifetime: { isCurrent: () => boolean; signal: AbortSignal }): void {
    this.clients.set(channelId, client)
    this.lifetimeByChannel.set(channelId, lifetime)
  }
  removeClient(channelId: string): void {
    this.clients.delete(channelId)
    this.lifetimeByChannel.delete(channelId)
  }

  async send(input: { channelId: string; providerConversationKey: string; text: string; idempotencyKey: string }): Promise<ChannelDeliveryTransportResult> {
    const client = this.clients.get(input.channelId)
    const lifetime = this.lifetimeByChannel.get(input.channelId)
    if (!client || !lifetime || lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
    for (const segment of splitTelegramText(input.text)) {
      // A fence between delivery admission and a later segment must not leak a stale send.
      if (lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
      let response = await client.sendMessage(input.providerConversationKey, segment, false, lifetime.signal)
      if (lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
      if (!response.ok && response.parseRejected) {
        if (lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
        response = await client.sendMessage(input.providerConversationKey, segment, true, lifetime.signal)
        if (lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
      }
      if (!response.ok) return mapFailure(response.code)
    }
    return { kind: 'delivered' }
  }

  supportsIdempotency(): boolean { return false }

  async typing(input: { channelId: string; providerConversationKey: string }): Promise<void> {
    const lifetime = this.lifetimeByChannel.get(input.channelId)
    if (!lifetime || lifetime.signal.aborted || !lifetime.isCurrent()) return
    await this.clients.get(input.channelId)?.typing(input.providerConversationKey, lifetime.signal)
  }
}

function mapFailure(code: string): ChannelDeliveryTransportResult {
  if (code === 'telegram-rate-limited') return { kind: 'failed', code: 'delivery-rate-limited' }
  if (code === 'telegram-provider-rejected') return { kind: 'failed', code: 'delivery-provider-rejected' }
  return { kind: 'unknown-after-send' }
}
