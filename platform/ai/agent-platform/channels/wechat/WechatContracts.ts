export type WechatProviderConversation = { kind: 'direct' | 'group'; id: string }

/** Provider conversation keys remain encrypted C03 payload until delivery decodes them. */
export function encodeWechatConversation(input: WechatProviderConversation): string | null {
  return /^[A-Za-z0-9_-]{1,256}$/.test(input.id) ? `wechat:conversation:${input.kind}:${input.id}` : null
}

export function decodeWechatConversation(value: string): WechatProviderConversation | null {
  const match = /^wechat:conversation:(direct|group):([A-Za-z0-9_-]{1,256})$/.exec(value)
  return match ? { kind: match[1] as WechatProviderConversation['kind'], id: match[2]! } : null
}

/** The official message budget is not frozen, so Release F keeps a tested conservative final-text limit. */
export function splitWechatText(text: string): string[] {
  if (!text) return ['']
  const parts: string[] = []
  for (let index = 0; index < text.length; index += 2_000) parts.push(text.slice(index, index + 2_000))
  return parts
}

export type WechatInboundFact = {
  eventKey: string
  conversationKey: string
  userKey: string
  conversationKind: 'direct' | 'group'
  mentionedBot: boolean
  text?: string
  attachments?: Array<{ kind: 'image' | 'file'; stableRef: string; mimeType: string; name?: string; sizeBytes?: number }>
}
