import type { ChannelVerifiedInboundAttachment } from '../ChannelInboundContracts'

export type TelegramApiFailure =
  | 'telegram-rate-limited'
  | 'telegram-conflict'
  | 'telegram-provider-rejected'
  | 'telegram-network-unavailable'

export type TelegramApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: TelegramApiFailure; retryAfterMs?: number; parseRejected?: boolean }

export type TelegramUpdate = {
  update_id: number
  message?: TelegramMessage
  channel_post?: TelegramMessage
}

export type TelegramMessage = {
  message_id: number
  chat: { id: number | string; type: 'private' | 'group' | 'supergroup' | 'channel' }
  from?: { id: number | string }
  text?: string
  caption?: string
  entities?: Array<{ type: string; offset: number; length: number }>
  caption_entities?: Array<{ type: string; offset: number; length: number }>
  photo?: Array<{ file_id: string; file_size?: number; mime_type?: string }>
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number }
}

export type TelegramNormalizedUpdate = {
  eventKey: string
  messageKey: string
  conversationKey: string
  userKey: string
  conversationKind: 'direct' | 'group' | 'channel'
  mentionedBot: boolean
  text?: string
  attachments?: ChannelVerifiedInboundAttachment[]
}

export const telegramApiBase = 'https://api.telegram.org'

export function splitTelegramText(text: string, maxUnits = 4096): string[] {
  const source = text.trim()
  if (!source) return []
  const result: string[] = []
  let current = ''
  let units = 0
  for (const part of source) {
    const width = part.length // JS string length is Telegram's UTF-16 unit metric.
    if (current && units + width > maxUnits) {
      result.push(current)
      current = ''
      units = 0
    }
    current += part
    units += width
  }
  if (current) result.push(current)
  return result
}

export function stableTelegramAttachment(input: { kind: 'image' | 'file'; fileId: unknown; name?: unknown; mimeType?: unknown; size?: unknown }): ChannelVerifiedInboundAttachment | null {
  if (typeof input.fileId !== 'string' || !input.fileId.trim() || input.fileId.length > 384) return null
  if (
    input.size !== undefined &&
    (typeof input.size !== 'number' || !Number.isSafeInteger(input.size) || input.size < 0 || input.size > 50 * 1024 * 1024)
  ) return null
  const sizeBytes = typeof input.size === 'number' ? input.size : undefined
  const mimeType = typeof input.mimeType === 'string' && input.mimeType.trim().length <= 255
    ? input.mimeType.trim()
    : input.kind === 'image' ? 'image/jpeg' : 'application/octet-stream'
  const name = typeof input.name === 'string' && input.name.trim().length <= 255 ? input.name.trim() : undefined
  return { kind: input.kind, stableRef: `telegram:file:${input.fileId}`, ...(name ? { name } : {}), mimeType, ...(sizeBytes === undefined ? {} : { sizeBytes }) }
}
