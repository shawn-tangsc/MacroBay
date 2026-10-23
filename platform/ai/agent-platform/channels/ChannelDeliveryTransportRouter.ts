import type { ChannelDeliveryTransport, ChannelDeliveryTransportResult } from './ChannelDeliveryContracts'

/** Routes only by durable Channel type; provider conversation keys never leave the selected adapter transport. */
export class ChannelDeliveryTransportRouter implements ChannelDeliveryTransport {
  constructor(private readonly deps: { typeForChannel: (channelId: string) => string | null; telegram: ChannelDeliveryTransport; slack: ChannelDeliveryTransport; lark: ChannelDeliveryTransport; qq: ChannelDeliveryTransport; discord: ChannelDeliveryTransport; wechat: ChannelDeliveryTransport }) {}

  send(input: { channelId: string; providerConversationKey: string; text: string; idempotencyKey: string }): Promise<ChannelDeliveryTransportResult> {
    return this.transport(input.channelId).send(input)
  }
  supportsIdempotency(channelId: string): boolean { return this.transport(channelId).supportsIdempotency(channelId) }

  private transport(channelId: string): ChannelDeliveryTransport {
    const type = this.deps.typeForChannel(channelId)
    if (type === 'telegram') return this.deps.telegram
    if (type === 'slack') return this.deps.slack
    if (type === 'feishu') return this.deps.lark
    if (type === 'qq') return this.deps.qq
    if (type === 'discord') return this.deps.discord
    if (type === 'wechat') return this.deps.wechat
    return unavailableTransport
  }
}

/** An isolated or malformed storage row must never fall through to another provider. */
const unavailableTransport: ChannelDeliveryTransport = {
  send: async () => ({ kind: 'failed', code: 'delivery-host-unavailable' }),
  supportsIdempotency: () => false
}
