import { boundedOpaqueId } from './qqOpaqueId'

export const qqApiBase = 'https://api.sgroup.qq.com'

export type QqProviderConversation = { kind: 'direct' | 'group' | 'channel'; id: string }

/** QQ conversation material is adapter-private encrypted C03 state. */
/**
 * 会话键的 id 也是对方给的不透明值：QQ 的 openid / channel_id 可能带 `.`、`=` 之类，
 * 白名单会把真会话判坏（消息进不来，回复也发不出去）。判据与 `boundedOpaqueId` 同一份：
 * 有界、非空、无控制字符；分隔符本身（`:`）不允许出现在 id 里，否则拼出来的键读不回来。
 */
export function encodeQqConversation(input: QqProviderConversation): string | null {
  const id = boundedOpaqueId(input.id)
  if (id === null || id.includes(':')) return null
  return `qq:conversation:${input.kind}:${id}`
}

export function decodeQqConversation(value: string): QqProviderConversation | null {
  const match = /^qq:conversation:(direct|group|channel):(.+)$/.exec(value)
  if (!match) return null
  const id = boundedOpaqueId(match[2])
  if (id === null || id.includes(':')) return null
  return { kind: match[1] as QqProviderConversation['kind'], id }
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
