import type { ChannelCredentialVault } from '../../../../secrets/channels/channelCredentialContracts'
import type { PlatformWebSocketConstructor } from '../../../../network/platformWebSocket'
import type { ChannelInboundService } from '../ChannelInboundService'
import { LarkDeliveryTransport } from './LarkDeliveryTransport'
import { LarkRuntimeRepository } from './LarkRuntimeRepository'

/**
 * Release C intentionally cannot construct a long-connection client until the official framing is
 * independently frozen. The injected dependencies keep the future seam narrow without a raw fallback.
 */
export class LarkRuntimeManager {
  constructor(private readonly _deps: {
    inbound: ChannelInboundService
    runtime: LarkRuntimeRepository
    vault: ChannelCredentialVault
    getPlatformFetch: () => typeof fetch
    createPlatformWebSocket: PlatformWebSocketConstructor
    delivery: LarkDeliveryTransport
    getCredential: (channelId: string) => { ref: string; revision: number } | null
    keyedHash: (channelId: string, value: Uint8Array) => Promise<string>
    ownsLifecycleOwner: (channelId: string, token: string, generation: number) => boolean
    isCurrentActive: (channelId: string, generation: number) => boolean
  }) {}

  async start(_channelId: string, _generation: number, _ownerToken: string): Promise<boolean> {
    // No unverified Lark URL, handshake, framing or ACK protocol is allowed to create a transport.
    return false
  }
  stop(_channelId: string, _ownerToken?: string): void {}
  async dispose(): Promise<void> {}
}
