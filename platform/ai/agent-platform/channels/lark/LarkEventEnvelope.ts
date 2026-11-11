import type { LarkLongConnectionEvent } from './LarkLongConnectionClient'

/**
 * 飞书事件体（schema 2.0）→ `normalizeLarkEvent` 认识的有界中间形状。
 *
 * 为什么单独一层：SDK 给的是官方事件体（`{ schema: '2.0', header: {...}, event: { sender, message } }`），
 * 而平台那一侧只认我们自己的字段。把「取哪几个字段」写在调用点，换实现时就要改契约。
 *
 * 判据（官方「事件格式 v2.0」与 `im.message.receive_v1`）：
 * - 去重键来自 `header.event_id`，消息键来自 `message.message_id`；
 * - **自己发的消息不回**：`event.sender.sender_type === 'app'`（机器人账号）直接忽略；
 * - 会话键 `chat_id`，私聊 `chat_type: 'p2p'`，群里只有被 @ 才算「叫我」；
 * - 正文只认 `message_type === 'text'` 的 `content` JSON 里的 `text`；图片/文件只留 `image_key`/`file_key`，
 *   附件体里没有任何 URL 可留（官方事件不带下载地址）。
 */
export type LarkMessageSeam = {
  event_id: string
  message_id: string
  chat_id: string
  thread_id?: string
  chat_type: 'p2p' | 'group' | 'topic'
  user_id: string
  mentioned_bot: boolean
  text?: string
  attachments?: Array<{ kind: 'image' | 'file'; file_key: string; mime_type: string; size?: number }>
}

export type LarkMessageRead =
  | { kind: 'message'; seam: LarkMessageSeam }
  | { kind: 'ignored' }
  | { kind: 'invalid' }

export function readLarkMessageEvent(event: LarkLongConnectionEvent): LarkMessageRead {
  if (event.eventType !== 'im.message.receive_v1') return { kind: 'ignored' }
  const payload = event.payload as {
    /** SDK 摊平后的真实形状：sender/message 直接在顶层。 */
    sender?: { sender_type?: unknown; sender_id?: { open_id?: unknown; user_id?: unknown } }
    message?: {
      message_id?: unknown
      chat_id?: unknown
      chat_type?: unknown
      message_type?: unknown
      content?: unknown
      mentions?: unknown
      thread_id?: unknown
    }
    event?: {
      sender?: { sender_type?: unknown; sender_id?: { open_id?: unknown; user_id?: unknown } }
      message?: {
        message_id?: unknown
        chat_id?: unknown
        chat_type?: unknown
        message_type?: unknown
        content?: unknown
        mentions?: unknown
        thread_id?: unknown
      }
    }
  } | null
  // 顶层优先（SDK 摊平形状），嵌套兜底（webhook 形态与既有用例）。
  const message = payload?.message ?? payload?.event?.message
  const sender = payload?.sender ?? payload?.event?.sender
  // 机器人自己发出去的那条也会被推回来：忽略，且不记成坏帧。
  if (sender?.sender_type === 'app') return { kind: 'ignored' }
  const eventId = identifier(event.eventId)
  const messageId = identifier(message?.message_id)
  const chatId = identifier(message?.chat_id)
  const userId = identifier(sender?.sender_id?.open_id) ?? identifier(sender?.sender_id?.user_id)
  const chatType = message?.chat_type === 'p2p' || message?.chat_type === 'group' || message?.chat_type === 'topic'
    ? message.chat_type
    : null
  if (!eventId || !messageId || !chatId || !userId || !chatType) return { kind: 'invalid' }

  const content = readContent(message?.content)
  const text = message?.message_type === 'text' && typeof content?.text === 'string' ? content.text : undefined
  const attachments = readAttachments(content)
  const threadId = identifier(message?.thread_id)
  const mentions = Array.isArray(message?.mentions) ? message.mentions : []

  return {
    kind: 'message',
    seam: {
      event_id: eventId,
      message_id: messageId,
      chat_id: chatId,
      ...(threadId ? { thread_id: threadId } : {}),
      chat_type: chatType,
      user_id: userId,
      // 私聊天然是找机器人；群里要有 @ 才算。事件里带 mentions 就说明被 @ 了。
      mentioned_bot: chatType === 'p2p' || mentions.length > 0,
      ...(text === undefined ? {} : { text }),
      ...(attachments.length === 0 ? {} : { attachments })
    }
  }
}

function readContent(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64_000) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function readAttachments(content: Record<string, unknown> | null): NonNullable<LarkMessageSeam['attachments']> {
  if (!content) return []
  // 官方图片/文件消息的 content 形如 `{"image_key":"img_v2_..."}` / `{"file_key":"file_v2_..."}`。
  const imageKey = identifier(content.image_key)
  const fileKey = identifier(content.file_key)
  if (imageKey) return [{ kind: 'image', file_key: imageKey, mime_type: 'image/*' }]
  if (fileKey) return [{ kind: 'file', file_key: fileKey, mime_type: 'application/octet-stream' }]
  return []
}

function identifier(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value) ? value : null
}
