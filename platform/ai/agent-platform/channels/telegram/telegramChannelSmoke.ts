import type { AgentChannelType } from '../../schemas/channelSchemas'
import type { ChannelSmokeResult } from '../channelSmokeEnable'
import { TelegramApiClient } from './TelegramApiClient'

/**
 * 用户点「启用」时对 Telegram 的现场自检：握手 + 一次接收往返。
 *
 * 为什么单独成模块：这段以前写在组合根里，**没有任何用例覆盖**，于是「20 秒长轮询套 10 秒 abort」
 * 这种必失败的写法一直没被发现——没有新消息时 `getUpdates` 会挂到 25 秒，自检必然在 10 秒被自己掐断，
 * 报成 `telegram-network-unavailable`。用户看到的就是「网络或代理连不通」，而代理和 token 都是好的。
 *
 * 两条规矩：
 * - **自检的接收往返用短轮询（`timeout: 0`）**：它的目的是证明「能收到」，不是等新消息；
 * - 任何没落进原因闭集的失败都要留下**可分辨**的码，别一律归到「网络不可达」。
 */
export type TelegramChannelSmokeDeps = {
  /** 这个频道当前的凭据元数据；没有就是没存过。 */
  credentialMetadata: (channelId: string) => { ref: string } | null
  /** 只读回凭据值；Vault 读不出来时由调用方抛错，这里按「凭据没存」处理。 */
  readSecret: (ref: string) => Promise<Record<string, string> | null>
  getPlatformFetch: () => typeof fetch
}

export function createTelegramChannelSmoke(
  deps: TelegramChannelSmokeDeps
): (channel: { id: string; type: AgentChannelType }) => Promise<ChannelSmokeResult> {
  return async ({ id, type }) => {
    if (type !== 'telegram') return { ok: false, code: 'adapter-not-supported' }
    const metadata = deps.credentialMetadata(id)
    if (!metadata) return { ok: false, code: 'channel-credential-missing' }
    const token = (await deps.readSecret(metadata.ref))?.bot_token
    if (!token) return { ok: false, code: 'channel-credential-missing' }
    const client = new TelegramApiClient({ getPlatformFetch: deps.getPlatformFetch, token: async () => token })
    // 握手：token 不对/被吊销在这里就能分辨。
    const identity = await client.botUsername(AbortSignal.timeout(10_000))
    if (!identity.ok) return { ok: false, code: identity.code }
    // 接收往返：短轮询，立刻返回；兼容别的进程正拿着这个 bot（409）。
    const probe = await client.probe(AbortSignal.timeout(10_000))
    return probe.ok ? { ok: true } : { ok: false, code: probe.code }
  }
}
