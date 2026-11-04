import type { ChannelCredentialVault } from '../../../../secrets/channels/channelCredentialContracts'
import type { ChannelInboundService } from '../ChannelInboundService'
import { ChannelInboundRepository } from '../ChannelInboundRepository'
import { TelegramApiClient } from './TelegramApiClient'
import { TelegramDeliveryTransport } from './TelegramDeliveryTransport'
import { TelegramOffsetRepository } from './TelegramOffsetRepository'
import { TelegramPollingHost } from './TelegramPollingHost'

/**
 * 启动结果必须带原因：以前这里只回 `boolean`，上层就把所有启动失败一律说成
 * 「网络或代理连不通」（用户 2026-11-04 被这句话误导了三次）。`reason` 用运行审计那套闭集。
 */
export type TelegramRuntimeStartResult = { ok: true } | { ok: false; reason: string }

/** Owns only C03-enabled Telegram pollers; legacy runtime hosts never enter this map. */
export class TelegramRuntimeManager {
  private readonly hosts = new Map<string, TelegramPollingHost>()
  /** 每个在跑的频道当前代际：写「停了」时要用它，hosts 删掉之后就没有别的来源了。 */
  private readonly hostGenerations = new Map<string, number>()
  private readonly lifetimes = new Map<string, { controller: AbortController; ownerToken?: string }>()

  constructor(private readonly deps: {
    inbound: ChannelInboundRepository
    inboundService: ChannelInboundService
    offsets: TelegramOffsetRepository
    vault: ChannelCredentialVault
    getPlatformFetch: () => typeof fetch
    delivery: TelegramDeliveryTransport
    getCredential: (channelId: string) => { ref: string; revision: number } | null
    ownsLifecycleOwner?: (channelId: string, token: string, generation: number) => boolean
    /** 连接真的起来/停下时写一条运行审计（面板的「状态变化」那一类）。只在状态变化时被调用。 */
    recordLifecycle?: (channelId: string, generation: number, state: 'started' | 'stopped') => void
    /** 起不来时把**具体原因**写进运行审计（面板能读到），别再让上层拿一句兜底话冒充原因。 */
    recordFailure?: (channelId: string, generation: number, reason: string) => void
  }) {}

  async start(channelId: string, generation: number, ownerToken: string): Promise<TelegramRuntimeStartResult> {
    const failed = (reason: string): TelegramRuntimeStartResult => {
      this.deps.recordFailure?.(channelId, generation, reason)
      return { ok: false, reason }
    }
    if (!ownerToken || !this.deps.ownsLifecycleOwner?.(channelId, ownerToken, generation)) {
      return failed('telegram-runtime-start-failed')
    }
    this.stop(channelId)
    if (!this.deps.inbound.isCurrentActive(channelId, generation) || !this.deps.ownsLifecycleOwner?.(channelId, ownerToken, generation)) {
      return failed('telegram-runtime-start-failed')
    }
    const lifetime = new AbortController()
    this.lifetimes.set(channelId, { controller: lifetime, ownerToken })
    try {
      const client = new TelegramApiClient({
        getPlatformFetch: this.deps.getPlatformFetch,
        token: async () => {
          const metadata = this.deps.getCredential(channelId)
          if (!metadata || lifetime.signal.aborted) return null
          try {
            const secret = await this.deps.vault.get(metadata.ref)
            return lifetime.signal.aborted ? null : secret?.bot_token ?? null
          } catch {
            // 凭据读不出来不是网络问题：让它归到「平台拒绝/读不到」那一档，别冒充成网络。
            return null
          }
        }
      })
      const identity = await client.botUsername(lifetime.signal)
      const isCurrent = () => !lifetime.signal.aborted && this.lifetimes.get(channelId)?.controller === lifetime && this.deps.inbound.isCurrentActive(channelId, generation) &&
        this.deps.ownsLifecycleOwner?.(channelId, ownerToken, generation) === true
      // 握手失败带真实原因（代理断了 / token 被拒 / 被别的进程占着），不再一律算网络。
      if (!identity.ok) { this.stopOwned(channelId, lifetime); return failed(identity.code) }
      if (!isCurrent()) { this.stopOwned(channelId, lifetime); return failed('telegram-runtime-start-failed') }
      this.deps.delivery.setClient(channelId, client, { isCurrent, signal: lifetime.signal })
      const host = new TelegramPollingHost({
        channelId, generation, inbound: this.deps.inboundService, offsets: this.deps.offsets, api: client,
        isCurrent, signal: lifetime.signal, botUsername: identity.value
      })
      this.hosts.set(channelId, host)
      this.hostGenerations.set(channelId, generation)
      host.start()
      this.deps.recordLifecycle?.(channelId, generation, 'started')
      return { ok: true }
    } catch {
      this.stopOwned(channelId, lifetime)
      return failed('telegram-runtime-start-failed')
    }
  }

  stop(channelId: string, ownerToken?: string): void {
    const lifetime = this.lifetimes.get(channelId)
    if (lifetime && (!ownerToken || lifetime.ownerToken === ownerToken)) this.stopOwned(channelId, lifetime.controller)
  }

  private stopOwned(channelId: string, lifetime: AbortController): void {
    lifetime.abort()
    // A superseded async handshake must never tear down the newer generation's client/host.
    if (this.lifetimes.get(channelId)?.controller !== lifetime) return
    // 只有真的在跑的那一个才写「停了」：握手失败/被替换的那次不算一次状态变化。
    const wasRunning = this.hosts.has(channelId)
    const runningGeneration = this.hostGenerations.get(channelId) ?? 0
    this.hosts.get(channelId)?.close()
    this.hosts.delete(channelId)
    this.hostGenerations.delete(channelId)
    this.deps.delivery.removeClient(channelId)
    if (wasRunning) this.deps.recordLifecycle?.(channelId, runningGeneration, 'stopped')
    this.lifetimes.delete(channelId)
  }

  async dispose(): Promise<void> { for (const id of [...this.lifetimes.keys()]) this.stop(id) }

  stopAllAndFence(fence: () => void): void {
    // Abort first so an in-flight handshake cannot issue another request while SQLite is fenced.
    for (const id of [...this.lifetimes.keys()]) this.stop(id)
    fence()
  }
}
