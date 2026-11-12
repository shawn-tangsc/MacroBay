import type { ChannelDeliveryResult, ChannelImageDeliveryRequest } from '../../../ai/agent-platform/channels/ChannelDeliveryContracts'
import { createChannelImageSend, type ChannelImageSendResult } from '../channelImageSend'
import { createChannelImageSource } from '../channelImageSource'

/**
 * 「把助手聊天里的图消息发到频道」的装配分片（多通道方案 §4b 定稿 A）。
 *
 * 两条口径：
 * - **投影回列表**：每条 `runtime-ready` 一条，带 `supportsImage`；按钮出现条件 = 至少一条可发图
 *   （全不支持、或一条 ready 都没有 → `null`，不画按钮）。`target()` 只读投影：不读图、不读盘。
 * - **图片能力问同一个 router**：一张路由表同时实现文本与图片接口，不开第二张（方案 §2）。
 *
 * 目标解析与跳过码归投递层：`deliverImageToEnabledTargets` 与文本版同形、同一套码。
 */
export type ChannelImageWiringChannel = { id: string; name: string; agentId: string | null; state: string }

export type ChannelImageTarget = { channelId: string; channelName: string; supportsImage: boolean }

export type ChannelImageTargets = { channels: readonly ChannelImageTarget[] }

export type ChannelImageWiring = {
  /** 按钮出现条件的唯一来源：没有**可发图**的通道时返回 `null`，渲染层不自己判。 */
  target: () => ChannelImageTargets | null
  send: (input: { messageId: string; fileName: string; withoutCaption?: boolean }) => Promise<ChannelImageSendResult>
}

type MessageLike = { data?: { parts?: unknown } }

export function createChannelImageWiring(deps: {
  channels: { list: () => readonly ChannelImageWiringChannel[] }
  router: { supportsImage: (channelId: string) => boolean }
  delivery: {
    deliverImageToEnabledTargets: (input: Omit<ChannelImageDeliveryRequest, 'conversationId'>) => Promise<ChannelDeliveryResult[]>
  }
  readImage: (fileName: string) => Promise<{ bytes: Uint8Array; mime: string } | null>
  /** 助手消息仓储的 `messages.getById`；来源校验与 caption 用同一次读。 */
  getMessage: (messageId: string) => unknown
}): ChannelImageWiring {
  const getMessage = (messageId: string): MessageLike | null => (deps.getMessage(messageId) as MessageLike | null) ?? null
  const channelImageSource = createChannelImageSource({
    read: (fileName) => deps.readImage(fileName),
    getMessage
  })
  const send = createChannelImageSend({
    // 能力在一次投影里问清楚：投递时不再回头问 router（一条通道一次决定，不两处判）。
    listChannels: () => deps.channels.list().map((channel) => ({
      id: channel.id,
      agentId: channel.agentId,
      state: channel.state,
      supportsImage: deps.router.supportsImage(channel.id)
    })),
    resolveImage: channelImageSource.resolve,
    deliverImageToEnabledTargets: (input) => deps.delivery.deliverImageToEnabledTargets(input),
    captionFor: (messageId) => captionOf(getMessage(messageId))
  }).send

  return {
    target() {
      const ready = deps.channels.list().filter((channel) => channel.state === 'runtime-ready')
      const channels = ready
        .map((channel) => ({
          channelId: channel.id,
          channelName: channel.name,
          supportsImage: deps.router.supportsImage(channel.id)
        }))
        .filter((channel) => channel.supportsImage)
      // 全都不支持图片、或一条 ready 都没有：不画按钮（这是投影的结论，渲染层不自己判）。
      return channels.length === 0 ? null : { channels }
    },
    send
  }
}

/** 说明取同一条助手消息的正文（`data.parts` 里的 text 段，按行拼）；没有就空字符串。 */
function captionOf(message: MessageLike | null): string {
  const parts = Array.isArray(message?.data?.parts) ? (message.data.parts as { type?: unknown; text?: unknown }[]) : []
  return parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim()
}
