import type { PlatformWebSocketConstructor } from '../../../../network/platformWebSocket'
import type { ChannelCredentialVault } from '../../../../secrets/channels/channelCredentialContracts'
import type { ChannelInboundService } from '../ChannelInboundService'
import { exchangeQqAccessToken, readQqGateway } from './QqAccessToken'
import { QqApiClient } from './QqApiClient'
import { QqDeliveryTransport } from './QqDeliveryTransport'
import { QqGatewayHost } from './QqGatewayHost'
import { QqRuntimeRepository } from './QqRuntimeRepository'

/**
 * QQ 运行时：一条通道一份生命周期（`AbortController` + 代际 + owner 令牌）。
 *
 * 与 Discord 唯一的**结构性**差别：QQ 的凭据是 `app_id + client_secret`，每次连网关或发消息之前
 * 都要先换 access token。所以这里多一个小缓存：按 `expires_in` 复用、快过期（< 60s）再换；
 * 换失败就按「凭据/网络」失败处理，绝不拿一把过期 token 去撞 401。
 *
 * 三道准入与 Discord 一致：owner 令牌属于这一代、这一代仍是现役（握手期间再判一次）、凭据读得出来。
 */
export class QqRuntimeManager {
  private readonly hosts = new Map<string, QqGatewayHost>()
  private readonly lifetimes = new Map<string, { controller: AbortController; ownerToken: string }>()
  /** 每个通道一把 access token：`QQBot {token}` 只在发请求时拼。 */
  private readonly tokens = new Map<string, { accessToken: string; expiresAt: number }>()

  constructor(private readonly deps: {
    inbound: ChannelInboundService
    runtime: QqRuntimeRepository
    vault: ChannelCredentialVault
    getPlatformFetch: () => typeof fetch
    createPlatformWebSocket: PlatformWebSocketConstructor
    delivery: QqDeliveryTransport
    getCredential: (channelId: string) => { ref: string; revision: number } | null
    ownsLifecycleOwner: (channelId: string, token: string, generation: number) => boolean
    isCurrentActive: (channelId: string, generation: number) => boolean
    /** 只给用例：令牌缓存的时间基准。 */
    now?: () => number
  }) {}

  async start(channelId: string, generation: number, ownerToken: string): Promise<boolean> {
    if (!ownerToken || !this.deps.ownsLifecycleOwner(channelId, ownerToken, generation)) return false
    this.stop(channelId)
    if (!this.generationIsOurs(channelId, generation, ownerToken)) return false

    const controller = new AbortController()
    this.lifetimes.set(channelId, { controller, ownerToken })
    try {
      const accessToken = await this.accessToken(channelId, controller.signal)
      if (!accessToken) {
        this.stopOwned(channelId, controller)
        return false
      }
      const gateway = await readQqGateway({ getPlatformFetch: this.deps.getPlatformFetch }, accessToken, controller.signal)
      const isCurrent = (): boolean => this.isCurrent(channelId, generation, ownerToken, controller)
      // 握手期间可能已经被停用/换代：回来再判一次。
      if (!gateway.ok || !isCurrent()) {
        this.stopOwned(channelId, controller)
        return false
      }

      // 投递客户端吃**裸 token**（`QqApiClient` 自己拼 `QQBot `）；网关那侧要拼好的那一把。
      this.deps.delivery.setClient(channelId, new QqApiClient({
        getPlatformFetch: this.deps.getPlatformFetch,
        token: () => this.accessToken(channelId, controller.signal)
      }), { isCurrent, signal: controller.signal })

      const host = new QqGatewayHost({
        channelId,
        generation,
        gatewayUrl: gateway.value.url,
        token: async () => {
          const token = await this.accessToken(channelId, controller.signal)
          return token ? `QQBot ${token}` : null
        },
        intents: QQ_DEFAULT_INTENTS,
        inbound: this.deps.inbound,
        runtime: this.deps.runtime,
        createPlatformWebSocket: this.deps.createPlatformWebSocket as never,
        isCurrent,
        signal: controller.signal,
        refreshGatewayUrl: async () => {
          const token = await this.accessToken(channelId, controller.signal)
          if (!token) return null
          const refreshed = await readQqGateway({ getPlatformFetch: this.deps.getPlatformFetch }, token, controller.signal)
          return refreshed.ok ? refreshed.value.url : null
        }
      })
      this.hosts.set(channelId, host)
      await host.start()
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
    this.tokens.clear()
  }

  stopAllAndFence(fence: () => void): void {
    for (const channelId of [...this.lifetimes.keys()]) this.stop(channelId)
    fence()
  }

  /** 换 access token（带缓存）：凭据读不出来返回 null，换 token 失败也返回 null。 */
  private async accessToken(channelId: string, signal: AbortSignal): Promise<string | null> {
    if (signal.aborted) return null
    const now = this.deps.now?.() ?? Date.now()
    const cached = this.tokens.get(channelId)
    if (cached && cached.expiresAt - 60_000 > now) return cached.accessToken

    const credential = this.deps.getCredential(channelId)
    if (!credential) return null
    let secret: Record<string, string> | null
    try {
      secret = await this.deps.vault.get(credential.ref)
    } catch {
      // 读不出来当「没有凭据」：不是网络问题，别让读者去查代理。
      return null
    }
    const appId = secret?.app_id
    const clientSecret = secret?.client_secret
    if (!appId || !clientSecret || signal.aborted) return null
    const exchanged = await exchangeQqAccessToken(
      { getPlatformFetch: this.deps.getPlatformFetch },
      { appId, clientSecret },
      signal
    )
    if (!exchanged.ok || signal.aborted) return null
    // `expires_in` 缺失时按 60s 处理：能救一次就用一次，不假装永不过期。
    const lifetimeMs = (exchanged.value.expiresInSeconds > 0 ? exchanged.value.expiresInSeconds : 60) * 1_000
    this.tokens.set(channelId, { accessToken: exchanged.value.accessToken, expiresAt: now + lifetimeMs })
    return exchanged.value.accessToken
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

/**
 * 默认订阅位（官方「事件订阅 Intents」）：
 * `GUILDS`(1<<0) + `GROUP_AND_C2C_EVENT`(1<<25) + `PUBLIC_GUILD_MESSAGES`(1<<30)。
 *
 * 后两个分别对应「群里 @ / 单聊」与「频道里 @」这两类消息事件。三者都不是特权位——QQ 没有
 * Discord 那种「不开开关整条连接被拒」的 intent，但多要一个用不到的大类只会让权限申请和推送量变大。
 */
export const QQ_DEFAULT_INTENTS = (1 << 0) | (1 << 25) | (1 << 30)
