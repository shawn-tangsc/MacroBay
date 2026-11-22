import type { ChannelDeliveryRequest, ChannelDeliveryResult, ChannelImageDeliveryRequest } from '../../../ai/agent-platform/channels/ChannelDeliveryContracts'
import { createChannelImageSend, type ChannelImageSendResult } from '../channelImageSend'
import { createChannelImageSource } from '../channelImageSource'
import { createChannelPosterSend } from '../channelPosterSend'
import { getChannelPosterOutbox } from '../../../storage/channelPosterOutbox'
import type { PosterPublish } from '../../../ai/agent-platform/channels/channelPosterPublishRegistry'
import { getBriefingPosterRead } from '../../../ai/agent-platform/channels/briefingPosterReadRegistry'
import { configureChannelPosterPushSource } from '../../../ai/agent-platform/channels/channelPosterPushRegistry'

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
  /** 日报海报：按通道能力选形态（图 + 导读 / 纯导读），逐通道结果写回同一条记录。 */
  posterPublish: PosterPublish
}

type MessageLike = { data?: { parts?: unknown } }

export function createChannelImageWiring(deps: {
  channels: { list: () => readonly ChannelImageWiringChannel[] }
  router: { supportsImage: (channelId: string) => boolean }
  delivery: {
    deliverImageToEnabledTargets: (input: Omit<ChannelImageDeliveryRequest, 'conversationId'>) => Promise<ChannelDeliveryResult[]>
    deliverToEnabledTargets: (input: Omit<ChannelDeliveryRequest, 'conversationId'>) => Promise<ChannelDeliveryResult[]>
  }
  readImage: (fileName: string) => Promise<{ bytes: Uint8Array; mime: string } | null>
  /** 海报逐通道结果写回同一条记录（额度按记录算）；由组合根注入，wiring 不自己拿运行时。 */
  recordPosterOutcomes: (input: { recordId: string; channels: readonly any[] }) => Promise<{ ok: boolean }>
  /** 这条记录上已经写过的逐通道结果：重发据此只补没到的通道。 */
  readPosterChannels: (recordId: string) => Promise<readonly any[]>
  /** 助手消息仓储的 `messages.getById`；来源校验与 caption 用同一次读。 */
  getMessage: (messageId: string) => unknown
}): ChannelImageWiring {
  const getMessage = (messageId: string): MessageLike | null => (deps.getMessage(messageId) as MessageLike | null) ?? null
  const channelImageSource = createChannelImageSource({
    read: (fileName) => deps.readImage(fileName),
    getMessage,
    // 简报海报那一支：只按记录里的内容 hash 取图，读入口由简报侧注册（没注册 = 如实说拿不到，不猜、不扫目录）。
    readBriefingPoster: (contentHash) => {
      const read = getBriefingPosterRead()
      return read === null
        ? Promise.resolve({ ok: false as const, code: 'poster-not-found' as const, detail: 'poster-reader-unconfigured' })
        : read(contentHash)
    }
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

  const posterSend = createChannelPosterSend({
    listChannels: () => deps.channels.list().map((channel) => ({
      id: channel.id,
      name: channel.name,
      agentId: channel.agentId,
      state: channel.state,
      supportsImage: deps.router.supportsImage(channel.id)
    })),
    readPoster: (edition) => {
      const outbox = getChannelPosterOutbox()
      return outbox === null
        ? Promise.resolve({ ok: false as const, code: 'delivery-image-unavailable' as const, detail: 'poster-outbox-unavailable' })
        : outbox.read(edition)
    },
    deliverImageToEnabledTargets: (input) => deps.delivery.deliverImageToEnabledTargets(input),
    deliverTextToEnabledTargets: (input) => deps.delivery.deliverToEnabledTargets(input),
    now: () => new Date().toISOString()
  })

  const posterPublish: PosterPublish = async (input) => {
    const outbox = getChannelPosterOutbox()
    // 暂存区只用来取字节与做来源校验；**这次发什么由调用方的意图决定**（带了海报才调到这里）。
    if (outbox === null) return { kind: 'refused', code: 'delivery-image-unavailable', detail: 'poster-outbox-unavailable' }
    // 重发只补没到的通道：已经 `sent-accepted` 的一条都不重发（否则读者手机上第二次收到同一张图）。
    const prior = await deps.readPosterChannels(input.recordId)
    const accepted = prior.filter((entry) => entry.state === 'sent-accepted').map((entry) => entry.channelId)
    const sent = await posterSend.publish({ ...input, skipChannelIds: accepted })
    if (sent.channels.length === 0) {
      return {
        kind: 'refused',
        // 整条不发一定有一个原因码：没有码就按「通道侧拒收」——不许返回一个没有原因的拒绝。
        code: sent.code ?? 'channel-rejected',
        ...(sent.detail === undefined ? {} : { detail: sent.detail })
      }
    }
    // 记录上保留已送达的那些行（它们仍是事实），只把这次的结果与它们合并后写回。
    const merged = [...prior.filter((entry) => accepted.includes(entry.channelId)), ...sent.channels]
    await deps.recordPosterOutcomes({ recordId: input.recordId, channels: merged })
    // 写回之后读出来的就是记录上的那一档：回执与记录同源，不从结果对象反推。
    return { kind: 'published', delivery: { state: sent.state, ...(sent.code === null ? {} : { reason: sent.code }), at: new Date().toISOString(), channels: sent.channels }, channels: sent.channels }
  }

  // 简报**随推送**发海报（方案 §12.1）：推送执行器在通知运行时里，装配期只把两个开关交出去。
  // 注册放在这里而不是组合根：取图与图片投递这两样**本来就是这个分片的依赖**，多一处搬运就多一处漂移。
  // 没注册时那条链路自动退回「只发正文」。
  configureChannelPosterPushSource({
    resolve: (contentHash) => channelImageSource.resolve({ kind: 'briefing-poster', contentHash }),
    // 目标解析已经保证「恰好一条会话」，所以逐个取第一条；空结果如实记「没目标」，不猜。
    deliverImage: async (request) =>
      (await deps.delivery.deliverImageToEnabledTargets(request))[0]
      ?? { status: 'failed', attemptId: null, errorCode: 'delivery-no-target-bound' }
  })

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
    send,
    posterPublish
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
