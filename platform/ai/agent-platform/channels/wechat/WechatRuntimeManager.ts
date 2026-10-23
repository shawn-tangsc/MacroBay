import type { ChannelCredentialVault } from '../../../../secrets/channels/channelCredentialContracts'
import type { PlatformWebSocketConstructor } from '../../../../network/platformWebSocket'
import type { ChannelInboundService } from '../ChannelInboundService'
import { WechatDeliveryTransport } from './WechatDeliveryTransport'
import { WechatEnrollmentRepository } from './WechatEnrollmentRepository'
import { WechatRuntimeRepository } from './WechatRuntimeRepository'

/** Public iLink protocol/licence/target scope is unfrozen, so no QR, HTTP, WebSocket, or Vault operation may start. */
export class WechatRuntimeManager {
  constructor(private readonly _deps: {
    inbound: ChannelInboundService
    runtime: WechatRuntimeRepository
    enrollments: WechatEnrollmentRepository
    vault: ChannelCredentialVault
    getPlatformFetch: () => typeof fetch
    createPlatformWebSocket: PlatformWebSocketConstructor
    delivery: WechatDeliveryTransport
  }) {}

  async start(_channelId: string, _generation: number, _ownerToken: string): Promise<boolean> { return false }
  stop(_channelId: string, _ownerToken?: string): void {}
  async dispose(): Promise<void> {}
}
