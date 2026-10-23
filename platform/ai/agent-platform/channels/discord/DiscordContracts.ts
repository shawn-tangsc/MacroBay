export const discordApiBase = 'https://discord.com/api/v10'

export type DiscordProviderConversation = { kind: 'direct' | 'guild' | 'thread'; id: string }

/** Discord conversation material is adapter-private encrypted C03 state. */
export function encodeDiscordConversation(input: DiscordProviderConversation): string | null {
  return /^[A-Za-z0-9_-]{1,256}$/.test(input.id) ? `discord:conversation:${input.kind}:${input.id}` : null
}

export function decodeDiscordConversation(value: string): DiscordProviderConversation | null {
  const match = /^discord:conversation:(direct|guild|thread):([A-Za-z0-9_-]{1,256})$/.exec(value)
  return match ? { kind: match[1] as DiscordProviderConversation['kind'], id: match[2]! } : null
}

export function splitDiscordText(text: string): string[] {
  if (!text) return ['']
  const parts: string[] = []
  for (let index = 0; index < text.length; index += 2_000) parts.push(text.slice(index, index + 2_000))
  return parts
}

export type DiscordInboundFact = {
  eventKey: string
  conversationKey: string
  userKey: string
  conversationKind: 'direct' | 'group' | 'channel'
  mentionedBot: boolean
  text?: string
  attachments?: Array<{ kind: 'image' | 'file'; stableRef: string; mimeType: string; name?: string; sizeBytes?: number }>
}
