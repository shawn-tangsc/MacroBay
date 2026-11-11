import { describe, expect, it, vi } from 'vitest'

import { createAgentPlatformDatabase } from '../../db/createAgentPlatformDatabase'
import { DiscordDeliveryTransport } from './DiscordDeliveryTransport'
import { DISCORD_DEFAULT_INTENTS, DiscordRuntimeManager } from './DiscordRuntimeManager'
import { DiscordRuntimeRepository } from './DiscordRuntimeRepository'

/**
 * Discord 运行时管理器的判据：**没有许可就不开连接**，开了之后生命周期归这条通道自己。
 *
 * 三次准入（owner 令牌 / 现役代际 / 凭据可读）全部用假 fetch + 假 socket 驱动：
 * 这里要证的是「谁有资格连、连了之后归谁停」，不是「能连上 Discord」。
 */

const TOKEN = 'discord-bot-token-secret'

describe('discord runtime manager', () => {
  it('opens nothing without an owned lifecycle permit', async () => {
    const harness = createHarness()
    await expect(harness.manager.start('discord-a', 1, 'wrong-owner')).resolves.toBe(false)
    expect(harness.fetch).not.toHaveBeenCalled()
    expect(harness.sockets).toHaveLength(0)
  })

  it('never tears down a live connection just because another owner asked to start', async () => {
    const harness = createHarness()
    await expect(harness.manager.start('discord-a', 1, 'owner-a')).resolves.toBe(true)
    const fetchCallsBefore = harness.fetch.mock.calls.length

    // 别的 owner 令牌来抢：拒掉它，但**不许**顺手把正在跑的那条关掉。
    await expect(harness.manager.start('discord-a', 1, 'other-owner')).resolves.toBe(false)
    expect(harness.sockets).toHaveLength(1)
    expect(harness.sockets[0]?.closed).toBe(false)
    expect(harness.fetch.mock.calls.length).toBe(fetchCallsBefore)
  })

  it('hands the gateway and the bot identity to one connection, then stops only its own', async () => {
    const harness = createHarness()
    await expect(harness.manager.start('discord-a', 1, 'owner-a')).resolves.toBe(true)

    expect(harness.fetch.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([
      'https://discord.com/api/v10/gateway/bot',
      'https://discord.com/api/v10/users/@me'
    ]))
    expect(harness.sockets).toHaveLength(1)
    expect(harness.socketUrls).toEqual(['wss://gateway.discord.gg'])

    // 别的 owner 令牌停不掉我；自己的令牌才行。
    harness.manager.stop('discord-a', 'other-owner')
    expect(harness.sockets[0]?.closed).toBe(false)
    harness.manager.stop('discord-a', 'owner-a')
    expect(harness.sockets[0]?.closed).toBe(true)
  })

  it('refuses a gateway url that is not wss and leaves no socket behind', async () => {
    const harness = createHarness({ gatewayUrl: 'http://gateway.example.test' })
    // REST 这一跳已经能分清原因，别再回一个光秃秃的 false。
    await expect(harness.manager.start('discord-a', 1, 'owner-a')).resolves.toEqual({
      ok: false,
      reason: 'discord-provider-rejected'
    })
    expect(harness.sockets).toHaveLength(0)
  })

  it('drops the handshake when the generation goes stale while it is in flight', async () => {
    let active = true
    const harness = createHarness({
      onFetch: () => { active = false },
      isCurrentActive: () => active
    })
    await expect(harness.manager.start('discord-a', 1, 'owner-a')).resolves.toBe(false)
    expect(harness.sockets).toHaveLength(0)
  })

  it('returns the 4014 close code as the start reason, not a bare false', async () => {
    const harness = createHarness({ startWindowMs: 2_000, dropOnOpen: 4_014 })
    await expect(harness.manager.start('discord-a', 1, 'owner-a')).resolves.toEqual({
      ok: false,
      reason: 'discord-intents-disallowed',
      closeCode: 4_014
    })
  })

  it('says the gateway address was blocked instead of blaming the token, and opens nothing', async () => {
    const harness = createHarness({ gatewayStatus: 403 })
    await expect(harness.manager.start('discord-a', 1, 'owner-a')).resolves.toEqual({
      ok: false,
      reason: 'discord-gateway-endpoint-blocked',
      providerCode: '40333'
    })
    // 根因在 UA/边缘，不在连接：没有可用地址就不该硬连一个猜出来的地址。
    expect(harness.sockets).toHaveLength(0)
  })

  it('registers the delivery client only for as long as the channel runs', async () => {
    const harness = createHarness()
    await harness.manager.start('discord-a', 1, 'owner-a')

    await expect(harness.delivery.send({
      channelId: 'discord-a',
      providerConversationKey: 'discord:conversation:guild:222',
      text: 'hello',
      idempotencyKey: 'opaque'
    })).resolves.toEqual({ kind: 'delivered' })

    harness.manager.stop('discord-a', 'owner-a')
    // 停掉之后不再有客户端：投递必须报「宿主不可用」，而不是找一个已经关掉的通道发。
    await expect(harness.delivery.send({
      channelId: 'discord-a',
      providerConversationKey: 'discord:conversation:guild:222',
      text: 'hello',
      idempotencyKey: 'opaque-2'
    })).resolves.toEqual({ kind: 'failed', code: 'delivery-host-unavailable' })
  })
})

