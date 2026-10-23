import { larkApiBase, type LarkApiResult, type LarkProviderConversation } from './LarkContracts'

type Fetch = typeof fetch

/** Lark REST is injectable only; access tokens remain inside this short-lived main-process client. */
export class LarkApiClient {
  private tenantToken: string | null = null

  constructor(private readonly deps: { getPlatformFetch: () => Fetch; credentials: () => Promise<{ appId: string; appSecret: string } | null> }) {}

  async sendText(conversation: LarkProviderConversation, text: string, signal?: AbortSignal): Promise<LarkApiResult<true>> {
    if (signal?.aborted) return { ok: false, code: 'lark-network-unavailable' }
    const token = await this.token(signal)
    if (!token) return { ok: false, code: 'lark-provider-rejected' }
    const content = JSON.stringify({ text })
    return this.request(
      `im/v1/messages?receive_id_type=chat_id`,
      { receive_id: conversation.chatId, msg_type: 'text', content, ...(conversation.threadId ? { root_id: conversation.threadId } : {}) },
      token,
      signal
    ).then((result) => result.ok ? { ok: true, value: true } : result)
  }

  private async token(signal?: AbortSignal): Promise<string | null> {
    if (this.tenantToken && !signal?.aborted) return this.tenantToken
    const credentials = await this.deps.credentials()
    if (!credentials || signal?.aborted) return null
    try {
      const response = await this.deps.getPlatformFetch()(`${larkApiBase}/auth/v3/tenant_access_token/internal`, {
        method: 'POST', signal, headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ app_id: credentials.appId, app_secret: credentials.appSecret })
      })
      const body = await response.json() as { code?: unknown; tenant_access_token?: unknown }
      if (!response.ok || body.code !== 0 || typeof body.tenant_access_token !== 'string' || !body.tenant_access_token) return null
      this.tenantToken = body.tenant_access_token
      return signal?.aborted ? null : this.tenantToken
    } catch { return null }
  }

  private async request(path: string, body: Record<string, unknown>, token: string, signal?: AbortSignal): Promise<LarkApiResult<Record<string, unknown>>> {
    try {
      const response = await this.deps.getPlatformFetch()(`${larkApiBase}/${path}`, {
        method: 'POST', signal, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body)
      })
      const json = await response.json() as { code?: unknown }
      if (response.ok && json.code === 0) return { ok: true, value: json }
      return { ok: false, code: response.status === 429 ? 'lark-rate-limited' : response.status >= 500 ? 'lark-network-unavailable' : 'lark-provider-rejected' }
    } catch { return { ok: false, code: 'lark-network-unavailable' } }
  }
}
