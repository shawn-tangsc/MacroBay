import {
  channelImageBareSourceId,
  channelImageSourceId,
  type ChannelDeliveryResult,
  type ChannelImageDeliveryRequest
} from '../../ai/agent-platform/channels/ChannelDeliveryContracts'
import type { ChannelImageSource } from './channelImageSource'

/**
 * 「把助手聊天里的这张图发到频道」的主进程装配（第四笔）。
 *
 * 只做三件事：找到那条唯一启用的频道、让 `channelImageSource` 校验来源并读盘、交给投递层。
 * 判断本身不在这里复制：选通道用 `runtime-ready` 这一档（与推送同一个派生口径），
 * 目标解析与跳过码由 `ChannelDeliveryService.deliverImageToEnabledTargets` 负责。
 */
export type ChannelImageSendChannel = { id: string; agentId: string | null; state: string }

export type ChannelImageSendResult =
  | { ok: true; channelId: string; status: ChannelDeliveryResult['status']; code: string | null }
  | { ok: false; channelId: string | null; code: string; detail?: string }

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
      // 本版只有一条通道能处于 runtime-ready；0 条（或异常的多条）都按「没有可用的通道宿主」处理。
      const ready = deps.listChannels().filter((channel) => channel.state === 'runtime-ready')
      const channel = ready.length === 1 ? ready[0] : undefined
      if (!channel) return { ok: false, channelId: null, code: 'delivery-host-unavailable', detail: `runtime-ready=${ready.length}` }
      if (!channel.agentId) return { ok: false, channelId: channel.id, code: 'delivery-no-target-bound', detail: 'channel-without-agent' }

      const resolved = await deps.resolveImage({ messageId: input.messageId, fileName: input.fileName })
      if (!resolved.ok) return { ok: false, channelId: channel.id, code: resolved.code, detail: resolved.detail }

      const outcomes = await deps.deliverImageToEnabledTargets({
        channelId: channel.id,
        agentId: channel.agentId,
        // 用户在聊天里主动发：这是「通知类」以外的第七种来源没有闭集成员，沿用 agent-notify（不新增契约成员）。
        source: 'agent-notify',
        // 三个固定键互不覆盖：文字 `<recordId>`、图带说明 `<recordId>:image`、只发图片 `<recordId>:image:bare`。
        // 「只发图片」不是重试那条 caption 失败的尝试——它是一条新尝试，那次 failed 原样留在审计里。
        sourceId: input.withoutCaption === true ? channelImageBareSourceId(input.messageId) : channelImageSourceId(input.messageId),
        image: { mime: resolved.mime, bytes: resolved.bytes },
        caption: input.withoutCaption === true ? '' : captionFor(deps, input),
      })
      const outcome = outcomes[0]
      if (!outcome) return { ok: false, channelId: channel.id, code: 'delivery-host-unavailable', detail: 'no-targets' }
      return { ok: true, channelId: channel.id, status: outcome.status, code: outcome.errorCode }
    }
  }
}

/** 说明来自同一条助手消息的正文（`message.text`）；调用方没提供就空。 */
function captionFor(deps: { captionFor?: (messageId: string) => string }, input: { messageId: string; fileName: string }): string {
  void input.fileName
  return deps.captionFor?.(input.messageId) ?? ''
}
