import { qqApiBase, type QqProviderConversation } from './QqContracts'

/** Injectable-only REST seam; Release D manager never constructs it while QQ is blocked. */
export class QqApiClient {
  constructor(private readonly deps: { getPlatformFetch: () => typeof fetch; token: () => Promise<string | null> }) {}

  async sendText(conversation: QqProviderConversation, content: string, signal?: AbortSignal): Promise<'delivered' | 'rejected' | 'rate-limited' | 'unknown'> {
    if (signal?.aborted) return 'unknown'
    const token = await this.deps.token()
    if (!token || signal?.aborted) return 'rejected'
    const path = conversation.kind === 'direct' ? `v2/users/${conversation.id}/messages` : conversation.kind === 'group' ? `v2/groups/${conversation.id}/messages` : `channels/${conversation.id}/messages`
    try {
      const response = await this.deps.getPlatformFetch()(`${qqApiBase}/${path}`, {
        method: 'POST', signal,
        headers: { authorization: `QQBot ${token}`, 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ content })
      })
      return response.ok ? 'delivered' : response.status === 429 ? 'rate-limited' : response.status >= 500 ? 'unknown' : 'rejected'
    } catch { return 'unknown' }
  }
}
