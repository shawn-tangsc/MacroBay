import { describe, expect, it, vi } from 'vitest'

import { QQ_DEFAULT_INTENTS, QqRuntimeManager } from './QqRuntimeManager'
import { QqDeliveryTransport } from './QqDeliveryTransport'
import type { QqRuntimeRepository } from './QqRuntimeRepository'

/**
 * QQ 运行时管理器的判据：没有许可就不开连接、token 只在需要时换且会复用、停用即断。
 * 假 fetch + 假 socket，一条真连接都不开。
 */

const APP_ID = '102030405'
const SECRET = 'qq-client-secret-value'

describe('qq runtime manager', () => {
  it('opens nothing without an owned lifecycle permit', async () => {
    const harness = createHarness()
    await expect(harness.manager.start('qq-a', 1, 'wrong-owner')).resolves.toBe(false)
    expect(harness.fetch).not.toHaveBeenCalled()
    expect(harness.sockets).toHaveLength(0)
  })

  it('never tears down a live connection because another owner asked to start', async () => {
    const harness = createHarness()
    await expect(harness.manager.start('qq-a', 1, 'owner-a')).resolves.toBe(true)
    const before = harness.urls().length

    await expect(harness.manager.start('qq-a', 1, 'other-owner')).resolves.toBe(false)
    expect(harness.sockets).toHaveLength(1)
    expect(harness.sockets[0]?.closed).toBe(false)
    expect(harness.urls()).toHaveLength(before)
  })

  it('exchanges the credentials, then opens the gateway and registers delivery', async () => {
    const harness = createHarness()
    await expect(harness.manager.start('qq-a', 1, 'owner-a')).resolves.toBe(true)

    expect(harness.urls()).toEqual([
      'https://bots.qq.com/app/getAppAccessToken',
      'https://api.sgroup.qq.com/gateway'
    ])
    expect(harness.sockets).toHaveLength(1)
    expect(harness.socketUrls).toEqual(['wss://api.sgroup.qq.com/websocket/'])

    await expect(harness.delivery.send({
      channelId: 'qq-a',
      providerConversationKey: 'qq:conversation:group:g-1',
      text: 'hi',
      idempotencyKey: 'opaque'
    })).resolves.toEqual({ kind: 'delivered' })

    harness.manager.stop('qq-a', 'owner-a')
    await expect(harness.delivery.send({
      channelId: 'qq-a',
      providerConversationKey: 'qq:conversation:group:g-1',
      text: 'hi',
      idempotencyKey: 'opaque-2'
    })).resolves.toEqual({ kind: 'failed', code: 'delivery-host-unavailable' })
  })

  it('records that start was entered, and which branch rejected it', async () => {
    // 用户现场：点了启用、库里 0 行审计，查不出是没进 start 还是早退。入口那行必须先有。
    const ok = createHarness()
    await expect(ok.manager.start('qq-a', 1, 'owner-a')).resolves.toBe(true)
    expect(ok.audits).toContain('qq-start:g1')

    // owner 令牌不匹配：最外层早退，也要说得出是哪一支。
    const wrongOwner = createHarness()
    await expect(wrongOwner.manager.start('qq-a', 1, 'other-owner')).resolves.toBe(false)
    expect(wrongOwner.audits).toContain('qq-start:g1')
    expect(wrongOwner.audits).toContain('qq-start-rejected:owner:g1')

    // 凭据读不出来：换 token 那一步拒掉。
    const noToken = createHarness({ noToken: true })
    await expect(noToken.manager.start('qq-a', 1, 'owner-a')).resolves.toBe(false)
    expect(noToken.audits).toContain('qq-start-rejected:token')
  })

  it('reuses the access token until it is close to expiry', async () => {
    let clock = 0
    const harness = createHarness({ now: () => clock })
    await harness.manager.start('qq-a', 1, 'owner-a')
    harness.manager.stop('qq-a', 'owner-a')
    await harness.manager.start('qq-a', 1, 'owner-a')
    // 第二次启动只重新取网关地址，不再换 token。
    expect(harness.urls().filter((url) => url.includes('getAppAccessToken'))).toHaveLength(1)

    clock = 7_200_000
    harness.manager.stop('qq-a', 'owner-a')
    await harness.manager.start('qq-a', 1, 'owner-a')
    // 过了有效期才再换一次。
    expect(harness.urls().filter((url) => url.includes('getAppAccessToken'))).toHaveLength(2)
  })

  it('refuses a gateway address that is not wss, and leaks no socket', async () => {
    const harness = createHarness({ gatewayUrl: 'http://api.sgroup.qq.com/websocket/' })
    await expect(harness.manager.start('qq-a', 1, 'owner-a')).resolves.toBe(false)
    expect(harness.sockets).toHaveLength(0)
  })

  it('drops the handshake when the generation goes stale while it is in flight', async () => {
    let active = true
    const harness = createHarness({ onFetch: () => { active = false }, isCurrentActive: () => active })
    await expect(harness.manager.start('qq-a', 1, 'owner-a')).resolves.toBe(false)
    expect(harness.sockets).toHaveLength(0)
  })
})

