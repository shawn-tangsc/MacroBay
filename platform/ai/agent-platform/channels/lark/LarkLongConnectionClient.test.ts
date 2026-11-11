import { describe, expect, it, vi } from 'vitest'

import {
  createLarkLongConnection,
  larkWsTarget,
  toLongConnectionEvent,
  type LarkHttpInstance,
  type LarkLongConnectionEvent,
  type LarkProxyDecision
} from './LarkLongConnectionClient'

/**
 * 飞书长连接包装层的判据（这批的三条纪律，逐条钉住）：
 * 1. 代理**只**从注入的解析器来；
 * 2. **解析不出代理就不连**——不许落回默认直连（这台机器直连飞书必不通，那种失败会被误读成适配器坏）；
 * 3. SDK 的类型与事件体不外泄，对外只有我们自己的 `LarkLongConnectionEvent`。
 */

function harness(
  decision: LarkProxyDecision | null,
  options: { startThrows?: boolean; getPlatformFetch?: () => typeof fetch } = {}
) {
  const created: Array<{
    appId: string
    appSecret: string
    agent?: unknown
    handshakeTimeoutMs: number
    httpInstance?: LarkHttpInstance
  }> = []
  const closed: number[] = []
  const events: LarkLongConnectionEvent[] = []
  const connection = createLarkLongConnection({
    appId: 'cli_12345678',
    appSecret: 'app-secret-value',
    resolveProxy: async () => decision,
    // 生产注入的是平台 `platformFetch`；用例里换成能记账的假实现，断言「这一跳真的走了它」。
    getPlatformFetch: options.getPlatformFetch ?? (() => (async () => new Response('{}')) as typeof fetch),
    createWsClient: (createOptions) => {
      created.push(createOptions)
      return {
        start: async () => {
          if (options.startThrows) throw new Error('handshake failed')
        },
        close: () => { closed.push(1) }
      }
    }
  })
  return { connection, created, closed, events }
}

