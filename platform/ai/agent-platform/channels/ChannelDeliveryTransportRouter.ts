import type {
  ChannelDeliveryTransport,
  ChannelDeliveryTransportResult,
  ChannelImageTransport
} from './ChannelDeliveryContracts'
import type { ChannelConversationKind } from './channelContracts'

/** Routes only by durable Channel type; provider conversation keys never leave the selected adapter transport. */
export class ChannelDeliveryTransportRouter implements ChannelDeliveryTransport, ChannelImageTransport {
  constructor(private readonly deps: {
    typeForChannel: (channelId: string) => string | null
    /**
     * 这条通道**绑定**的目标会话种类；没绑定、或有多个绑定时回 `null`。
     *
     * 只有图片能力用它：文本投递在投递层自己解析目标，不在这里多问一次。不传＝判不出来，
     * 能力按适配器声明走（等于不改变现状）。
     */
    targetKindForChannel?: (channelId: string) => ChannelConversationKind | null
    telegram: ChannelDeliveryTransport; slack: ChannelDeliveryTransport; lark: ChannelDeliveryTransport; qq: ChannelDeliveryTransport; discord: ChannelDeliveryTransport; wechat: ChannelDeliveryTransport
  }) {}

  send(input: { channelId: string; providerConversationKey: string; text: string; idempotencyKey: string }): Promise<ChannelDeliveryTransportResult> {
    return this.transport(input.channelId).send(input)
  }
  supportsIdempotency(channelId: string): boolean { return this.transport(channelId).supportsIdempotency(channelId) }

  /**
   * 图片能力与文本走**同一张路由表**，不另开一张：只有真正实现了 `sendImage` 的适配器才算支持。
   * 未知类型/没实现的平台 → false（随后由 `sendImage` 给 `delivery-image-unsupported`，
   * 不是 `host-unavailable`：这是「这类通道发不了图」的配置事实，不是主机故障）。
   *
   * 绑定了目标会话时再问一句适配器：同一条通道，发给单聊能发图、发给频道（guild）就不一定。
   * 判不出目标（`null`）或适配器没声明这一档 → 按适配器声明走，不改变现状。
   */
  supportsImage(channelId: string): boolean {
    const transport = this.transport(channelId)
    if (!isChannelImageTransport(transport) || !transport.supportsImage(channelId)) return false
    const kind = this.deps.targetKindForChannel?.(channelId) ?? null
    if (kind === null) return true
    return transport.supportsImageForConversationKind?.(kind) ?? true
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
