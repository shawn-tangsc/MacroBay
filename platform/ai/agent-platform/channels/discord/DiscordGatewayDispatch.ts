/**
 * 网关推来的 `MESSAGE_CREATE` → `normalizeDiscordEvent` 认识的**有界中间形状**。
 *
 * 为什么要有这一层：`normalizeDiscordEvent` 吃的是「已经压好」的字段（`id / author_id /
 * conversation_id / kind / content / mentioned_bot / attachments`），而网关给的是 Discord 自己的
 * Message Object（`{ id, channel_id, guild_id, content, author: { id, bot }, mentions, attachments }`）。
 * 把两者混在一处，等于让「取哪几个字段」这件事散落在调用点。
 *
 * 三条判据：
 * - 去重键来自**事件本身**（`message.id`），不是「时间 + 内容」；
 * - 机器人写的消息（`author.bot === true`，包含我们自己）不进来——否则机器人会回自己的话；
 * - 只留白名单字段，附件只留 id / mime / 名字 / 大小，URL 一律丢掉（协议依据：Resources › Message）。
 */
/**
 * 读到一条消息 / 自己发的回显 / 别的机器人 / 读不懂。四者对序号的处置一样（都算消费），
 * 但对**交付与证据**不一样：
 * - `message`：进管道，投递给助手；
 * - `self-echo`：**不投递**（否则机器人会回自己的话），但它是「出站真的到了 Discord」的现场证据，
 *   验收时要与别人发的那条分开计；
 * - `ignored`：别的机器人发的，不回；
 * - `invalid`：读不懂，记审计。
 */
export type DiscordMessageRead =
  | { kind: 'message'; seam: DiscordMessageSeam }
  | { kind: 'self-echo'; messageId: string; channelId: string }
  | { kind: 'ignored' }
  | { kind: 'invalid' }

export type DiscordMessageSeam = {
  id: string
  author_id: string
  conversation_id: string
  kind: 'direct' | 'guild' | 'thread'
  content?: string
  mentioned_bot: boolean
  attachments?: Array<{ id: string; kind: 'image' | 'file'; mime_type: string; name?: string; size?: number }>
}

export function readDiscordMessageCreate(value: unknown, botUserId: string | null): DiscordMessageRead {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'invalid' }
  const message = value as Record<string, unknown>
  const author = message.author as { id?: unknown; bot?: unknown } | undefined
  const authorId = identifier(author?.id)
  const id = identifier(message.id)
  const channelId = identifier(message.channel_id)
  // 自己发出去又被网关回显的那条：**先认出来**，它与「别的机器人」对证据的意义完全不同。
  if (authorId !== null && botUserId !== null && authorId === botUserId) {
    return id && channelId ? { kind: 'self-echo', messageId: id, channelId } : { kind: 'invalid' }
  }
  // 其余机器人写的消息：不回，也不算坏帧。
  if (author?.bot === true) return { kind: 'ignored' }
  if (!id || !authorId || !channelId) return { kind: 'invalid' }

  // 有 guild 就是频道消息（线程也走 channel_id，那是线程自己的频道）；没有 guild 只能是私信。
  const guildId = identifier(message.guild_id)
  const kind: DiscordMessageSeam['kind'] = guildId ? 'guild' : 'direct'
  const conversationId = guildId ? channelId : authorId

  const mentions = Array.isArray(message.mentions)
    ? message.mentions.flatMap((mention) => {
      const mentionId = identifier((mention as { id?: unknown } | null)?.id)
      return mentionId ? [mentionId] : []
    })
    : []
  const mentionedBot = botUserId !== null && mentions.includes(botUserId)

  const attachments = readAttachments(message.attachments)
  const content = typeof message.content === 'string' ? message.content : undefined

  return {
    kind: 'message',
    seam: {
      id,
      author_id: authorId,
      conversation_id: conversationId,
      kind,
      ...(content === undefined ? {} : { content }),
      mentioned_bot: mentionedBot,
      ...(attachments.length === 0 ? {} : { attachments })
    }
  }
}

function readAttachments(value: unknown): NonNullable<DiscordMessageSeam['attachments']> {
  if (!Array.isArray(value)) return []
  const attachments: NonNullable<DiscordMessageSeam['attachments']> = []
  for (const entry of value.slice(0, 8)) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    const id = identifier(item.id)
    const mimeType = typeof item.content_type === 'string' && item.content_type.length > 0 && item.content_type.length <= 255
      ? item.content_type
      : null
    if (!id || !mimeType) continue
    const name = typeof item.filename === 'string' && item.filename.length > 0 && item.filename.length <= 255 ? item.filename : undefined
    const size = Number.isSafeInteger(item.size) && (item.size as number) >= 0 ? item.size as number : undefined
    attachments.push({
      id,
      kind: mimeType.startsWith('image/') ? 'image' : 'file',
      mime_type: mimeType,
      ...(name === undefined ? {} : { name }),
      ...(size === undefined ? {} : { size })
    })
  }
  return attachments
}

function identifier(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value) ? value : null
}
