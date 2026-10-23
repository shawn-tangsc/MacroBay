import { encodeQqConversation, type QqInboundFact } from './QqContracts'

/** A bounded structured gateway seam; raw dispatch payloads never reach C03. */
export function normalizeQqEvent(value: unknown): QqInboundFact | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const event = value as Record<string, unknown>
  const id = key(event.id); const user = key(event.author_id); const kind = event.kind === 'direct' || event.kind === 'group' || event.kind === 'channel' ? event.kind : null
  const conversation = kind ? encodeQqConversation({ kind, id: key(event.conversation_id) ?? '' }) : null
  if (!id || !user || !kind || !conversation) return null
  const text = typeof event.content === 'string' ? event.content.slice(0, 16_000) : undefined
  const attachments = Array.isArray(event.attachments) ? event.attachments.map(attachment).filter((item): item is NonNullable<typeof item> => Boolean(item)).slice(0, 8) : []
  return { eventKey: `qq:event:${id}`, conversationKey: conversation, userKey: `qq:user:${user}`, conversationKind: kind, mentionedBot: kind === 'direct' || event.mentioned_bot === true, ...(text === undefined ? {} : { text }), ...(attachments.length ? { attachments } : {}) }
}
function key(value: unknown): string | null { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value) ? value : null }
function attachment(value: unknown): { kind: 'image' | 'file'; stableRef: string; mimeType: string; name?: string; sizeBytes?: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>; const id = key(item.id); const mime = typeof item.mime_type === 'string' && item.mime_type.length > 0 && item.mime_type.length <= 255 ? item.mime_type : null
  if (!id || !mime || (item.kind !== 'image' && item.kind !== 'file')) return null
  const size = Number.isSafeInteger(item.size) && (item.size as number) >= 0 ? item.size as number : undefined
  const name = typeof item.name === 'string' && item.name.length <= 255 ? item.name : undefined
  return { kind: item.kind === 'image' ? 'image' : 'file', stableRef: `qq:file:${id}`, mimeType: mime, ...(name ? { name } : {}), ...(size === undefined ? {} : { sizeBytes: size }) }
}
