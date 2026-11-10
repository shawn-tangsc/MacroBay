/**
 * QQ 机器人（v2）的**凭据交换**：`app_id + client_secret` → access token。
 *
 * 为什么单独一个模块：`QqApiClient` 吃的是「已经拼好的 `QQBot {token}`」，而全仓没有任何地方做过这次交换——
 * 补上之前，QQ 的发送与网关都只能吃一把空气。
 *
 * 协议依据（QQ 机器人官方文档）：
 * - 起步指南 › **获取访问凭证**：`POST https://bots.qq.com/app/getAppAccessToken`，
 *   body `{ appId, clientSecret }`，返回 `{ access_token, expires_in }`；
 * - 事件订阅 › WebSocket 方式 › **发起连接到 Gateway**：先调 `/gateway`（或 `/gateway/bot`）拿 wss 接入点，
 *   请求头 `Authorization: QQBot {access_token}`。
 *
 * 两条纪律：Token 只在内存里传，不落日志、不进错误对象；接入点**只认 wss**。
 */

export type QqApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'qq-provider-rejected' | 'qq-rate-limited' | 'qq-network-unavailable' }

export const qqTokenUrl = 'https://bots.qq.com/app/getAppAccessToken'
export const qqApiOrigin = 'https://api.sgroup.qq.com'

export type QqAccessToken = { accessToken: string; expiresInSeconds: number }

export async function exchangeQqAccessToken(
  deps: { getPlatformFetch: () => typeof fetch },
  credentials: { appId: string; clientSecret: string },
  signal?: AbortSignal
): Promise<QqApiResult<QqAccessToken>> {
  if (signal?.aborted) return { ok: false, code: 'qq-network-unavailable' }
  if (!credentials.appId || !credentials.clientSecret) return { ok: false, code: 'qq-provider-rejected' }
  try {
    const response = await deps.getPlatformFetch()(qqTokenUrl, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ appId: credentials.appId, clientSecret: credentials.clientSecret })
    })
    if (response.status === 429) return { ok: false, code: 'qq-rate-limited' }
    if (response.status >= 400 && response.status < 500) return { ok: false, code: 'qq-provider-rejected' }
    if (!response.ok) return { ok: false, code: 'qq-network-unavailable' }
    const body = await response.json() as { access_token?: unknown; expires_in?: unknown }
    const accessToken = typeof body.access_token === 'string' ? body.access_token.trim() : ''
    if (accessToken.length === 0 || accessToken.length > 4_096) return { ok: false, code: 'qq-provider-rejected' }
    const expiresInSeconds = typeof body.expires_in === 'number' && Number.isFinite(body.expires_in) && body.expires_in > 0
      ? Math.floor(body.expires_in)
      : 0
    return { ok: true, value: { accessToken, expiresInSeconds } }
  } catch {
    return { ok: false, code: 'qq-network-unavailable' }
  }
}

/** 网关接入点：`url` 必须是 wss——服务器给什么就连什么，是最容易把凭据送去别处的一条路。 */
export async function readQqGateway(
  deps: { getPlatformFetch: () => typeof fetch },
  accessToken: string,
  signal?: AbortSignal
): Promise<QqApiResult<{ url: string; shards: number }>> {
  if (signal?.aborted) return { ok: false, code: 'qq-network-unavailable' }
  if (!accessToken) return { ok: false, code: 'qq-provider-rejected' }
  try {
    const response = await deps.getPlatformFetch()(`${qqApiOrigin}/gateway`, {
      method: 'GET',
      signal,
      headers: { authorization: `QQBot ${accessToken}` }
    })
    if (response.status === 429) return { ok: false, code: 'qq-rate-limited' }
    if (response.status >= 400 && response.status < 500) return { ok: false, code: 'qq-provider-rejected' }
    if (!response.ok) return { ok: false, code: 'qq-network-unavailable' }
    const body = await response.json() as { url?: unknown }
    const url = typeof body.url === 'string' ? body.url : ''
    if (!isWssUrl(url)) return { ok: false, code: 'qq-provider-rejected' }
    return { ok: true, value: { url, shards: 1 } }
  } catch {
    return { ok: false, code: 'qq-network-unavailable' }
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
