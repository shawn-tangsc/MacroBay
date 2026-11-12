import type {
  ChannelDeliveryTransport,
  ChannelDeliveryTransportResult,
  ChannelImageTransport
} from './ChannelDeliveryContracts'

/** Routes only by durable Channel type; provider conversation keys never leave the selected adapter transport. */
export class ChannelDeliveryTransportRouter implements ChannelDeliveryTransport, ChannelImageTransport {
  constructor(private readonly deps: { typeForChannel: (channelId: string) => string | null; telegram: ChannelDeliveryTransport; slack: ChannelDeliveryTransport; lark: ChannelDeliveryTransport; qq: ChannelDeliveryTransport; discord: ChannelDeliveryTransport; wechat: ChannelDeliveryTransport }) {}

  send(input: { channelId: string; providerConversationKey: string; text: string; idempotencyKey: string }): Promise<ChannelDeliveryTransportResult> {
    return this.transport(input.channelId).send(input)
  }
  supportsIdempotency(channelId: string): boolean { return this.transport(channelId).supportsIdempotency(channelId) }

  /**
   * 图片能力与文本走**同一张路由表**，不另开一张：只有真正实现了 `sendImage` 的适配器才算支持。
   * 未知类型/没实现的平台 → false（随后由 `sendImage` 给 `delivery-image-unsupported`，
   * 不是 `host-unavailable`：这是「这类通道发不了图」的配置事实，不是主机故障）。
   */
  supportsImage(channelId: string): boolean {
    const transport = this.transport(channelId)
    return isChannelImageTransport(transport) && transport.supportsImage(channelId)
  }

  sendImage(input: {
    channelId: string
    providerConversationKey: string
    image: { mime: string; bytes: Uint8Array }
    caption: string
    idempotencyKey: string
  }): Promise<ChannelDeliveryTransportResult> {
    const transport = this.transport(input.channelId)
    if (!isChannelImageTransport(transport)) {
      return Promise.resolve({ kind: 'failed', code: 'delivery-image-unsupported' })
    }
    return transport.sendImage(input)
  }

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

/** 适配器是不是实现了图片接口：`sendImage` 在不在就是唯一真相，不看 flag。 */
function isChannelImageTransport(value: ChannelDeliveryTransport): value is ChannelDeliveryTransport & ChannelImageTransport {
  return typeof (value as Partial<ChannelImageTransport>).sendImage === 'function' &&
    typeof (value as Partial<ChannelImageTransport>).supportsImage === 'function'
}
