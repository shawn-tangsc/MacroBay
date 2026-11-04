import { describe, expect, it, vi } from 'vitest'

import { requestConfiguredChatProtocolCompletion } from './chatProtocolTransport'

/**
 * 凭据判定信号：只有「明确属于认证类」的失败才报 invalid，成功报 ok，其余一律不报。
 * 这条闸门就是为了防止「改个 Key 赶上网络抖动 → 被误报成凭据失效」。
 */
const signal = vi.fn()

function respond(status: number, body = '{"error":{"message":"nope"}}'): typeof fetch {
  return (async () =>
    new Response(body, { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
}

const base = {
  protocol: 'messages' as const,
  endpoints: [{ protocol: 'messages' as const, baseUrl: 'https://example.invalid' }],
  apiKey: 'sk-test',
  providerId: 'silicon',
  modelId: 'chat-a',
  messages: [{ role: 'user' as const, content: 'hi' }],
  onProviderCredentialSignal: signal
}

describe('credential signal from the chat transport', () => {
  it('reports invalid for 401/403 and reports ok for a successful request', async () => {
    signal.mockClear()
    await expect(
      requestConfiguredChatProtocolCompletion({ ...base, fetch: respond(401) })
    ).rejects.toBeTruthy()
    expect(signal).toHaveBeenCalledTimes(1)
    expect(signal).toHaveBeenCalledWith({ providerId: 'silicon', state: 'invalid' })

    signal.mockClear()
    await expect(
      requestConfiguredChatProtocolCompletion({
        ...base,
        fetch: respond(200, JSON.stringify({ content: [{ type: 'text', text: 'ok' }], usage: {} }))
      })
    ).resolves.toBeTruthy()
    expect(signal).toHaveBeenCalledWith({ providerId: 'silicon', state: 'ok' })
  })

  it('never reports for timeouts, proxy errors or rate limits', async () => {
    for (const error of [
      Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
      Object.assign(new Error('proxy'), { name: 'ProxyError' }),
      Object.assign(new Error('rate'), { name: 'RateLimitedError' })
    ]) {
      signal.mockClear()
      const fetchImpl = (async () => {
        throw error
      }) as unknown as typeof fetch
      await expect(requestConfiguredChatProtocolCompletion({ ...base, fetch: fetchImpl })).rejects.toBeTruthy()
      // 网络/代理/限流都不是凭据问题：一次都不许报。
      expect(signal).not.toHaveBeenCalled()
    }
  })
})
