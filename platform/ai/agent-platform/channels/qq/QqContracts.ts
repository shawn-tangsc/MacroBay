export const qqApiBase = 'https://api.sgroup.qq.com'

export type QqProviderConversation = { kind: 'direct' | 'group' | 'channel'; id: string }

/** QQ conversation material is adapter-private encrypted C03 state. */
export function encodeQqConversation(input: QqProviderConversation): string | null {
  return /^[A-Za-z0-9_-]{1,256}$/.test(input.id) ? `qq:conversation:${input.kind}:${input.id}` : null
}

export function decodeQqConversation(value: string): QqProviderConversation | null {
  const match = /^qq:conversation:(direct|group|channel):([A-Za-z0-9_-]{1,256})$/.exec(value)
  return match ? { kind: match[1] as QqProviderConversation['kind'], id: match[2]! } : null
}

export function splitQqText(text: string): string[] {
  if (!text) return ['']
  const parts: string[] = []
  for (let index = 0; index < text.length; index += 4_000) parts.push(text.slice(index, index + 4_000))
  return parts
}

export type QqInboundFact = {
  eventKey: string
  conversationKey: string
  userKey: string
  conversationKind: 'direct' | 'group' | 'channel'
  mentionedBot: boolean
  text?: string
  attachments?: Array<{ kind: 'image' | 'file'; stableRef: string; mimeType: string; name?: string; sizeBytes?: number }>
}
