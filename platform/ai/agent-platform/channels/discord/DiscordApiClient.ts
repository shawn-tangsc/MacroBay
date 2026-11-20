import { discordApiBase, type DiscordProviderConversation } from './DiscordContracts'

/**
 * REST 读的失败分类。**401 与 403 必须分开**：同一个用户拿着有效 Token，被挡的是「取网关地址」
 * 这个请求（Discord 侧 `{"code":40333,"message":"internal network error"}`），把它说成「Token 无效」
 * 会让人一遍遍换 Token——那正是这次用户走错的方向。
 *
 * - `discord-auth-rejected`：401，Token 真的不对/被吊销；
 * - `discord-gateway-endpoint-blocked`：取网关地址被 403 挡下（`providerCode` 带 Discord 的 code）；
 * - `discord-provider-rejected`：其他 4xx（权限、路径、参数）；
 * - `discord-rate-limited` / `discord-network-unavailable`：限流 / 5xx·网络。
 */
export type DiscordApiResult<T> =
  | { ok: true; value: T }
  | {
    ok: false
    code: 'discord-auth-rejected' | 'discord-gateway-endpoint-blocked' | 'discord-provider-rejected' | 'discord-rate-limited' | 'discord-network-unavailable'
    /** Discord 自己给的错误码（如 40333），只做诊断，不给读者看。 */
    providerCode?: string
  }

/**
 * 一条出站消息发出去之后的三种处境（文本与图片共用）：发出去了、上游拒了、不知道收没收下。
 * 429 与 5xx 各自还要再细分到投递层的码，所以在投递层统一映射，这里只报事实。
 */
export type DiscordSendOutcome = 'delivered' | 'rejected' | 'rate-limited' | 'unknown'

/**
 * HTTP 状态 → 处境的唯一分类（文本与图片共用一处，不分两套）：429 限流、5xx 不知道结果、其余 4xx 被拒。
 */
function sendOutcomeOf(response: Response): DiscordSendOutcome {
  return response.ok ? 'delivered' : response.status === 429 ? 'rate-limited' : response.status >= 500 ? 'unknown' : 'rejected'
}

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
  constructor(private readonly deps: {
    getPlatformFetch: () => typeof fetch
    token: () => Promise<string | null>
    /** 产品 UA：Discord 边缘按 UA 拦截，浏览器 UA 会被 403（见 `discordUserAgent`）。 */
    userAgent: string
  }) {}

  async sendText(conversation: DiscordProviderConversation, content: string, signal?: AbortSignal): Promise<DiscordSendOutcome> {
    if (signal?.aborted) return 'unknown'
    const token = await this.deps.token()
    if (!token || signal?.aborted) return 'rejected'
    const path = `channels/${conversation.id}/messages`
    try {
      const response = await this.deps.getPlatformFetch()(`${discordApiBase}/${path}`, {
        method: 'POST', signal,
        headers: {
          authorization: `Bot ${token}`,
          'content-type': 'application/json; charset=utf-8',
          'user-agent': this.deps.userAgent
        },
        body: JSON.stringify({ content })
      })
      return sendOutcomeOf(response)
    } catch { return 'unknown' }
  }

  /**
   * 发一张图 + caption：**一次 multipart 请求**（`POST /channels/{id}/messages`），不是先传后发两步。
   *
   * `files[0]` 放字节、`payload_json` 放 `content`（caption）与 `attachments` 的 id 映射——Discord
   * 只把「payload 里点了名的那一份」挂到消息上，只给 `files[n]` 不点 id 会落成一条没有附件的消息。
   * 线程不是额外字段：Discord 的线程自带一个频道 id，`decodeDiscordConversation` 解出来的
   * `thread` 就是那个 id，所以同一路径已经把消息发进线程，不硬造 `thread_ts`。
   *
   * 大小与格式**不在这里判**：上限与字节签名由投递层 `validateChannelImageDelivery` 统一判定。
   */
  async sendImage(
    conversation: DiscordProviderConversation,
    input: { mime: string; bytes: Uint8Array; caption: string },
    signal?: AbortSignal
  ): Promise<DiscordSendOutcome> {
    if (signal?.aborted) return 'unknown'
    const token = await this.deps.token()
    if (!token || signal?.aborted) return 'rejected'
    // 文件名只由嗅探出的 mime 决定（Discord 按 content-type 与扩展名认图），字节不落盘。
    const filename = `image.${input.mime === 'image/png' ? 'png' : 'jpg'}`
    const form = new FormData()
    form.set('payload_json', JSON.stringify({
      ...(input.caption.trim() ? { content: input.caption } : {}),
      attachments: [{ id: 0, filename }]
    }))
    form.set('files[0]', new Blob([input.bytes], { type: input.mime }), filename)
    try {
      const response = await this.deps.getPlatformFetch()(`${discordApiBase}/channels/${conversation.id}/messages`, {
        method: 'POST', signal, headers: { authorization: `Bot ${token}`, 'user-agent': this.deps.userAgent }, body: form
      })
      return sendOutcomeOf(response)
    } catch { return 'unknown' }
  }

  /** 网关接入点。**只认 wss**：服务器给什么就连什么，是最容易把凭据送去别处的一条路。 */
  async gatewayBot(signal?: AbortSignal): Promise<DiscordApiResult<{ url: string; shards: number }>> {
    const response = await this.get<{ url?: unknown; shards?: unknown }>('gateway/bot', signal, { gatewayEndpoint: true })
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

  private async get<T>(
    path: string,
    signal?: AbortSignal,
    options: { gatewayEndpoint?: boolean } = {}
  ): Promise<DiscordApiResult<T>> {
    if (signal?.aborted) return { ok: false, code: 'discord-network-unavailable' }
    const token = await this.deps.token()
    if (!token || signal?.aborted) return { ok: false, code: 'discord-provider-rejected' }
    try {
      const response = await this.deps.getPlatformFetch()(`${discordApiBase}/${path}`, {
        method: 'GET',
        signal,
        headers: { authorization: `Bot ${token}`, 'user-agent': this.deps.userAgent }
      })
      if (response.status === 429) return { ok: false, code: 'discord-rate-limited' }
      if (response.status === 401) return { ok: false, code: 'discord-auth-rejected' }
      if (response.status === 403 && options.gatewayEndpoint === true) {
        // 只有「取网关地址」这一跳把 403 单独读成「这个接口被挡」；别的 403 仍是权限问题。
        return { ok: false, code: 'discord-gateway-endpoint-blocked', providerCode: await providerCodeOf(response) }
      }
      // 其余 4xx 都是「这个请求再发一次也不会变好」：权限、路径、参数错。
      if (response.status >= 400 && response.status < 500) return { ok: false, code: 'discord-provider-rejected' }
      if (!response.ok) return { ok: false, code: 'discord-network-unavailable' }
      return { ok: true, value: await response.json() as T }
    } catch {
      return { ok: false, code: 'discord-network-unavailable' }
    }
  }
}

/**
 * Discord 的错误体里带它自己的 code（例如 40333）。**只取这一个数字**：
 * 正文里的 `message` 是服务端原话，不进日志、不进界面，免得把内部报错抄给读者。
 */
async function providerCodeOf(response: Response): Promise<string | undefined> {
  try {
    const body = await response.json() as { code?: unknown }
    return typeof body.code === 'number' && Number.isSafeInteger(body.code) ? String(body.code) : undefined
  } catch {
    return undefined
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
