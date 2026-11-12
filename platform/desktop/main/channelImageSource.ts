import { sniffImageMime } from '../../ai/agent-platform/channels/channelImageDelivery'

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
export type ChannelImageSourceResult =
  | { ok: true; mime: string; bytes: Uint8Array }
  | { ok: false; code: 'delivery-image-unavailable' | 'delivery-image-source-not-allowed'; detail: string }

type MessagePart = { type?: unknown; fileName?: unknown }
type MessageLike = { role?: unknown; status?: unknown; data?: { parts?: unknown } }

export type ChannelImageSource = {
  resolve: (input: { messageId: string; fileName: string }) => Promise<ChannelImageSourceResult>
}

export function createChannelImageSource(deps: {
  /** 只读、只认 hash 形状文件名（路径穿越在 storage 入口已被拒）。 */
  read: (fileName: string) => Promise<{ bytes: Uint8Array; mime: string } | null>
  /** 消息仓储：用已有的 `messages.getById`，不新开查询。 */
  getMessage: (messageId: string) => MessageLike | null
}): ChannelImageSource {
  return {
    async resolve(input) {
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
