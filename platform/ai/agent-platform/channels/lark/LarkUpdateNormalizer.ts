import { encodeLarkConversation, type LarkInboundFact } from './LarkContracts'

/** Accepts a small structured test seam only; raw Lark event bodies never cross into C03. */
export function normalizeLarkEvent(value: unknown): LarkInboundFact | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const event = value as Record<string, unknown>
  const eventId = bounded(event.event_id)
  const messageId = bounded(event.message_id)
  const chatId = bounded(event.chat_id)
  const userId = bounded(event.user_id)
  const conversationKey = chatId ? encodeLarkConversation({ chatId, threadId: bounded(event.thread_id) }) : null
  if (!eventId || !chatId || !userId || !conversationKey) return null
  const kind = event.chat_type === 'p2p' ? 'direct' : event.chat_type === 'group' ? 'group' : event.chat_type === 'channel' ? 'channel' : null
  if (!kind) return null
  const text = typeof event.text === 'string' ? event.text.slice(0, 16_000) : undefined
  const attachments = Array.isArray(event.attachments)
    ? event.attachments.map(attachment).filter((item): item is NonNullable<typeof item> => Boolean(item)).slice(0, 8)
    : []
  return {
    eventKey: `lark:event:${eventId}`,
    ...(messageId ? { messageKey: `lark:message:${messageId}` } : {}),
    conversationKey, userKey: `lark:user:${userId}`, conversationKind: kind,
    mentionedBot: kind === 'direct' || event.mentioned_bot === true,
    ...(text === undefined ? {} : { text }), ...(attachments.length ? { attachments } : {})
  }
}

function attachment(value: unknown): { kind: 'image' | 'file'; stableRef: string; mimeType: string; name?: string; sizeBytes?: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  const id = bounded(item.file_key)
  const mime = bounded(item.mime_type, 255)
  if (!id || !mime || (item.kind !== 'image' && item.kind !== 'file')) return null
  const size = Number.isSafeInteger(item.size) && (item.size as number) >= 0 ? item.size as number : undefined
  return { kind: item.kind === 'image' ? 'image' : 'file', stableRef: `lark:file:${id}`, mimeType: mime, ...(size === undefined ? {} : { sizeBytes: size }) }
}

function bounded(value: unknown, max = 256): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value) ? value : null
}
