import {
  channelImageBareSourceId,
  channelImageSourceId,
  type ChannelDeliveryResult,
  type ChannelImageDeliveryRequest
} from '../../ai/agent-platform/channels/ChannelDeliveryContracts'
import type { NotificationDeliveryPathState } from '../../notifications/contracts/notificationContracts'
import { aggregatePushDelivery } from '../../notifications/delivery/aggregatePushDelivery'
import type { ChannelImageSource } from './channelImageSource'

/**
 * 「把助手聊天里的这张图发到频道」的主进程装配（多通道方案 §4b 定稿 A：发到所有已启用通道）。
 *
 * 只做四件事：找到可发图的通道（`runtime-ready` **且** 适配器声明支持图片）、让
 * `channelImageSource` 校验来源并**只读一次盘**、对每条通道各投一次、把逐通道结果聚合成一个总括。
 *
 * 三条不在这里重判的事：
 * - 谁可用：`runtime-ready` 这一档（与推送同一个派生口径），支持图片来自 router 的那一处能力声明；
 * - 目标解析与跳过码：`deliverImageToEnabledTargets` 与文本版同形、同一套码；
 * - 聚合：与通知扇出用**同一个** `aggregatePushDelivery`，图片不单开一套判定。
 *
 * 字节**只读一次**：`resolveImage` 在循环外调用一次，同一个 `Uint8Array` 交给每条通道；
 * 每通道读一遍盘不仅浪费，还会让「文件在中途被删」变成人为的部分成功。
 */
export type ChannelImageSendChannel = { id: string; agentId: string | null; state: string; supportsImage: boolean }

/** 逐通道结果：谁、成没成、为什么。`code` 是通道侧的原因码（读者可见的句子在界面那侧）。 */
export type ChannelImageChannelOutcome = {
  channelId: string
  channelName?: string
  state: NotificationDeliveryPathState
  code?: string
}

export type ChannelImageSendResult = {
  ok: boolean
  state: NotificationDeliveryPathState
  code: string | null
  channels: readonly ChannelImageChannelOutcome[]
  /** 没发出任何一条时的**配置事实**说明（不是宿主故障）。 */
  detail?: string
}

export function createChannelImageSend(deps: {
  /** 同一条助手消息的正文，作为 caption；超长由投递层拒绝（整条不发）。 */
  captionFor?: (messageId: string) => string
  listChannels: () => readonly ChannelImageSendChannel[]
  resolveImage: ChannelImageSource['resolve']
  deliverImageToEnabledTargets: (input: Omit<ChannelImageDeliveryRequest, 'conversationId'>) => Promise<ChannelDeliveryResult[]>
}): {
  send: (input: { messageId: string; fileName: string; withoutCaption?: boolean }) => Promise<ChannelImageSendResult>
} {
  return {
    async send(input) {
      // 只对「可发图」的通道各产生一条尝试：不支持的通道**不产生尝试、也不算失败**。
      const targets = deps.listChannels().filter((channel) => channel.state === 'runtime-ready' && channel.supportsImage)
      if (targets.length === 0) {
        // 配置事实：没有可发图的通道。不冒用 `delivery-host-unavailable`（那是「拿不到」，不是「没配」）。
        return { ok: false, state: 'failed', code: 'delivery-no-target-bound', detail: 'no-image-capable-channel', channels: [] }
      }

      // **一次**读盘 + 一次嗅探；下面每通道复用同一份字节。
      const resolved = await deps.resolveImage({ kind: 'assistant-message', messageId: input.messageId, fileName: input.fileName })
      if (!resolved.ok) return { ok: false, state: 'failed', code: resolved.code, detail: resolved.detail, channels: [] }

      const caption = input.withoutCaption === true ? '' : captionFor(deps, input)
      const sourceId = input.withoutCaption === true ? channelImageBareSourceId(input.messageId) : channelImageSourceId(input.messageId)
      const outcomes: ChannelImageChannelOutcome[] = []
      for (const channel of targets) {
        if (!channel.agentId) {
          // 一条通道没绑定目标只影响它自己那一行（§4b-5），不拖垮整条。
          outcomes.push({ channelId: channel.id, state: 'failed', code: 'delivery-no-target-bound' })
          continue
        }
        const result = await deliverTo({
          channelId: channel.id,
          agentId: channel.agentId,
          // 用户在聊天里主动发：沿用 agent-notify（不新增契约成员）。
          source: 'agent-notify',
          sourceId,
          image: { mime: resolved.mime, bytes: resolved.bytes },
          caption
        })
        outcomes.push({ channelId: channel.id, ...result })
      }

      const aggregate = aggregatePushDelivery(outcomes.map((outcome) => ({
        channelId: outcome.channelId,
        state: outcome.state,
        ...(outcome.code === undefined ? {} : { reason: outcome.code }),
        at: ''
      })))
      return {
        ok: aggregate.state !== 'failed',
        state: aggregate.state,
        // 总括原因只在**全败**时写（与聚合规则一致）；部分失败时原因在 `channels[]` 里，
        // 抬一个原因上来会让读者以为整条都没发出去。
        code: aggregate.reason ?? null,
        channels: outcomes
      }
    }
  }

  async function deliverTo(
    request: Omit<ChannelImageDeliveryRequest, 'conversationId'>
  ): Promise<Omit<ChannelImageChannelOutcome, 'channelId'>> {
    try {
      const results = await deps.deliverImageToEnabledTargets(request)
      const result = results[0]
      if (result === undefined) return { state: 'failed', code: 'delivery-no-target-bound' }
      return {
        state: stateOf(result),
        ...(result.errorCode === null ? {} : { code: result.errorCode })
      }
    } catch {
      // 单通道异常只记它自己失败（与通知扇出同一口径）。
      return { state: 'failed', code: 'channel-rejected' }
    }
  }
}

/** 通道投递结果 → 四档（与通知那条映射同词）：受理=accepted，未确认=unconfirmed，其余按失败/排队。 */
function stateOf(result: ChannelDeliveryResult): NotificationDeliveryPathState {
  if (result.status === 'delivered') return 'sent-accepted'
  if (result.status === 'unknown-after-send') return 'sent-unconfirmed'
  if (result.status === 'pending' || result.status === 'sending') return 'queued'
  return 'failed'
}

/** 说明来自同一条助手消息的正文（`message.text`）；调用方没提供就空。 */
function captionFor(deps: { captionFor?: (messageId: string) => string }, input: { messageId: string; fileName: string }): string {
  void input.fileName
  return deps.captionFor?.(input.messageId) ?? ''
}
