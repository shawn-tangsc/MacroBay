import type { ChannelCredentialVault } from '../../../../secrets/channels/channelCredentialContracts'
import type { ChannelInboundService } from '../ChannelInboundService'
import { ChannelInboundRepository } from '../ChannelInboundRepository'
import { TelegramApiClient } from './TelegramApiClient'
import { TelegramDeliveryTransport } from './TelegramDeliveryTransport'
import { TelegramOffsetRepository } from './TelegramOffsetRepository'
import { TelegramPollingHost } from './TelegramPollingHost'

/** Owns only C03-enabled Telegram pollers; legacy runtime hosts never enter this map. */
export class TelegramRuntimeManager {
  private readonly hosts = new Map<string, TelegramPollingHost>()
  private readonly lifetimes = new Map<string, { controller: AbortController; ownerToken?: string }>()

  constructor(private readonly deps: {
    inbound: ChannelInboundRepository
    inboundService: ChannelInboundService
    offsets: TelegramOffsetRepository
    vault: ChannelCredentialVault
    getPlatformFetch: () => typeof fetch
    delivery: TelegramDeliveryTransport
    getCredential: (channelId: string) => { ref: string; revision: number } | null
    ownsLifecycleOwner?: (channelId: string, token: string, generation: number) => boolean
  }) {}

  async start(channelId: string, generation: number, ownerToken: string): Promise<boolean> {
    if (!ownerToken || !this.deps.ownsLifecycleOwner?.(channelId, ownerToken, generation)) return false
    this.stop(channelId)
    if (!this.deps.inbound.isCurrentActive(channelId, generation) || !this.deps.ownsLifecycleOwner?.(channelId, ownerToken, generation)) return false
    const lifetime = new AbortController()
    this.lifetimes.set(channelId, { controller: lifetime, ownerToken })
    try {
      const client = new TelegramApiClient({
        getPlatformFetch: this.deps.getPlatformFetch,
        token: async () => {
          const metadata = this.deps.getCredential(channelId)
          if (!metadata || lifetime.signal.aborted) return null
          const secret = await this.deps.vault.get(metadata.ref)
          return lifetime.signal.aborted ? null : secret?.bot_token ?? null
        }
      })
      const identity = await client.botUsername(lifetime.signal)
      const isCurrent = () => !lifetime.signal.aborted && this.lifetimes.get(channelId)?.controller === lifetime && this.deps.inbound.isCurrentActive(channelId, generation) &&
        this.deps.ownsLifecycleOwner?.(channelId, ownerToken, generation) === true
      if (!identity.ok || !isCurrent()) { this.stopOwned(channelId, lifetime); return false }
      this.deps.delivery.setClient(channelId, client, { isCurrent, signal: lifetime.signal })
      const host = new TelegramPollingHost({
        channelId, generation, inbound: this.deps.inboundService, offsets: this.deps.offsets, api: client,
        isCurrent, signal: lifetime.signal, botUsername: identity.value
      })
      this.hosts.set(channelId, host)
      host.start()
      return true
    } catch {
      this.stopOwned(channelId, lifetime)
      return false
    }
  }

  stop(channelId: string, ownerToken?: string): void {
    const lifetime = this.lifetimes.get(channelId)
    if (lifetime && (!ownerToken || lifetime.ownerToken === ownerToken)) this.stopOwned(channelId, lifetime.controller)
  }

  private stopOwned(channelId: string, lifetime: AbortController): void {
    lifetime.abort()
    // A superseded async handshake must never tear down the newer generation's client/host.
    if (this.lifetimes.get(channelId)?.controller !== lifetime) return
    this.hosts.get(channelId)?.close()
    this.hosts.delete(channelId)
    this.deps.delivery.removeClient(channelId)
    this.lifetimes.delete(channelId)
  }

  async dispose(): Promise<void> { for (const id of [...this.lifetimes.keys()]) this.stop(id) }

  stopAllAndFence(fence: () => void): void {
    // Abort first so an in-flight handshake cannot issue another request while SQLite is fenced.
    for (const id of [...this.lifetimes.keys()]) this.stop(id)
    fence()
  }
}
