import type { ChannelCredentialVault } from '../../../../secrets/channels/channelCredentialContracts'
import type { ChannelInboundService } from '../ChannelInboundService'
import { LarkApiClient } from './LarkApiClient'
import type { LarkProxyDecision } from './LarkLongConnectionClient'
import { LarkLongConnectionHost } from './LarkLongConnectionHost'
import { LarkRuntimeRepository } from './LarkRuntimeRepository'
import type { LarkDeliveryTransport } from './LarkDeliveryTransport'

/**
 * 飞书运行时：一条通道一份生命周期（`AbortController` + 代际 + owner 令牌）。
 *
 * 与另外两家同形；差在**凭据与传输**：凭据是 `app_id + app_secret`，传输是官方 SDK 的长连接
 * （socket 由 SDK 建，代理通过包装层注入——所以这里不接 `createPlatformWebSocket`）。
 *
 * 三道准入：owner 令牌属于这一代、这一代仍是现役（建连期间再判一次）、凭据读得出来。
 * 长连接没建起来（代理解析不出 / 握手失败）时返回 false，**不假装启用成功**。
 */
export class LarkRuntimeManager {
  private readonly hosts = new Map<string, LarkLongConnectionHost>()
  private readonly lifetimes = new Map<string, { controller: AbortController; ownerToken: string }>()

  constructor(private readonly deps: {
    inbound: ChannelInboundService
    runtime: LarkRuntimeRepository
    vault: ChannelCredentialVault
    getPlatformFetch: () => typeof fetch
    delivery: LarkDeliveryTransport
    getCredential: (channelId: string) => { ref: string; revision: number } | null
    keyedHash: (channelId: string, value: Uint8Array) => Promise<string>
    ownsLifecycleOwner: (channelId: string, token: string, generation: number) => boolean
    isCurrentActive: (channelId: string, generation: number) => boolean
    /** 平台那一侧：读网络设置 + 解析系统代理。返回 `null` = 解析不出来（不是直连）。 */
    resolveProxy: (targetUrl: string) => Promise<LarkProxyDecision | null>
    handshakeTimeoutMs?: number
  }) {}

  async start(channelId: string, generation: number, ownerToken: string): Promise<boolean> {
    if (!ownerToken || !this.deps.ownsLifecycleOwner(channelId, ownerToken, generation)) return false
    this.stop(channelId)
    if (!this.generationIsOurs(channelId, generation, ownerToken)) return false

    const credential = this.deps.getCredential(channelId)
    if (!credential) return false
    let secret: Record<string, string> | null
    try {
      secret = await this.deps.vault.get(credential.ref)
    } catch {
      // 读不出来当「没有凭据」：不是网络问题。
      return false
    }
    const appId = secret?.app_id
    const appSecret = secret?.app_secret
    if (!appId || !appSecret) return false

    const controller = new AbortController()
    this.lifetimes.set(channelId, { controller, ownerToken })
    const isCurrent = (): boolean => this.isCurrent(channelId, generation, ownerToken, controller)
    try {
      this.deps.delivery.setClient(channelId, new LarkApiClient({
        getPlatformFetch: this.deps.getPlatformFetch,
        credentials: async () => ({ appId, appSecret })
      }), { isCurrent, signal: controller.signal })

      const host = new LarkLongConnectionHost({
        channelId,
        generation,
        appId,
        appSecret,
        resolveProxy: this.deps.resolveProxy,
        inbound: this.deps.inbound,
        runtime: this.deps.runtime,
        hashEventKey: (eventKey) => this.deps.keyedHash(channelId, new TextEncoder().encode(eventKey)),
        isCurrent,
        signal: controller.signal,
        ...(this.deps.handshakeTimeoutMs === undefined ? {} : { handshakeTimeoutMs: this.deps.handshakeTimeoutMs })
      })
      const started = await host.start()
      if (!started || !isCurrent()) {
        host.stop()
        this.stopOwned(channelId, controller)
        return false
      }
      this.hosts.set(channelId, host)
      return true
    } catch {
      this.stopOwned(channelId, controller)
      return false
    }
  }

  stop(channelId: string, ownerToken?: string): void {
    const lifetime = this.lifetimes.get(channelId)
    if (lifetime && (!ownerToken || lifetime.ownerToken === ownerToken)) this.stopOwned(channelId, lifetime.controller)
  }

  async dispose(): Promise<void> {
    for (const channelId of [...this.lifetimes.keys()]) this.stop(channelId)
  }

  stopAllAndFence(fence: () => void): void {
    for (const channelId of [...this.lifetimes.keys()]) this.stop(channelId)
    fence()
  }

  private generationIsOurs(channelId: string, generation: number, ownerToken: string): boolean {
    return this.deps.isCurrentActive(channelId, generation) && this.deps.ownsLifecycleOwner(channelId, ownerToken, generation)
  }

  private isCurrent(channelId: string, generation: number, ownerToken: string, controller: AbortController): boolean {
    return !controller.signal.aborted &&
      this.lifetimes.get(channelId)?.controller === controller &&
      this.generationIsOurs(channelId, generation, ownerToken)
  }

  private stopOwned(channelId: string, controller: AbortController): void {
    controller.abort()
    if (this.lifetimes.get(channelId)?.controller !== controller) return
    this.hosts.get(channelId)?.stop()
    this.hosts.delete(channelId)
    this.deps.delivery.removeClient(channelId)
    this.lifetimes.delete(channelId)
  }
}
