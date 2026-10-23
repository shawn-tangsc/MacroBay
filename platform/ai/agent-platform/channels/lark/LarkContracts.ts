/** Release C accepts only the `lark` public preset, so credentials never cross to a Feishu origin. */
export const larkApiBase = 'https://open.larksuite.com/open-apis'

export type LarkApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'lark-rate-limited' | 'lark-provider-rejected' | 'lark-network-unavailable' }

export type LarkProviderConversation = { chatId: string; threadId: string | null }

export type LarkInboundFact = {
  eventKey: string
  messageKey?: string
  conversationKey: string
  userKey: string
  conversationKind: 'direct' | 'group' | 'channel'
  mentionedBot: boolean
  text?: string
  attachments?: Array<{ kind: 'image' | 'file'; stableRef: string; mimeType: string; name?: string; sizeBytes?: number }>
}

/** Only Lark transport decodes this encrypted C03 conversation material. */
export function encodeLarkConversation(input: LarkProviderConversation): string | null {
  if (!isProviderId(input.chatId) || (input.threadId !== null && !isProviderId(input.threadId))) return null
  return `lark:conversation:chat:${input.chatId}${input.threadId ? `:thread:${input.threadId}` : ''}`
}

export function decodeLarkConversation(value: string): LarkProviderConversation | null {
  const match = /^lark:conversation:chat:([A-Za-z0-9_-]{1,256})(?::thread:([A-Za-z0-9_-]{1,256}))?$/.exec(value)
  return match ? { chatId: match[1]!, threadId: match[2] ?? null } : null
}

export function splitLarkText(text: string): string[] {
  // 4,000 characters is a conservative, fake-tested Release C limit until real smoke proves a larger contract.
  if (!text) return ['']
  const result: string[] = []
  for (let index = 0; index < text.length; index += 4_000) result.push(text.slice(index, index + 4_000))
  return result
}

function isProviderId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,256}$/.test(value)
}
