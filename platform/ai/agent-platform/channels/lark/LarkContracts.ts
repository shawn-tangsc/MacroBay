/**
 * 飞书的**唯一 origin**：REST 基址与长连接取地址那一跳都从它派生。
 *
 * 为什么要收成一处：这两跳以前各写各的——REST 打 `open.larksuite.com`，长连接由 SDK 默认
 * 打 `open.feishu.cn`，而取地址那一步会带上 `app_id + app_secret`。于是「凭据不越过 Feishu origin」
 * 这句承诺与代码互相打脸，而且两个域名里哪个才算「对」也没法一眼回答。
 *
 * 现值仍是 `open.larksuite.com`（Release C 只接受 `lark` 公开预设）。**要换域名只改这一行**：
 * REST 基址与 SDK 的 `domain` 同时跟着变。换之前先用 `pnpm lark:smoke --base <url>` 两种都试一次。
 */
export const larkOrigin = 'https://open.larksuite.com'

/** REST 基址：从同一个 origin 派生，别在别处再写一个域名。 */
export const larkApiBase = `${larkOrigin}/open-apis`

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
