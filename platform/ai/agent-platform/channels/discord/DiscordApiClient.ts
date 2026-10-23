import { discordApiBase, type DiscordProviderConversation } from './DiscordContracts'

/** Injectable-only REST seam; Release E manager never constructs it while Discord is blocked. */
export class DiscordApiClient {
  constructor(private readonly deps: { getPlatformFetch: () => typeof fetch; token: () => Promise<string | null> }) {}

  async sendText(conversation: DiscordProviderConversation, content: string, signal?: AbortSignal): Promise<'delivered' | 'rejected' | 'rate-limited' | 'unknown'> {
    if (signal?.aborted) return 'unknown'
    const token = await this.deps.token()
    if (!token || signal?.aborted) return 'rejected'
    const path = `channels/${conversation.id}/messages`
    try {
      const response = await this.deps.getPlatformFetch()(`${discordApiBase}/${path}`, {
        method: 'POST', signal,
        headers: { authorization: `Bot ${token}`, 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ content })
      })
      return response.ok ? 'delivered' : response.status === 429 ? 'rate-limited' : response.status >= 500 ? 'unknown' : 'rejected'
    } catch { return 'unknown' }
  }
}