describe('qq default intents', () => {
  it('asks only for the event groups the adapter consumes', () => {
    expect(QQ_DEFAULT_INTENTS).toBe((1 << 0) | (1 << 25) | (1 << 30))
    // 用不到的大类不订阅：多一个位就多一份权限与推送量。
    expect(QQ_DEFAULT_INTENTS & (1 << 1)).toBe(0) // GUILD_MEMBERS
    expect(QQ_DEFAULT_INTENTS & (1 << 10)).toBe(0) // GUILD_MESSAGE_REACTIONS
  })
})

function createHarness(options: {
  gatewayUrl?: string
  isCurrentActive?: () => boolean
  onFetch?: () => void
  now?: () => number
  /** 凭据读不出来（诊断分支用）。 */
  noToken?: boolean
} = {}) {
  const sockets: FakeSocket[] = []
  const audits: string[] = []
  const socketUrls: string[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    options.onFetch?.()
    if (url.includes('getAppAccessToken')) return json({ access_token: 'qq-access-token', expires_in: 7_200 })
    if (url.endsWith('/gateway')) return json({ url: options.gatewayUrl ?? 'wss://api.sgroup.qq.com/websocket/' })
    return json({ id: 'sent' })
  })
  const delivery = new QqDeliveryTransport()
  const manager = new QqRuntimeManager({
    inbound: {} as never,
    runtime: {
      commitIfCurrent: () => true,
      auditIfCurrent: (_channelId: string, _generation: number, code: string) => { audits.push(code); return true },
      // 诊断专用写入：启动失败时正常审计会被授权闸门滤掉，这里收集的就是那几行。
      auditDiagnostic: (_channelId: string, code: string) => { audits.push(code) }
    } as unknown as QqRuntimeRepository,
    vault: { get: async () => (options.noToken ? { app_id: APP_ID } : { app_id: APP_ID, client_secret: SECRET }) } as never,
    getPlatformFetch: () => fetchMock as unknown as typeof globalThis.fetch,
    createPlatformWebSocket: class {
      constructor(url: string) {
        const socket = new FakeSocket()
        sockets.push(socket)
        socketUrls.push(url)
        return socket as never
      }
    } as never,
    delivery,
    getCredential: () => ({ ref: 'known-ref', revision: 1 }),
    ownsLifecycleOwner: (channelId, token, generation) => channelId === 'qq-a' && token === 'owner-a' && generation === 1,
    isCurrentActive: options.isCurrentActive ?? ((channelId, generation) => channelId === 'qq-a' && generation === 1),
    ...(options.now ? { now: options.now } : {})
  })
  return {
    manager,
    delivery,
    fetch: fetchMock,
    sockets,
    socketUrls,
    audits,
    urls: (): string[] => fetchMock.mock.calls.map(([input]) => String(input))
  }
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

  send(_value: string): void {}
}
