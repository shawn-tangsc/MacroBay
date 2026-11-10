import type { AgentChannelType } from '../../schemas/channelSchemas'
import type { ChannelSmokeResult } from '../channelSmokeEnable'
import { DiscordApiClient } from './DiscordApiClient'

/**
 * 用户点「启用」时对 Discord 的现场自检：**一次** `/users/@me`。
 *
 * 为什么一次就够：那次请求同时证明三件事——凭据是活的、出网（含代理）通、这个 bot 真存在。
 * 网关地址另有一次 `/gateway/bot`，它在运行时每次启动都会再取一遍，不必让读者在这一步等两次。
 *
 * 与另外两家同三条规矩：没凭据时一个请求都不发；失败码必须是闭集里分得清的那种
 * （被拒 / 限流 / 连不通）；失败时带可查的事实（实际生效的代理、出网入口），别只剩一句「连不通」。
 *
 * 有一条**代码补不了**的前提要在界面上说清：`MESSAGE_CONTENT` 是特权 intent，
 * 没在开发者后台给这个机器人打开时，连接照样建立、自检照样通过，但收不到消息正文。
 */
export type DiscordChannelSmokeDeps = {
  credentialMetadata: (channelId: string) => { ref: string } | null
  readSecret: (ref: string) => Promise<Record<string, string> | null>
  getPlatformFetch: () => typeof fetch
  describeProxy?: (url: string) => Promise<string>
  fetchKind?: string
}

export function createDiscordChannelSmoke(
  deps: DiscordChannelSmokeDeps
): (channel: { id: string; type: AgentChannelType }) => Promise<ChannelSmokeResult> {
  return async ({ id, type }) => {
    if (type !== 'discord') return { ok: false, code: 'adapter-not-supported' }
    const metadata = deps.credentialMetadata(id)
    if (!metadata) return { ok: false, code: 'channel-credential-missing' }
    let secret: Record<string, string> | null
    try {
      secret = await deps.readSecret(metadata.ref)
    } catch {
      return { ok: false, code: 'channel-credential-unavailable' }
    }
    const token = secret?.bot_token
    if (!token) return { ok: false, code: 'channel-credential-missing' }

    const proxy = await deps.describeProxy?.('https://discord.com')
    const diagnostics = {
      ...(proxy ? { proxy } : {}),
      ...(deps.fetchKind ? { fetch: deps.fetchKind } : {})
    }

    const client = new DiscordApiClient({ getPlatformFetch: deps.getPlatformFetch, token: async () => token })
    const identity = await client.currentUser(AbortSignal.timeout(10_000))
    if (!identity.ok) return { ok: false, code: identity.code, ...diagnostics }
    return { ok: true }
  }
}
