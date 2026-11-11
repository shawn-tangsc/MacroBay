/**
 * QQ 网关推来的消息事件 → `normalizeQqEvent` 认识的有界中间形状。
 *
 * 为什么单独一层：`normalizeQqEvent` 吃的是「已经压好」的字段，而网关给的是三种不同的事件体
 * （官方「通用数据结构」+ 各消息事件的 `d`）：
 * - `GROUP_AT_MESSAGE_CREATE`：群里 @ 机器人，`{ id, content, group_openid, author: { id, member_openid } }`；
 * - `C2C_MESSAGE_CREATE`：单聊，`{ id, content, author: { id, user_openid } }`；
 * - `AT_MESSAGE_CREATE`：频道（guild）里 @ 机器人，`{ id, content, channel_id, guild_id, author: { id } }`。
 *
 * 三条判据：
 * - 去重键来自**事件本身**（消息 `id`）；
 * - 只有「@ 了机器人」的三种事件才进来，别的 dispatch（成员变动、表情）不进管道；
 * - 附件只留 mime / 名字 / 大小，**URL 一律丢掉**；QQ 的附件**没有 id**，所以稳定引用用
 *   `消息 id + 序号` 拼——它仍然来自事件本身，不是时间戳。
 */
import { boundedOpaqueId } from './qqOpaqueId'

export type QqMessageSeam = {
  id: string
  author_id: string
  conversation_id: string
  kind: 'direct' | 'group' | 'channel'
  content?: string
  mentioned_bot: boolean
  attachments?: Array<{ id: string; kind: 'image' | 'file'; mime_type: string; name?: string; size?: number }>
}

export type QqMessageRead =
  | { kind: 'message'; seam: QqMessageSeam }
  | { kind: 'ignored' }
  /** 坏帧要说出**是哪一项**读不出来：id / author / conversation 各自对应完全不同的修法。 */
  | { kind: 'invalid'; field: 'payload' | 'id' | 'author' | 'conversation' }

const MESSAGE_EVENTS = ['GROUP_AT_MESSAGE_CREATE', 'C2C_MESSAGE_CREATE', 'AT_MESSAGE_CREATE'] as const

export function isQqMessageEvent(event: string): boolean {
  return (MESSAGE_EVENTS as readonly string[]).includes(event)
}

export function readQqMessageCreate(event: string, value: unknown): QqMessageRead {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'invalid', field: 'payload' }
  const message = value as Record<string, unknown>
  const id = identifier(message.id)
  const author = message.author as { id?: unknown; member_openid?: unknown; user_openid?: unknown; bot?: unknown } | undefined
  if (!id) return { kind: 'invalid', field: 'id' }
  if (!author) return { kind: 'invalid', field: 'author' }
  // 别的机器人发的：不回，也不算坏帧。
  if (author.bot === true) return { kind: 'ignored' }

  if (event === 'GROUP_AT_MESSAGE_CREATE') {
    const groupId = identifier(message.group_openid)
    const authorId = identifier(author.member_openid) ?? identifier(author.id)
    if (!groupId) return { kind: 'invalid', field: 'conversation' }
    if (!authorId) return { kind: 'invalid', field: 'author' }
    return { kind: 'message', seam: seamOf(id, authorId, groupId, 'group', message) }
  }
  if (event === 'C2C_MESSAGE_CREATE') {
    const authorId = identifier(author.user_openid) ?? identifier(author.id)
    if (!authorId) return { kind: 'invalid', field: 'author' }
    return { kind: 'message', seam: seamOf(id, authorId, authorId, 'direct', message) }
  }
  // AT_MESSAGE_CREATE：频道消息，会话键是 channel_id。
  const channelId = identifier(message.channel_id)
  const authorId = identifier(author.id)
  if (!channelId) return { kind: 'invalid', field: 'conversation' }
  if (!authorId) return { kind: 'invalid', field: 'author' }
  return { kind: 'message', seam: seamOf(id, authorId, channelId, 'channel', message) }
}

function seamOf(
  id: string,
  authorId: string,
  conversationId: string,
  kind: QqMessageSeam['kind'],
  message: Record<string, unknown>
): QqMessageSeam {
  const content = typeof message.content === 'string' ? message.content : undefined
  const attachments = readAttachments(id, message.attachments)
  return {
    id,
    author_id: authorId,
    conversation_id: conversationId,
    kind,
    ...(content === undefined ? {} : { content }),
    // 这三种事件本身就是「@ 了机器人」才推过来的（单聊按私信处理）。
    mentioned_bot: true,
    ...(attachments.length === 0 ? {} : { attachments })
  }
}

function readAttachments(messageId: string, value: unknown): NonNullable<QqMessageSeam['attachments']> {
  if (!Array.isArray(value)) return []
  const result: NonNullable<QqMessageSeam['attachments']> = []
  for (const [index, entry] of value.slice(0, 8).entries()) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    const mimeType = typeof item.content_type === 'string' && item.content_type.length > 0 && item.content_type.length <= 255
      ? item.content_type
      : null
    if (!mimeType) continue
    const name = typeof item.filename === 'string' && item.filename.length > 0 && item.filename.length <= 255 ? item.filename : undefined
    const size = Number.isSafeInteger(item.size) && (item.size as number) >= 0 ? item.size as number : undefined
    result.push({
      // QQ 附件没有 id：稳定引用来自「哪条消息的第几个附件」，仍然由事件本身决定。
      id: `${messageId}_${index}`,
      kind: mimeType.startsWith('image/') ? 'image' : 'file',
      mime_type: mimeType,
      ...(name === undefined ? {} : { name }),
      ...(size === undefined ? {} : { size })
    })
  }
  return result
}

function identifier(value: unknown): string | null {
  return boundedOpaqueId(value)
}
