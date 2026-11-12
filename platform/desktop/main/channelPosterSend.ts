import {
  channelPosterSourceId,
  channelPosterTextSourceId,
  type ChannelDeliveryRequest,
  type ChannelDeliveryResult,
  type ChannelImageDeliveryRequest
} from '../../ai/agent-platform/channels/ChannelDeliveryContracts'
import { MAX_CHANNEL_IMAGE_CAPTION_CHARS } from '../../ai/agent-platform/channels/channelImageDelivery'
import type { NotificationDeliveryPathState, PushChannelOutcome } from '../../notifications/contracts/notificationContracts'
import { aggregatePushDelivery } from '../../notifications/delivery/aggregatePushDelivery'
import type { ReadPosterOutcome } from '../../storage/channelPosterOutbox'

/**
 * 日报「发布频道」带图（海报方案 §5）：**一条通道一条尝试**，形态按通道能力选。
 *
 * - 支持图片的通道：`:poster`，图 + 导读同**一条**消息（绝不拆成「图一条、导读一条」）；
 * - 不支持图片的通道：`:poster-text`，纯导读文字一条——**明示降级**，记录里写 `kind:'text'`，
 *   回执据 `channels[]` 说清哪条降级了，不许静默丢；
 * - 两条形态共用同一个聚合（`aggregatePushDelivery`），海报不另开一套判定；
 * - 额度按**记录**算：调用方只有一条通知记录，N 条通道只是这条记录下的 N 次尝试。
 *
 * 图只在**发之前**读一次；导读超 1024 字符整条不发（截断＝半句话），一次上传都不发生。
 */
export type PosterChannelOutcome = {
  channelId: string
  channelName?: string
  kind: 'image' | 'text'
  state: NotificationDeliveryPathState
  reason?: string
  attemptId?: string
  at: string
}

export type PosterSendResult = {
  ok: boolean
  state: NotificationDeliveryPathState
  code: string | null
  channels: readonly PosterChannelOutcome[]
  /** 整条没发时的**配置事实**或原因说明（不是每个通道的账）。 */
  detail?: string
}

export type PosterChannel = {
  id: string
  name: string
  agentId: string | null
  state: string
  supportsImage: boolean
}

export function createChannelPosterSend(deps: {
  listChannels: () => readonly PosterChannel[]
  /** 海报暂存区读入口：**只按版本**取，不接受路径（海报方案 §2）。 */
  readPoster: (edition: { date: string; periodId: string; locale: string }) => Promise<ReadPosterOutcome>
  deliverImageToEnabledTargets: (input: Omit<ChannelImageDeliveryRequest, 'conversationId'>) => Promise<ChannelDeliveryResult[]>
  deliverTextToEnabledTargets: (input: Omit<ChannelDeliveryRequest, 'conversationId'>) => Promise<ChannelDeliveryResult[]>
  now: () => string
}): {
  publish: (input: {
    recordId: string
    edition: { date: string; periodId: string; locale: string }
    caption: string
    /**
     * 这次发什么形态：`image` = 按通道能力选（图 + 导读 / 纯导读），
     * `text` = 读者选了「只发文字」，**每条通道都只发导读**（尝试键 `:poster-text`），一次上传都没有。
     */
    mode?: 'image' | 'text'
    /** 已经 `sent-accepted` 的通道：重发**只补没到的**，已送达的一条都不重发（海报方案 §5 重试）。 */
    skipChannelIds?: readonly string[]
  }) => Promise<PosterSendResult>
} {
  return {
    async publish(input) {
      const at = deps.now()
      const ready = deps.listChannels().filter((channel) => channel.state === 'runtime-ready')
      const skip = new Set(input.skipChannelIds ?? [])
      if (ready.length === 0) {
        // 配置事实：一条可用通道都没有。不冒用「拿不到」那一类码。
        return { ok: false, state: 'failed', code: 'delivery-no-target-bound', detail: 'no-ready-channel', channels: [] }
      }
      // 导读超长：整条不发（截断＝半句话，而且图与导读必须同一条消息）。
      if (input.caption.length > MAX_CHANNEL_IMAGE_CAPTION_CHARS) {
        return { ok: false, state: 'failed', code: 'delivery-caption-too-long', detail: `chars=${input.caption.length}`, channels: [] }
      }

      const targets = ready.filter((channel) => !skip.has(channel.id))
      if (targets.length === 0) {
        // 每条都已经送达：不发、不读图，如实回「这次没有要补的」。
        return { ok: true, state: 'sent-accepted', code: null, channels: [] }
      }
      const imageChannels = input.mode === 'text' ? [] : targets.filter((channel) => channel.supportsImage)
      // 图只在发之前读**一次**，复用给每条支持图片的通道；一条都不支持时连读都不读。
      let poster: Extract<ReadPosterOutcome, { ok: true }> | { ok: false; code: string; detail: string } | null = null
      if (imageChannels.length > 0) {
        poster = await deps.readPoster(input.edition)
        if (!poster.ok) return { ok: false, state: 'failed', code: poster.code, detail: poster.detail, channels: [] }
      }

      const channels: PosterChannelOutcome[] = []
      for (const channel of targets) {
        channels.push(await sendTo(channel))
      }

      const aggregate = aggregatePushDelivery(channels)
      return {
        ok: aggregate.state !== 'failed',
        state: aggregate.state,
        code: aggregate.reason ?? null,
        channels
      }

      async function sendTo(channel: PosterChannel): Promise<PosterChannelOutcome> {
        const base = { channelId: channel.id, channelName: channel.name, at }
        if (!channel.agentId) {
          // 一条通道没绑定目标只影响它自己那一行。
          return { ...base, kind: input.mode === 'text' ? 'text' : channel.supportsImage ? 'image' : 'text', state: 'failed', reason: 'delivery-no-target-bound' }
        }
        try {
          if (input.mode !== 'text' && channel.supportsImage && poster !== null && poster.ok) {
            const result = await deps.deliverImageToEnabledTargets({
              channelId: channel.id,
              agentId: channel.agentId,
              source: 'agent-notify',
              sourceId: channelPosterSourceId(input.recordId),
              image: { mime: poster.mime, bytes: poster.bytes },
              caption: input.caption
            })
            return { ...base, kind: 'image', ...outcomeOf(result) }
          }
          const result = await deps.deliverTextToEnabledTargets({
            channelId: channel.id,
            agentId: channel.agentId,
            source: 'agent-notify',
            sourceId: channelPosterTextSourceId(input.recordId),
            text: input.caption
          })
          return { ...base, kind: 'text', ...outcomeOf(result) }
        } catch {
          // 单通道异常只记它自己失败（与通知扇出同一口径）。
          return { ...base, kind: input.mode === 'text' ? 'text' : channel.supportsImage ? 'image' : 'text', state: 'failed', reason: 'channel-rejected' }
        }
      }
    }
  }
}

/** 通道投递结果 → 四档（与通知那条映射同词）：受理=accepted，未确认=unconfirmed，其余按失败/排队。 */
function outcomeOf(results: readonly ChannelDeliveryResult[]): { state: NotificationDeliveryPathState; reason?: string } {
  const result = results[0]
  if (result === undefined) return { state: 'failed', reason: 'delivery-no-target-bound' }
  const state: NotificationDeliveryPathState = result.status === 'delivered'
    ? 'sent-accepted'
    : result.status === 'unknown-after-send'
      ? 'sent-unconfirmed'
      : result.status === 'pending' || result.status === 'sending' ? 'queued' : 'failed'
  return { state, ...(result.errorCode === null ? {} : { reason: result.errorCode }) }
}
