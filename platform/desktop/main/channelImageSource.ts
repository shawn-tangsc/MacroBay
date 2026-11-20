import { sniffImageMime } from '../../ai/agent-platform/channels/channelImageDelivery'
import type { ReadPosterOutcome, ChannelPosterEdition } from '../../storage/channelPosterOutbox'

/**
 * 出站图片的**读盘入口**（主进程唯一一处）。
 *
 * 投递层只收字节，不认识路径、目录、hash：适配器保持「字节进、结果出」，测试不需要文件系统。
 * 这里做两件事，顺序不能反：
 * 1. **来源校验**：这张图必须由「这条助手消息自己带着」。`generated-images/` 里同时躺着生成结果
 *    与编辑原图（`prepare()` 写的是用户消息），按目录或按 mime 判会把编辑原图放出去；
 * 2. 读盘并嗅探真实格式（声明 mime 不可信：供应商可能声明 png 实际吐 webp）。
 *
 * 失败码分开：「图不在了」= `delivery-image-unavailable` + detail `missing`；
 * 「在但读不出来」= 同一个码 + detail `read-failed`；「这张图不许发」= `delivery-image-source-not-allowed`。
 */
type MessagePart = { type?: unknown; fileName?: unknown }
type MessageLike = { role?: unknown; status?: unknown; data?: { parts?: unknown } }

/**
 * 出站图片的**来源**：判别联合，互不借用（方案 §2）。
 *
 * 两种来源的判据完全不同，所以用 `kind` 分开而不是「有空就看那张图」：
 * - `assistant-message`：这条助手消息自己带着这张图（`{messageId, fileName}`，行为原样）；
 * - `briefing-poster`：日报海报的暂存记录，且**版本必须就是这次发布**——调用方只能给
 *   `{date, periodId, locale}`，路径与文件名永远由主进程拼（给不出路径，也就伪造不了）。
 */
export type ChannelImageSourceRequest =
  | { kind: 'assistant-message'; messageId: string; fileName: string }
  | { kind: 'briefing-poster'; edition: ChannelPosterEdition }

export type ChannelImageSourceResult =
  | { ok: true; mime: string; bytes: Uint8Array }
  | { ok: false; code: 'delivery-image-unavailable' | 'delivery-image-source-not-allowed'; detail: string }

export type ChannelImageSource = {
  resolve: (input: ChannelImageSourceRequest) => Promise<ChannelImageSourceResult>
}

export function createChannelImageSource(deps: {
  /** 只读、只认 hash 形状文件名（路径穿越在 storage 入口已被拒）。 */
  read: (fileName: string) => Promise<{ bytes: Uint8Array; mime: string } | null>
  /** 消息仓储：用已有的 `messages.getById`，不新开查询。 */
  getMessage: (messageId: string) => MessageLike | null
  /** 日报海报的暂存区读入口（主进程同一处）；没装时海报那一支一律「没有」，不猜。 */
  readPoster?: (edition: ChannelPosterEdition) => Promise<ReadPosterOutcome>
}): ChannelImageSource {
  return {
    async resolve(input) {
      // 第二种来源：按暂存记录 + 版本绑定，绝不按目录判（方案 §2 第三条）。
      if (input.kind === 'briefing-poster') {
        if (deps.readPoster === undefined) {
          return { ok: false, code: 'delivery-image-unavailable', detail: 'poster-outbox-unavailable' }
        }
        const poster = await deps.readPoster(input.edition)
        if (!poster.ok) {
          // 来源被拒（版本对不上）与「图不在了/读不出」是两种处境，码分开给。
          return poster.code === 'delivery-image-source-not-allowed'
            ? { ok: false, code: 'delivery-image-source-not-allowed', detail: poster.detail }
            : { ok: false, code: 'delivery-image-unavailable', detail: poster.detail }
        }
        return { ok: true, mime: poster.mime, bytes: poster.bytes }
      }
      const message = deps.getMessage(input.messageId)
      if (!message) {
        return { ok: false, code: 'delivery-image-source-not-allowed', detail: 'message-not-found' }
      }
      if (message.role !== 'assistant') {
        return { ok: false, code: 'delivery-image-source-not-allowed', detail: `role=${String(message.role)}` }
      }
      if (message.status !== 'success') {
        return { ok: false, code: 'delivery-image-source-not-allowed', detail: `status=${String(message.status)}` }
      }
      const parts = Array.isArray(message.data?.parts) ? message.data.parts as MessagePart[] : []
      // 判据是「这条助手消息自己带着这张图」，不是「有张图属于某条助手消息」。
      const part = parts.find((candidate) => candidate.type === 'image' && candidate.fileName === input.fileName)
      if (!part) {
        return { ok: false, code: 'delivery-image-source-not-allowed', detail: 'part-mismatch' }
      }

      let stored: { bytes: Uint8Array; mime: string } | null
      try {
        stored = await deps.read(input.fileName)
      } catch {
        // 「在但读不出来」——与「没有」分开。
        return { ok: false, code: 'delivery-image-unavailable', detail: 'read-failed' }
      }
      if (!stored) return { ok: false, code: 'delivery-image-unavailable', detail: 'missing' }
      // 真实格式以字节为准；认不出就交回声明值，投递层仍会按字节判并给 unsupported。
      return { ok: true, mime: sniffImageMime(stored.bytes) ?? stored.mime, bytes: stored.bytes }
    }
  }
}
