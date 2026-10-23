import type { ChannelCredentialVault } from '../../../../secrets/channels/channelCredentialContracts'
import type { PlatformWebSocketConstructor } from '../../../../network/platformWebSocket'
import type { ChannelInboundService } from '../ChannelInboundService'
import { SlackApiClient } from './SlackApiClient'
import { SlackDeliveryTransport } from './SlackDeliveryTransport'
import { SlackRuntimeRepository } from './SlackRuntimeRepository'
import { SlackSocketModeHost } from './SlackSocketModeHost'

/** Owns C03 Slack Socket Mode lifetimes. It has no SDK or ambient network fallback. */
export class SlackRuntimeManager {
  private readonly hosts = new Map<string, SlackSocketModeHost>()
  private readonly lifetimes = new Map<string, { controller: AbortController; ownerToken: string }>()

  constructor(private readonly deps: {
    inbound: ChannelInboundService
    runtime: SlackRuntimeRepository
    vault: ChannelCredentialVault
    getPlatformFetch: () => typeof fetch
    createPlatformWebSocket: PlatformWebSocketConstructor
    delivery: SlackDeliveryTransport
    getCredential: (channelId: string) => { ref: string; revision: number } | null
    keyedHash: (channelId: string, value: Uint8Array) => Promise<string>
    ownsLifecycleOwner: (channelId: string, token: string, generation: number) => boolean
    isCurrentActive: (channelId: string, generation: number) => boolean
  }) {}

  async start(channelId: string, generation: number, ownerToken: string): Promise<boolean> {
    if (!ownerToken || !this.deps.ownsLifecycleOwner(channelId, ownerToken, generation)) return false
    this.stop(channelId)
    if (!this.deps.isCurrentActive(channelId, generation) || !this.deps.ownsLifecycleOwner(channelId, ownerToken, generation)) return false
    const controller = new AbortController()
    this.lifetimes.set(channelId, { controller, ownerToken })
    try {
      const client = new SlackApiClient({
        getPlatformFetch: this.deps.getPlatformFetch,
        botToken: () => this.token(channelId, 'bot_token', controller.signal),
        appToken: () => this.token(channelId, 'app_token', controller.signal)
      })
      const [socketUrl, botUser] = await Promise.all([client.socketUrl(controller.signal), client.authUser(controller.signal)])
      const isCurrent = () => !controller.signal.aborted && this.lifetimes.get(channelId)?.controller === controller &&
        this.deps.isCurrentActive(channelId, generation) && this.deps.ownsLifecycleOwner(channelId, ownerToken, generation)
      if (!socketUrl.ok || !botUser.ok || !isCurrent()) { this.stopOwned(channelId, controller); return false }
      this.deps.delivery.setClient(channelId, client, { isCurrent, signal: controller.signal })
      const host = new SlackSocketModeHost({
        channelId, generation, socketUrl: socketUrl.value, botUserId: botUser.value, inbound: this.deps.inbound,
        runtime: this.deps.runtime, createPlatformWebSocket: this.deps.createPlatformWebSocket as never, isCurrent, signal: controller.signal,
        hashEventKey: (value) => this.deps.keyedHash(channelId, new TextEncoder().encode(value)),
        reconnectSocketUrl: async () => {
          const result = await client.socketUrl(controller.signal)
          return result.ok ? result.value : null
        }
      })
      this.hosts.set(channelId, host)
      host.start()
      return true
    } catch { this.stopOwned(channelId, controller); return false }
  }

  stop(channelId: string, ownerToken?: string): void {
    const lifetime = this.lifetimes.get(channelId)
    if (lifetime && (!ownerToken || lifetime.ownerToken === ownerToken)) this.stopOwned(channelId, lifetime.controller)
  }
  async dispose(): Promise<void> { for (const id of [...this.lifetimes.keys()]) this.stop(id) }
  stopAllAndFence(fence: () => void): void { for (const id of [...this.lifetimes.keys()]) this.stop(id); fence() }

  private async token(channelId: string, field: 'bot_token' | 'app_token', signal: AbortSignal): Promise<string | null> {
    const credential = this.deps.getCredential(channelId)
    if (!credential || signal.aborted) return null
    const value = await this.deps.vault.get(credential.ref)
    return signal.aborted ? null : value?.[field] ?? null
  }
  private stopOwned(channelId: string, controller: AbortController): void {
    controller.abort()
    if (this.lifetimes.get(channelId)?.controller !== controller) return
    this.hosts.get(channelId)?.close()
    this.hosts.delete(channelId)
    this.deps.delivery.removeClient(channelId)
    this.lifetimes.delete(channelId)
  }
}
