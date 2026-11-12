import type { ChannelDeliveryResult, ChannelImageDeliveryRequest } from '../../../ai/agent-platform/channels/ChannelDeliveryContracts'
import { createChannelImageSend, type ChannelImageSendResult } from '../channelImageSend'
import { createChannelImageSource } from '../channelImageSource'

/**
 * 「把助手聊天里的图消息发到频道」的装配分片（第四笔）。
 *
 * 从 `channelsAndJobs.ts` 抽出来的理由只有一个：那个文件已经贴着 500 行上限，装配再长就要抬基线。
 * 行为一字未改——选通道、来源校验、目标解析仍在原来那三处，这里只把它们接起来。
 *
 * 三条不在这里重新判断的事：
 * - **投影与动作选同一条通道**：唯一 `runtime-ready`；0 条或多条都当作「没有可用的通道宿主」。
 * - **图片能力问同一个 router**：一张路由表同时实现文本与图片接口，不开第二张（方案 §2）。
 * - **目标解析与跳过码归投递层**：`deliverImageToEnabledTargets` 与文本版同形、同一套码。
 */
export type ChannelImageWiringChannel = { id: string; name: string; agentId: string | null; state: string }

export type ChannelImageTarget = { channelId: string; channelName: string; supportsImage: boolean }

export type ChannelImageWiring = {
  /** 按钮出现条件的唯一来源：没有可用通道时返回 `null`，渲染层不自己判。 */
  target: () => ChannelImageTarget | null
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
    listChannels: () => deps.channels.list().map((channel) => ({ id: channel.id, agentId: channel.agentId, state: channel.state })),
    resolveImage: channelImageSource.resolve,
    deliverImageToEnabledTargets: (input) => deps.delivery.deliverImageToEnabledTargets(input),
    captionFor: (messageId) => captionOf(getMessage(messageId))
  }).send

  return {
    target() {
      const ready = deps.channels.list().filter((channel) => channel.state === 'runtime-ready')
      const channel = ready.length === 1 ? ready[0]! : null
      if (!channel) return null
      return { channelId: channel.id, channelName: channel.name, supportsImage: deps.router.supportsImage(channel.id) }
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
