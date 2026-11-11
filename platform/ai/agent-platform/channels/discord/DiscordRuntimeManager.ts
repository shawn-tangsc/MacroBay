import type { PlatformWebSocketConstructor } from '../../../../network/platformWebSocket'
import type { ChannelCredentialVault } from '../../../../secrets/channels/channelCredentialContracts'
import type { ChannelInboundService } from '../ChannelInboundService'
import { DiscordApiClient } from './DiscordApiClient'
import { DiscordDeliveryTransport } from './DiscordDeliveryTransport'
import { DiscordGatewayHost } from './DiscordGatewayHost'
import { DiscordRuntimeRepository } from './DiscordRuntimeRepository'

/**
 * Discord 运行时：一条通道一份生命周期（`AbortController` + 代际 + owner 令牌）。
 *
 * 三步准入，任何一步不过就一条连接都不开：
 * 1. 手上这个 owner 令牌确实属于这一代（`ownsLifecycleOwner`）；
 * 2. 这一代仍是现役（`isCurrentActive`），且握手期间没被换掉；
 * 3. 凭据能读出来（读不到当没有，不当成网络故障）。
 *
 * 握手用注入的平台 `fetch`：先 `/gateway/bot` 拿接入点，再 `/users/@me` 拿机器人 id——
 * 后者同时是启用自检要的那一次请求，也决定「这条消息是不是在叫我」。
 */
export class DiscordRuntimeManager {
  private readonly hosts = new Map<string, DiscordGatewayHost>()
  private readonly lifetimes = new Map<string, { controller: AbortController; ownerToken: string }>()

  constructor(private readonly deps: {
    inbound: ChannelInboundService
    runtime: DiscordRuntimeRepository
    vault: ChannelCredentialVault
    getPlatformFetch: () => typeof fetch
    createPlatformWebSocket: PlatformWebSocketConstructor
    delivery: DiscordDeliveryTransport
    getCredential: (channelId: string) => { ref: string; revision: number } | null
    ownsLifecycleOwner: (channelId: string, token: string, generation: number) => boolean
    isCurrentActive: (channelId: string, generation: number) => boolean
    /**
     * 启动结论的等待窗口（毫秒）：窗口内等到 READY 或 4014/4003/4004 就当场定论，
     * 等不到就按旧行为放行（继续重连）。默认 8 秒；用例传 0 走「不等」。
     */
    startWindowMs?: number
  }) {}

  /**
   * 启动结果带**真原因**：这一步以前只回布尔，于是 4014（Message Content 没开）在界面上只剩
   * 一句「连接没能起来」——用户唯一能做的就是把 Token 换一遍，而换一百次也没用。
   */
  async start(
    channelId: string,
    generation: number,
    ownerToken: string
  ): Promise<boolean | { ok: false; reason: string; closeCode?: number | null }> {
    if (!ownerToken || !this.deps.ownsLifecycleOwner(channelId, ownerToken, generation)) return false
    this.stop(channelId)
    if (!this.generationIsOurs(channelId, generation, ownerToken)) return false

    const controller = new AbortController()
    this.lifetimes.set(channelId, { controller, ownerToken })
    try {
      const readToken = (): Promise<string | null> => this.token(channelId, controller.signal)
      const client = new DiscordApiClient({ getPlatformFetch: this.deps.getPlatformFetch, token: readToken })
      const [gateway, botUser] = await Promise.all([
        client.gatewayBot(controller.signal),
        client.currentUser(controller.signal)
      ])
      const isCurrent = (): boolean => this.isCurrent(channelId, generation, ownerToken, controller)
      // 握手期间可能已经被停用/换代：回来再判一次，别拿一个过期的接入点开连接。
      if (!gateway.ok || !botUser.ok || !isCurrent()) {
        this.stopOwned(channelId, controller)
        // REST 这一跳已经能分清「Token 错」与「网络/代理不通」，别把两种处境并成一个 false。
        const rest = gateway.ok ? botUser : gateway
        return rest.ok ? false : { ok: false, reason: rest.code }
      }

      this.deps.delivery.setClient(channelId, client, { isCurrent, signal: controller.signal })
      const host = new DiscordGatewayHost({
        channelId,
        generation,
        gatewayUrl: gateway.value.url,
        token: readToken,
        intents: DISCORD_DEFAULT_INTENTS,
        inbound: this.deps.inbound,
        botUserId: botUser.value.id,
        runtime: this.deps.runtime,
        createPlatformWebSocket: this.deps.createPlatformWebSocket as never,
        isCurrent,
        signal: controller.signal,
        ...(this.deps.startWindowMs === undefined ? {} : { startWindowMs: this.deps.startWindowMs }),
        refreshGatewayUrl: async () => {
          const refreshed = await client.gatewayBot(controller.signal)
          return refreshed.ok ? refreshed.value.url : null
        }
      })
      this.hosts.set(channelId, host)
      await host.start()
      // 等一句结论：READY 到了才算起来；4014/4003/4004 在这一个窗口内会当场判失败。
      const outcome = await host.waitForOutcome()
      if (!outcome.ok) {
        this.stopOwned(channelId, controller)
        return { ok: false, reason: outcome.reason, closeCode: outcome.closeCode }
      }
      return true
    } catch {
      this.stopOwned(channelId, controller)
      return false
    }
  }

  stop(channelId: string, ownerToken?: string): void {
    const lifetime = this.lifetimes.get(channelId)
    // 带 ownerToken 时只停自己那一条：别的代际换过之后不该被我们顺手带走。
    if (lifetime && (!ownerToken || lifetime.ownerToken === ownerToken)) this.stopOwned(channelId, lifetime.controller)
  }

  async dispose(): Promise<void> {
    for (const channelId of [...this.lifetimes.keys()]) this.stop(channelId)
  }

  stopAllAndFence(fence: () => void): void {
    for (const channelId of [...this.lifetimes.keys()]) this.stop(channelId)
    fence()
  }

  private token(channelId: string, signal: AbortSignal): Promise<string | null> {
    const credential = this.deps.getCredential(channelId)
    if (!credential || signal.aborted) return Promise.resolve(null)
    return this.deps.vault.get(credential.ref).then(
      (value) => (signal.aborted ? null : value?.bot_token ?? null),
      // 读不出来当「没有凭据」：这不是网络故障，别让界面把读者指去查代理。
      () => null
    )
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
 * 默认订阅位（Discord 文档的 Intents 位表，逐位核对过）：
 * `GUILDS`(1<<0) + `GUILD_MESSAGES`(1<<9) + `DIRECT_MESSAGES`(1<<12) + `MESSAGE_CONTENT`(1<<15) = 37377。
 *
 * **特权位只要一个**：`MESSAGE_CONTENT`（读正文必须有）。
 * `GUILD_PRESENCES`(1<<8)、`GUILD_MEMBERS`(1<<1) 我们不需要——多要一个特权位，就多一个被网关拒的理由。
 *
 * `MESSAGE_CONTENT` 没在开发者后台打开时，网关会用 **4014 Disallowed intent(s)** 直接关掉整条连接
 * （不是「连上了但收不到正文」）。所以宿主把 4014 单独译成 `discord-intents-disallowed` 并**停下不再重连**：
 * 这不是适配器坏了，是后台少点了一个开关，重连一万次也不会变好。
 */
export const DISCORD_DEFAULT_INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15)