describe('lark long connection wrapper', () => {
  it('refuses to connect at all when the proxy cannot be resolved', async () => {
    const { connection, created } = harness(null)
    // 「解析不出来」不是「直连」：这台机器直连必不通，所以宁可不连，也不落回一个默认连接。
    await expect(connection.connect({ onEvent: () => {} })).resolves.toEqual({ ok: false, code: 'lark-proxy-unresolved' })
    expect(created).toHaveLength(0)
  })

  it('injects the proxy agent and a handshake timeout when a proxy is resolved', async () => {
    const { connection, created } = harness({ kind: 'proxy', url: 'http://127.0.0.1:7888' })
    await expect(connection.connect({ onEvent: () => {} })).resolves.toEqual({ ok: true })

    expect(created).toHaveLength(1)
    expect(created[0].appId).toBe('cli_12345678')
    expect(created[0].handshakeTimeoutMs).toBeGreaterThan(0)
    expect(created[0].agent).toBeDefined()
  })

  it('leaves the agent out only when the resolver says direct', async () => {
    const { connection, created } = harness({ kind: 'direct' })
    await expect(connection.connect({ onEvent: () => {} })).resolves.toEqual({ ok: true })
    // 显式直连才允许不带 agent；解析失败那条已经在上面被拦住了。
    expect('agent' in created[0]).toBe(false)
  })

  /**
   * 取 wss 地址那一跳必须走平台 fetch，不能落回 SDK 自带的 axios。
   *
   * 这条钉的是一个合规缺口：SDK 的默认 axios 只认 `HTTP(S)_PROXY` 环境变量，不读应用网络设置，
   * 于是这台机器上会直连飞书 → 失败 → 报 `lark-connect-failed`，看着像适配器坏了。
   * 去掉注入（`httpInstance` 不再传给工厂）时，下面第一条断言就会红——它是这条链的唯一判据。
   */
  it('sends the gateway-address request through the injected platform fetch', async () => {
    const calls: Array<{ url: string; method: string | undefined; body: unknown; headers: Record<string, string> }> = []
    const platformFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method,
        body: init?.body === undefined ? null : JSON.parse(String(init.body)),
        headers: Object.fromEntries(new Headers(init?.headers).entries())
      })
      return new Response(JSON.stringify({
        code: 0,
        data: { URL: 'wss://open.feishu.cn/callback/ws/abc', ClientConfig: { PingInterval: 120 } },
        msg: 'ok'
      }), { status: 200 })
    }) as typeof fetch

    const { connection, created } = harness({ kind: 'proxy', url: 'http://127.0.0.1:7888' }, { getPlatformFetch: () => platformFetch })
    await expect(connection.connect({ onEvent: () => {} })).resolves.toEqual({ ok: true })

    const httpInstance = created[0].httpInstance
    expect(httpInstance).toBeDefined()
    const body = await httpInstance!.request({
      url: 'https://open.feishu.cn/callback/ws/endpoint',
      method: 'post',
      data: { AppID: 'cli_12345678', AppSecret: 'app-secret-value' },
      headers: { locale: 'zh' },
      timeout: 15_000
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://open.feishu.cn/callback/ws/endpoint')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body).toEqual({ AppID: 'cli_12345678', AppSecret: 'app-secret-value' })
    expect(calls[0].headers.locale).toBe('zh')
    // SDK 要的是响应体本身（它的响应拦截器已经解过一层），不是包装过的 Response。
    expect(body).toEqual({
      code: 0,
      data: { URL: 'wss://open.feishu.cn/callback/ws/abc', ClientConfig: { PingInterval: 120 } },
      msg: 'ok'
    })
  })

  it('turns a failed platform fetch into a thrown error so the SDK treats it as no address', async () => {
    const platformFetch = (async () => new Response('{"code":10003,"msg":"invalid param"}', { status: 400 })) as typeof fetch
    const { connection, created } = harness({ kind: 'proxy', url: 'http://127.0.0.1:7888' }, { getPlatformFetch: () => platformFetch })
    await connection.connect({ onEvent: () => {} })

    // 抛错而不是回一个空对象：SDK 的 catch 会把它当「拉不到地址」，不会拿空 URL 去连。
    await expect(created[0].httpInstance!.request({
      url: 'https://open.feishu.cn/callback/ws/endpoint',
      method: 'post',
      data: {}
    })).rejects.toThrow(/lark-http-400/u)
  })

  it('reports a failed handshake instead of pretending to be connected, and closes the client', async () => {
    const { connection, created, closed } = harness({ kind: 'proxy', url: 'http://127.0.0.1:7888' }, { startThrows: true })
    await expect(connection.connect({ onEvent: () => {} })).resolves.toEqual({ ok: false, code: 'lark-connect-failed' })
    expect(created).toHaveLength(1)
    expect(closed).toHaveLength(1)
  })

  it('folds an SDK payload into our own event shape', () => {
    const event = toLongConnectionEvent({
      schema: '2.0',
      header: { event_id: 'evt-1', event_type: 'im.message.receive_v1' },
      event: { message: { message_id: 'om_1' } }
    })
    expect(event).toEqual({
      eventId: 'evt-1',
      eventType: 'im.message.receive_v1',
      payload: {
        schema: '2.0',
        header: { event_id: 'evt-1', event_type: 'im.message.receive_v1' },
        event: { message: { message_id: 'om_1' } }
      }
    })
    // 形状是我们自己的：三个键，不多不少；SDK 的类型没有出现在这里。
    expect(Object.keys(event).sort()).toEqual(['eventId', 'eventType', 'payload'])
  })

  it('resolves the proxy against the Lark host, not against a provider-supplied url', async () => {
    const resolveProxy = vi.fn(async (): Promise<LarkProxyDecision> => ({ kind: 'direct' }))
    const connection = createLarkLongConnection({
      appId: 'cli_1',
      appSecret: 'secret',
      resolveProxy,
      getPlatformFetch: () => (async () => new Response('{}')) as typeof fetch,
      createWsClient: () => ({ start: () => {}, close: () => {} })
    })
    await connection.connect({ onEvent: () => {} })
    expect(resolveProxy).toHaveBeenCalledWith(larkWsTarget)
  })
})
