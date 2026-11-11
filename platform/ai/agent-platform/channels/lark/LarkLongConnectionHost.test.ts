import { describe, expect, it, vi } from 'vitest'

import { LarkLongConnectionHost } from './LarkLongConnectionHost'
import type { LarkLongConnection, LarkLongConnectionEvent } from './LarkLongConnectionClient'
import type { LarkRuntimeRepository } from './LarkRuntimeRepository'

/**
 * 飞书宿主：代理不可用就不连、事件进管道、确认只在落库之后。
 * 全部假连接 + 假管道，一条真连接都不开。
 */

const TEXT_PAYLOAD = {
  schema: '2.0',
  header: { event_id: 'evt-1', event_type: 'im.message.receive_v1' },
  event: {
    sender: { sender_type: 'user', sender_id: { open_id: 'ou_1' } },
    message: { message_id: 'om_1', chat_id: 'oc_1', chat_type: 'p2p', message_type: 'text', content: '{"text":"hello"}' }
  }
}

describe('lark long connection host', () => {
  it('refuses to start when the proxy cannot be resolved, and says so', async () => {
    const harness = createHarness({ connectResult: { ok: false, code: 'lark-proxy-unresolved' } })
    await expect(harness.host.start()).resolves.toBe(false)
    expect(harness.audits()).toContain('lark-proxy-unresolved')
    // 包装层拒一次，宿主再拒一次：运行时不能以为自己跑起来了。
    expect(harness.inbound.receive).not.toHaveBeenCalled()
  })

  it('delivers a message only after the cursor is committed', async () => {
    const harness = createHarness()
    await harness.host.start()
    await harness.emit(TEXT_PAYLOAD)

    expect(harness.inboundRequests[0]).toMatchObject({
      providerEventKey: 'lark:event:evt-1',
      providerMessageKey: 'lark:message:om_1',
      conversationKind: 'direct',
      mentionedBot: true,
      text: 'hello'
    })
    expect(harness.order).toEqual(['receive', 'hash', 'commit'])
    expect(harness.runtime.commitIfCurrent).toHaveBeenCalledWith('lark-a', 1, 'hash:lark:event:evt-1')
  })

  it('refuses to acknowledge when the pipeline asks to retry', async () => {
    const harness = createHarness({ receive: async () => ({ disposition: 'retry' }) })
    await harness.host.start()

    // 抛错 = 不确认，平台会重推；返回成功就等于把一条没落库的消息认了。
    await expect(harness.emit(TEXT_PAYLOAD)).rejects.toThrow('lark-inbound-retry')
    expect(harness.runtime.commitIfCurrent).not.toHaveBeenCalled()
    expect(harness.audits()).toContain('lark-inbound-retry')
  })

  it('refuses to commit a cursor from a generation that is no longer current', async () => {
    const harness = createHarness({ commitResult: false })
    await harness.host.start()
    // 旧代际：确认必须抛错（平台会重推），而不是把游标写进一条已经不属于当前运行时的通道。
    await expect(harness.emit(TEXT_PAYLOAD)).rejects.toThrow('lark-sequence-stale')
    expect(harness.audits()).toContain('lark-sequence-stale')
  })

  it('ignores its own messages and never calls the pipeline for them', async () => {
    const harness = createHarness()
    await harness.host.start()
    await harness.emit({
      ...TEXT_PAYLOAD,
      event: { ...TEXT_PAYLOAD.event, sender: { sender_type: 'app', sender_id: { open_id: 'ou_bot' } } }
    })
    expect(harness.inbound.receive).not.toHaveBeenCalled()
  })

  it('refuses to acknowledge after the host is stopped', async () => {
    const harness = createHarness()
    await harness.host.start()
    harness.host.stop()
    await expect(harness.emit(TEXT_PAYLOAD)).rejects.toThrow('lark-host-not-current')
  })
})

function createHarness(options: {
  connectResult?: { ok: true } | { ok: false; code: 'lark-proxy-unresolved' | 'lark-connect-failed' }
  receive?: (request: Record<string, unknown>) => Promise<{ disposition: string }>
  commitResult?: boolean
} = {}) {
  const auditCodes: string[] = []
  const order: string[] = []
  const inboundRequests: Array<Record<string, unknown>> = []
  let emitHandler: ((event: LarkLongConnectionEvent) => Promise<void>) | null = null
  const inbound = {
    receive: vi.fn(async (request: Record<string, unknown>) => {
      inboundRequests.push(request)
      order.push('receive')
      const result = options.receive ? await options.receive(request) : { disposition: 'acknowledged' }
      if (result.disposition !== 'retry') await (request.acknowledge as () => Promise<void>)()
      return result
    })
  }
  const runtime = {
    commitIfCurrent: vi.fn(() => {
      order.push('commit')
      return options.commitResult ?? true
    }),
    auditIfCurrent: vi.fn((_channelId: string, _generation: number, code: string) => {
      auditCodes.push(code)
      return true
    })
  }
  const host = new LarkLongConnectionHost({
    channelId: 'lark-a',
    generation: 1,
    appId: 'cli_12345678',
    appSecret: 'app-secret',
    resolveProxy: async () => ({ kind: 'direct' }),
    getPlatformFetch: () => (async () => new Response('{}')) as typeof fetch,
    inbound: inbound as never,
    runtime: runtime as unknown as LarkRuntimeRepository,
    hashEventKey: async (eventKey) => {
      order.push('hash')
      return `hash:${eventKey}`
    },
    isCurrent: () => true,
    signal: new AbortController().signal,
    createConnection: ({ onEvent }) => {
      emitHandler = onEvent
      return {
        connect: async () => options.connectResult ?? { ok: true },
        close: () => {}
      } satisfies LarkLongConnection
    }
  })
  return {
    host,
    inbound,
    inboundRequests,
    runtime,
    order,
    audits: () => [...auditCodes],
    emit: async (payload: unknown) => {
      if (!emitHandler) throw new Error('connection was never attached')
      await emitHandler({ eventId: 'evt-1', eventType: 'im.message.receive_v1', payload })
    }
  }
}