describe('discord default intents', () => {
  it('asks for message content and nothing else privileged', () => {
    // 4014 的成因就是这个掩码：只要有一个特权位没在 Portal 打开，整条连接被拒。
    expect(DISCORD_DEFAULT_INTENTS).toBe((1 << 0) | (1 << 9) | (1 << 12) | (1 << 15))
    expect(DISCORD_DEFAULT_INTENTS & (1 << 8)).toBe(0) // GUILD_PRESENCES：不要在线状态
    expect(DISCORD_DEFAULT_INTENTS & (1 << 1)).toBe(0) // GUILD_MEMBERS：不要成员名单
    expect(DISCORD_DEFAULT_INTENTS & (1 << 15)).not.toBe(0) // MESSAGE_CONTENT：读正文必须有
  })
})

function createHarness(options: {
  gatewayUrl?: string
  isCurrentActive?: () => boolean
  onFetch?: () => void
  /** 默认 0：用例不等那 8 秒窗口；要验「早期的致命结论」时传一个窗口并让假 socket 主动关。 */
  startWindowMs?: number
  /** 假 socket 一建好就用这个关闭码掉线（模拟 4014 这类早期致命关闭）。 */
  dropOnOpen?: number
  /** `/gateway/bot` 的状态码（403 模拟这次用户遇到的「取地址被挡」）。 */
  gatewayStatus?: number
  /** `/users/@me` 的状态码（401 模拟 Token 真的不对）。 */
  botStatus?: number
} = {}) {
  const sockets: FakeSocket[] = []
  const socketUrls: string[] = []
  const audits: string[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    options.onFetch?.()
    if (url.endsWith('/gateway/bot')) {
      if (options.gatewayStatus !== undefined) {
        return json({ message: 'internal network error', code: 40333 }, options.gatewayStatus)
      }
      return json({ url: options.gatewayUrl ?? 'wss://gateway.discord.gg', shards: 1 })
    }
    if (url.endsWith('/users/@me')) {
      if (options.botStatus !== undefined) return json({ message: '401: Unauthorized' }, options.botStatus)
      return json({ id: '999', username: 'macrobay-bot' })
    }
    if (url.includes('/channels/')) return json({ id: 'sent' })
    return json({})
  })
  const fetch = fetchMock as unknown as typeof globalThis.fetch

  const delivery = new DiscordDeliveryTransport()
  const manager = new DiscordRuntimeManager({
    inbound: {} as never,
    // 记录运行审计（真实仓储要求库里有现役代际，这里只需要「写没写那一行」）。
    runtime: {
      auditIfCurrent: (_channelId: string, _generation: number, code: string) => { audits.push(code); return true },
      commitIfCurrent: () => true
    } as never,
    vault: { get: async () => ({ bot_token: TOKEN }) } as never,
    getPlatformFetch: () => fetch,
    createPlatformWebSocket: class {
      constructor(url: string) {
        const socket = new FakeSocket()
        sockets.push(socket)
        socketUrls.push(url)
        if (options.dropOnOpen !== undefined) {
          const code = options.dropOnOpen
          setTimeout(() => { socket.closeWith(code) }, 0)
        }
        return socket as never
      }
    } as never,
    delivery,
    getCredential: () => ({ ref: 'known-ref', revision: 1 }),
    ownsLifecycleOwner: (channelId, token, generation) => channelId === 'discord-a' && token === 'owner-a' && generation === 1,
    isCurrentActive: options.isCurrentActive ?? ((channelId, generation) => channelId === 'discord-a' && generation === 1),
    userAgent: 'MacroBay/test (Discord adapter)',
    startWindowMs: options.startWindowMs ?? 0
  })
  return { manager, delivery, fetch: fetchMock, sockets, socketUrls, audits }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

class FakeSocket {
  closed = false
  onclose: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null

  close(): void {
    this.closed = true
    this.onclose?.({})
  }

  /** 对端关闭：真实 socket 带关闭码，这里照同形状交出来。 */
  closeWith(code: number): void {
    this.closed = true
    this.onclose?.({ code })
  }

  send(_value: string): void {}
}
