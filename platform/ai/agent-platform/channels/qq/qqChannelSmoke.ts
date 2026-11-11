import type { AgentChannelType } from '../../schemas/channelSchemas'
import type { ChannelSmokeResult } from '../channelSmokeEnable'
import { exchangeQqAccessToken, readQqGateway } from './QqAccessToken'

/**
 * 用户点「启用」时对 QQ 的现场自检：**两步**，每步各证一件事。
 *
 * 1. `app_id + client_secret → access token`（`/app/getAppAccessToken`）：证明这对凭据是活的；
 * 2. `GET /gateway`（带 `QQBot {token}`）：证明这把 token 能拿到 wss 接入点、出网（含代理）通。
 *
 * 只做第 1 步的话，「token 换到了但网关不给地址」会被读成「已启用」——用户拿着一个连不上的频道，
 * 而那条路上什么都没有。两步任一失败都给闭集里分得清的原因码（被拒 / 限流 / 连不通）。
 */
export type QqChannelSmokeDeps = {
  credentialMetadata: (channelId: string) => { ref: string } | null
  readSecret: (ref: string) => Promise<Record<string, string> | null>
  getPlatformFetch: () => typeof fetch
  describeProxy?: (url: string) => Promise<string>
  fetchKind?: string
}

export function createQqChannelSmoke(
  deps: QqChannelSmokeDeps
): (channel: { id: string; type: AgentChannelType }) => Promise<ChannelSmokeResult> {
  return async ({ id, type }) => {
    if (type !== 'qq') return { ok: false, code: 'adapter-not-supported' }
    const metadata = deps.credentialMetadata(id)
    if (!metadata) return { ok: false, code: 'channel-credential-missing' }
    let secret: Record<string, string> | null
    try {
      secret = await deps.readSecret(metadata.ref)
    } catch {
      return { ok: false, code: 'channel-credential-unavailable' }
    }
    const appId = secret?.app_id
    const clientSecret = secret?.client_secret
    if (!appId || !clientSecret) return { ok: false, code: 'channel-credential-missing' }

    const proxy = await deps.describeProxy?.('https://api.sgroup.qq.com')
    const diagnostics = {
      ...(proxy ? { proxy } : {}),
      ...(deps.fetchKind ? { fetch: deps.fetchKind } : {})
    }
    const transport = { getPlatformFetch: deps.getPlatformFetch }

    const token = await exchangeQqAccessToken(transport, { appId, clientSecret }, AbortSignal.timeout(10_000))
    if (!token.ok) return { ok: false, code: token.code, ...diagnostics }

    const gateway = await readQqGateway(transport, token.value.accessToken, AbortSignal.timeout(10_000))
    if (!gateway.ok) return { ok: false, code: gateway.code, ...diagnostics }
    return { ok: true }
  }
}
