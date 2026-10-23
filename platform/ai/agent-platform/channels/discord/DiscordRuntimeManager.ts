import type { ChannelCredentialVault } from '../../../../secrets/channels/channelCredentialContracts'
import type { PlatformWebSocketConstructor } from '../../../../network/platformWebSocket'
import type { ChannelInboundService } from '../ChannelInboundService'
import { DiscordDeliveryTransport } from './DiscordDeliveryTransport'
import { DiscordRuntimeRepository } from './DiscordRuntimeRepository'

/** Gateway identify/resume framing is not sufficiently frozen, so blocked Discord never opens a transport. */
export class DiscordRuntimeManager {
  constructor(private readonly _deps: { inbound: ChannelInboundService; runtime: DiscordRuntimeRepository; vault: ChannelCredentialVault; getPlatformFetch: () => typeof fetch; createPlatformWebSocket: PlatformWebSocketConstructor; delivery: DiscordDeliveryTransport; getCredential: (channelId: string) => { ref: string; revision: number } | null; ownsLifecycleOwner: (channelId: string, token: string, generation: number) => boolean; isCurrentActive: (channelId: string, generation: number) => boolean }) {}
  async start(_channelId: string, _generation: number, _ownerToken: string): Promise<boolean> { return false }
  stop(_channelId: string, _ownerToken?: string): void {}
  async dispose(): Promise<void> {}
}
