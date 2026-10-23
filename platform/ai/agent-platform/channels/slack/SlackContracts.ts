export const slackApiBase = 'https://slack.com/api'

export type SlackApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'slack-rate-limited' | 'slack-provider-rejected' | 'slack-network-unavailable'; retryAfterMs?: number }

export type SlackSocketEnvelope = {
  envelope_id?: unknown
  type?: unknown
  payload?: {
    event_id?: unknown
    event?: Record<string, unknown>
  }
}

export type SlackInboundFact = {
  eventKey: string
  messageKey?: string
  conversationKey: string
  userKey: string
  conversationKind: 'direct' | 'group' | 'channel'
  mentionedBot: boolean
  text?: string
  attachments?: Array<{ kind: 'image' | 'file'; stableRef: string; mimeType: string; name?: string; sizeBytes?: number }>
}

export type SlackProviderConversation = { channelId: string; threadTs: string | null }

/** C03 stores this opaque provider key encrypted; only the Slack adapter may decode it for delivery. */
export function encodeSlackConversation(input: SlackProviderConversation): string | null {
  if (!isSlackChannelId(input.channelId) || (input.threadTs !== null && !isSlackThreadTs(input.threadTs))) return null
  return `slack:conversation:${input.channelId}${input.threadTs ? `:thread:${input.threadTs}` : ''}`
}

export function decodeSlackConversation(value: string): SlackProviderConversation | null {
  const match = /^slack:conversation:([A-Z][A-Z0-9]{1,254})(?::thread:([0-9]{1,16}\.[0-9]{1,16}))?$/.exec(value)
  if (!match || !isSlackChannelId(match[1]!)) return null
  return { channelId: match[1]!, threadTs: match[2] ?? null }
}

export function splitSlackText(text: string): string[] {
  const limit = 4_000
  if (!text) return ['']
  const result: string[] = []
  for (let index = 0; index < text.length; index += limit) result.push(text.slice(index, index + limit))
  return result
}

function isSlackChannelId(value: string): boolean {
  return /^[CGD][A-Z0-9]{1,254}$/.test(value)
}

function isSlackThreadTs(value: string): boolean {
  return /^[0-9]{1,16}\.[0-9]{1,16}$/.test(value)
}
