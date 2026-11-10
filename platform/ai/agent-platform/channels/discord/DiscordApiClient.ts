import { discordApiBase, type DiscordProviderConversation } from './DiscordContracts'

/** REST 读的三种失败：凭据被拒、限流、网络/服务端不可用。三者对读者的下一步完全不同。 */
export type DiscordApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'discord-provider-rejected' | 'discord-rate-limited' | 'discord-network-unavailable' }

/**
 * Discord REST 的唯一入口（注入平台 `fetch`，代理与出网策略都在平台那一侧）。
 *
 * 协议依据（Discord Developers › Docs）：
 * - Topical › **Gateway** › Get Gateway Bot：`GET /gateway/bot` → `{ url, shards, session_start_limit }`，
 *   `url` 是 wss 接入点；
 * - Resources › **User** › Get Current User：`GET /users/@me` → `{ id, username, ... }`。
 *
 * 后者正好是「启用自检」要的那一次请求：凭据错、被吊销、网络不通，都能在那一步分辨出来。
 */
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

  /** 网关接入点。**只认 wss**：服务器给什么就连什么，是最容易把凭据送去别处的一条路。 */
  async gatewayBot(signal?: AbortSignal): Promise<DiscordApiResult<{ url: string; shards: number }>> {
    const response = await this.get<{ url?: unknown; shards?: unknown }>('gateway/bot', signal)
    if (!response.ok) return response
    const url = response.value.url
    if (typeof url !== 'string' || !isWssUrl(url)) return { ok: false, code: 'discord-provider-rejected' }
    const shards = response.value.shards
    return {
      ok: true,
      value: { url, shards: typeof shards === 'number' && Number.isSafeInteger(shards) && shards > 0 ? shards : 1 }
    }
  }

  /** 机器人自己：`id` 是后续「这条消息是不是我自己发的」与命令路由都要用的东西。 */
  async currentUser(signal?: AbortSignal): Promise<DiscordApiResult<{ id: string; username: string }>> {
    const response = await this.get<{ id?: unknown; username?: unknown }>('users/@me', signal)
    if (!response.ok) return response
    const id = response.value.id
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { ok: false, code: 'discord-provider-rejected' }
    const username = typeof response.value.username === 'string' ? response.value.username : ''
    return { ok: true, value: { id, username } }
  }

  private async get<T>(path: string, signal?: AbortSignal): Promise<DiscordApiResult<T>> {
    if (signal?.aborted) return { ok: false, code: 'discord-network-unavailable' }
    const token = await this.deps.token()
    if (!token || signal?.aborted) return { ok: false, code: 'discord-provider-rejected' }
    try {
      const response = await this.deps.getPlatformFetch()(`${discordApiBase}/${path}`, {
        method: 'GET',
        signal,
        headers: { authorization: `Bot ${token}` }
      })
      if (response.status === 429) return { ok: false, code: 'discord-rate-limited' }
      // 4xx 都是「这个请求再发一次也不会变好」：凭据、权限、路径错。
      if (response.status >= 400 && response.status < 500) return { ok: false, code: 'discord-provider-rejected' }
      if (!response.ok) return { ok: false, code: 'discord-network-unavailable' }
      return { ok: true, value: await response.json() as T }
    } catch {
      return { ok: false, code: 'discord-network-unavailable' }
    }
  }
}

function isWssUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'wss:' && url.hostname.length > 0
  } catch {
    return false
  }
}
