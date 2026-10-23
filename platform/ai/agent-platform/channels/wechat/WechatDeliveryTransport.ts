import type { ChannelDeliveryTransport, ChannelDeliveryTransportResult } from '../ChannelDeliveryContracts'
import { decodeWechatConversation } from './WechatContracts'

/** No iLink outbound protocol is guessed: blocked WeChat delivery cannot cross a transport boundary. */
export class WechatDeliveryTransport implements ChannelDeliveryTransport {
  async send(input: { channelId: string; providerConversationKey: string; text: string; idempotencyKey: string }): Promise<ChannelDeliveryTransportResult> {
    return decodeWechatConversation(input.providerConversationKey)
      ? { kind: 'failed', code: 'delivery-host-unavailable' }
      : { kind: 'failed', code: 'delivery-provider-rejected' }
  }
  supportsIdempotency(): boolean { return false }
}
