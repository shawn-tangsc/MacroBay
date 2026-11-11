import type { AgentChannelType } from '../../schemas/channelSchemas'
import type { ChannelSmokeResult } from '../channelSmokeEnable'
import { SlackApiClient } from './SlackApiClient'

/**
 * 用户点「启用」时对 Slack 的现场自检。**Slack 的两把凭据各证一件事**，所以是两步，不是一步：
 * - `auth.test`（Bot Token）：证明这把 `xoxb-` 是活的；
 * - `apps.connections.open`（App Token）：证明这把 `xapp-` 是活的、且 App 侧的 Socket Mode 真的开着。
 *
 * 只验 Bot Token 的写法看着更省事，但 Socket Mode 没开时它照样通过——用户会拿着一个「已启用」的
 * 频道收不到任何消息。这件事没有日志可查（连接根本没建立），所以必须在这里问出来。
 *
 * 与 Telegram 那份自检同三条规矩：没凭据时一个请求都不发；失败码必须是闭集里分得清的那种；
 * 失败时带可查的事实（实际生效的代理、出网入口），别让下次排查只剩一句「连不通」。
 */
export type SlackChannelSmokeDeps = {
  /** 这个频道当前的凭据元数据；没有就是没存过。 */
  credentialMetadata: (channelId: string) => { ref: string } | null
  /** 只读回凭据值；Vault 读不出来时由调用方抛错，这里按「凭据读不出来」处理。 */
  readSecret: (ref: string) => Promise<Record<string, string> | null>
  getPlatformFetch: () => typeof fetch
  /** 诊断：这次请求实际会走哪条代理（`PROXY host:port` / `DIRECT`）。 */
  describeProxy?: (url: string) => Promise<string>
  /** 诊断：这次用的出网入口（`session` / `net`）。 */
  fetchKind?: string
}

export function createSlackChannelSmoke(
  deps: SlackChannelSmokeDeps
): (channel: { id: string; type: AgentChannelType }) => Promise<ChannelSmokeResult> {
  return async ({ id, type }) => {
    if (type !== 'slack') return { ok: false, code: 'adapter-not-supported' }
    const metadata = deps.credentialMetadata(id)
    if (!metadata) return { ok: false, code: 'channel-credential-missing' }
    let secret: Record<string, string> | null
    try {
      secret = await deps.readSecret(metadata.ref)
    } catch {
      return { ok: false, code: 'channel-credential-unavailable' }
    }
    const botToken = secret?.bot_token
    const appToken = secret?.app_token
    // 两把缺一把都不算配好：只有 Bot Token 时能发消息、不能收消息，那不叫「接通了」。
    if (!botToken || !appToken) return { ok: false, code: 'channel-credential-missing' }

    const proxy = await deps.describeProxy?.('https://slack.com')
    const diagnostics = {
      ...(proxy ? { proxy } : {}),
      ...(deps.fetchKind ? { fetch: deps.fetchKind } : {})
    }

    const client = new SlackApiClient({
      getPlatformFetch: deps.getPlatformFetch,
      botToken: async () => botToken,
      appToken: async () => appToken
    })

    const identity = await client.authUser(AbortSignal.timeout(10_000))
    if (!identity.ok) return { ok: false, code: identity.code, ...diagnostics }

    // Socket Mode 那一侧：这一步过了才说明「能收到消息」的条件也成立。
    const socket = await client.socketUrl(AbortSignal.timeout(10_000))
    if (!socket.ok) return { ok: false, code: socket.code, ...diagnostics }

    return { ok: true }
  }
}
