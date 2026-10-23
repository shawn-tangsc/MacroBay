import { encodeSlackConversation, type SlackInboundFact, type SlackSocketEnvelope } from './SlackContracts'

/** Produces only bounded facts; the original Socket Mode envelope is never persisted. */
export function normalizeSlackEnvelope(envelope: SlackSocketEnvelope, botUserId: string): SlackInboundFact | null {
  if (!isBounded(envelope.envelope_id)) return null
  if (envelope.type === 'slash_commands') return normalizeSlashCommand(envelope)
  if (envelope.type !== 'events_api') return null
  const event = envelope.payload?.event
  if (!event || event.type !== 'message' || event.subtype !== undefined) return null
  const channel = string(event.channel)
  const user = string(event.user)
  const eventId = string(envelope.payload?.event_id)
  const conversationKey = channel ? encodeSlackConversation({ channelId: channel, threadTs: isThreadTs(event.thread_ts) ? event.thread_ts : null }) : null
  if (!conversationKey || !user || !eventId) return null
  const text = typeof event.text === 'string' ? event.text.slice(0, 16_000) : undefined
  const files = Array.isArray(event.files) ? event.files.map(attachment).filter((value): value is NonNullable<typeof value> => Boolean(value)).slice(0, 8) : []
  const kind = event.channel_type === 'im' ? 'direct' : event.channel_type === 'group' ? 'group' : 'channel'
  return {
    eventKey: `slack:event:${eventId}`,
    messageKey: isBounded(event.ts) ? `slack:message:${event.ts}` : undefined,
    conversationKey,
    userKey: `slack:user:${user}`,
    conversationKind: kind,
    mentionedBot: kind === 'direct' || Boolean(text && botUserId && text.includes(`<@${botUserId}>`)),
    ...(text === undefined ? {} : { text }),
    ...(files.length ? { attachments: files } : {})
  }
}

function normalizeSlashCommand(envelope: SlackSocketEnvelope): SlackInboundFact | null {
  const payload = envelope.payload as Record<string, unknown> | undefined
  const channel = string(payload?.channel_id)
  const user = string(payload?.user_id)
  const command = string(payload?.command)
  const text = typeof payload?.text === 'string' ? payload.text.slice(0, 16_000) : ''
  const conversationKey = channel ? encodeSlackConversation({ channelId: channel, threadTs: null }) : null
  if (!conversationKey || !user || !command) return null
  return {
    eventKey: `slack:command:${envelope.envelope_id}`,
    conversationKey,
    userKey: `slack:user:${user}`,
    conversationKind: 'channel',
    mentionedBot: true,
    text: `${command} ${text}`.trim()
  }
}

function attachment(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const file = value as Record<string, unknown>
  const id = string(file.id)
  const mime = string(file.mimetype)
  if (!id || !mime) return null
  const size = typeof file.size === 'number' && Number.isSafeInteger(file.size) && file.size >= 0 ? file.size : undefined
  return { kind: mime.startsWith('image/') ? 'image' as const : 'file' as const, stableRef: `slack:file:${id}`, mimeType: mime, ...(isBounded(file.name) ? { name: file.name } : {}), ...(size === undefined ? {} : { sizeBytes: size }) }
}

function string(value: unknown): string | null { return isBounded(value) ? value : null }
function isBounded(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f]/.test(value) }
function isThreadTs(value: unknown): value is string { return typeof value === 'string' && /^[0-9]{1,16}\.[0-9]{1,16}$/.test(value) }
