import type { TelegramMessage, TelegramNormalizedUpdate, TelegramUpdate } from './TelegramContracts'
import { stableTelegramAttachment } from './TelegramContracts'

export function normalizeTelegramUpdate(update: TelegramUpdate, botUsername?: string): TelegramNormalizedUpdate | null {
  if (!Number.isSafeInteger(update.update_id) || update.update_id < 0) return null
  const message = update.message ?? update.channel_post
  if (!message || !isMessage(message)) return null
  const conversationKind = message.chat.type === 'private' ? 'direct' : message.chat.type === 'channel' ? 'channel' : 'group'
  const text = (message.text ?? message.caption)?.slice(0, 64 * 1024)
  const entities = message.entities ?? message.caption_entities ?? []
  // Group authorization relies on Telegram entity offsets, not unstructured text matching.
  const mentionedBot = conversationKind === 'direct' || Boolean(botUsername && entities.some((entity) =>
    entity.type === 'mention' && text?.slice(entity.offset, entity.offset + entity.length).toLowerCase() === `@${botUsername.toLowerCase()}`
  ))
  const photo = message.photo?.at(-1)
  const attachments = [
    photo ? stableTelegramAttachment({ kind: 'image', fileId: photo.file_id, mimeType: photo.mime_type, size: photo.file_size }) : null,
    message.document ? stableTelegramAttachment({ kind: 'file', fileId: message.document.file_id, name: message.document.file_name, mimeType: message.document.mime_type, size: message.document.file_size }) : null
  ].filter((attachment): attachment is NonNullable<typeof attachment> => Boolean(attachment))
  const userLabel = (message.from?.first_name ?? message.from?.username ?? '').trim().slice(0, 128)
  return {
    eventKey: `telegram:update:${update.update_id}`,
    messageKey: `telegram:message:${message.message_id}`,
    conversationKey: `telegram:chat:${message.chat.id}`,
    userKey: `telegram:user:${message.from?.id ?? message.chat.id}`,
    ...(userLabel ? { userLabel } : {}),
    conversationKind,
    mentionedBot,
    ...(text ? { text } : {}),
    ...(attachments.length ? { attachments } : {})
  }
}

function isMessage(value: TelegramMessage): boolean {
  return Number.isSafeInteger(value.message_id) && value.chat && (typeof value.chat.id === 'string' || Number.isSafeInteger(value.chat.id))
}
