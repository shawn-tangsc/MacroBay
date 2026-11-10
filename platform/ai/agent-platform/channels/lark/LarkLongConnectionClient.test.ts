import { describe, expect, it, vi } from 'vitest'

import {
  createLarkLongConnection,
  larkWsTarget,
  toLongConnectionEvent,
  type LarkLongConnectionEvent,
  type LarkProxyDecision
} from './LarkLongConnectionClient'

/**
 * 飞书长连接包装层的判据（这批的三条纪律，逐条钉住）：
 * 1. 代理**只**从注入的解析器来；
 * 2. **解析不出代理就不连**——不许落回默认直连（这台机器直连飞书必不通，那种失败会被误读成适配器坏）；
 * 3. SDK 的类型与事件体不外泄，对外只有我们自己的 `LarkLongConnectionEvent`。
 */

function harness(decision: LarkProxyDecision | null, options: { startThrows?: boolean } = {}) {
  const created: Array<{ appId: string; appSecret: string; agent?: unknown; handshakeTimeoutMs: number }> = []
  const closed: number[] = []
  const events: LarkLongConnectionEvent[] = []
  const connection = createLarkLongConnection({
    appId: 'cli_12345678',
    appSecret: 'app-secret-value',
    resolveProxy: async () => decision,
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
      createWsClient: () => ({ start: () => {}, close: () => {} })
    })
    await connection.connect({ onEvent: () => {} })
    expect(resolveProxy).toHaveBeenCalledWith(larkWsTarget)
  })
})
