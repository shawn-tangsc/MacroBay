import type { SlackApiResult } from './SlackContracts'
import { slackApiBase } from './SlackContracts'

type Fetch = typeof fetch

/** Slack REST has no global fallback: desktop composition injects the proxy-aware fetch implementation. */
export class SlackApiClient {
  constructor(private readonly deps: { getPlatformFetch: () => Fetch; botToken: () => Promise<string | null>; appToken: () => Promise<string | null> }) {}

  async socketUrl(signal?: AbortSignal): Promise<SlackApiResult<string>> {
    return this.request('apps.connections.open', {}, 'app', signal).then((result) => {
      if (!result.ok || typeof result.value.url !== 'string' || !result.value.url.startsWith('wss://')) return result.ok ? { ok: false, code: 'slack-provider-rejected' } : result
      return { ok: true, value: result.value.url }
    })
  }

  async authUser(signal?: AbortSignal): Promise<SlackApiResult<string>> {
    return this.request('auth.test', {}, 'bot', signal).then((result) => {
      if (!result.ok || typeof result.value.user_id !== 'string' || !result.value.user_id) return result.ok ? { ok: false, code: 'slack-provider-rejected' } : result
      return { ok: true, value: result.value.user_id }
    })
  }

  sendMessage(conversation: { channelId: string; threadTs: string | null }, text: string, signal?: AbortSignal): Promise<SlackApiResult<true>> {
    return this.request('chat.postMessage', {
      channel: conversation.channelId, text, ...(conversation.threadTs ? { thread_ts: conversation.threadTs } : {})
    }, 'bot', signal).then((result) => result.ok ? { ok: true, value: true } : result)
  }

  private async request(method: string, body: Record<string, unknown>, tokenKind: 'bot' | 'app', signal?: AbortSignal): Promise<SlackApiResult<Record<string, unknown>>> {
    try {
      if (signal?.aborted) return { ok: false, code: 'slack-network-unavailable' }
      const token = await (tokenKind === 'bot' ? this.deps.botToken() : this.deps.appToken())
      if (!token || signal?.aborted) return { ok: false, code: 'slack-provider-rejected' }
      const response = await this.deps.getPlatformFetch()(`${slackApiBase}/${method}`, {
        method: 'POST', signal, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body)
      })
      const json = await response.json() as { ok?: unknown }
      if (response.ok && json.ok === true) return { ok: true, value: json }
      if (response.status === 429) return { ok: false, code: 'slack-rate-limited', retryAfterMs: retryAfter(response.headers.get('retry-after')) }
      return { ok: false, code: response.status >= 500 ? 'slack-network-unavailable' : 'slack-provider-rejected' }
    } catch { return { ok: false, code: 'slack-network-unavailable' } }
  }
}

function retryAfter(value: string | null): number {
  const seconds = Number(value)
  return Math.max(1_000, Math.min(60_000, Number.isFinite(seconds) ? seconds * 1_000 : 1_000))
}
