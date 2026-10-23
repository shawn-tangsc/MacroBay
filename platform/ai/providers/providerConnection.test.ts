import { describe, expect, it, vi } from 'vitest'

import type { ModelProvider } from './modelProviderTypes'
import { probeProviderProxyTarget, testModelProviderConnection } from './providerConnection'

function createProvider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: 'silicon',
    name: 'Silicon',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' },
      { protocol: 'messages', baseUrl: 'https://api.siliconflow.cn' }
    ],
    enabled: true,
    baseUrl: 'https://api.siliconflow.cn',
    apiKey: 'sk-test',
    isSystem: true,
    models: [
      {
        id: 'deepseek-ai/DeepSeek-V3.2',
        name: 'deepseek-ai/DeepSeek-V3.2',
        capabilities: { chat: true, vision: false, embedding: false, tools: true }
      }
    ],
    defaultChatModelId: 'deepseek-ai/DeepSeek-V3.2',
    ...overrides
  }
}

describe('provider connection test', () => {
  it('persists the current provider shape into a real OpenAI-compatible chat completion probe', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'ok' }), { status: 200 }))

    const result = await testModelProviderConnection(createProvider(), { fetch: fetchMock })

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.siliconflow.cn/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer sk-test',
          'content-type': 'application/json'
        }),
        body: expect.stringContaining('"model":"deepseek-ai/DeepSeek-V3.2"')
      })
    )
  })

  it('reports missing credentials before attempting a network request', async () => {
    const fetchMock = vi.fn()

    const result = await testModelProviderConnection(createProvider({ apiKey: '' }), { fetch: fetchMock })

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Enable the provider and set an API key first.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('tests a disabled provider without making it runtime-ready', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'ok' }), { status: 200 }))

    const result = await testModelProviderConnection(createProvider({ enabled: false }), { fetch: fetchMock })

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('reports provider errors with a decidable code and without leaking the API key', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 }))

    const result = await testModelProviderConnection(createProvider(), { fetch: fetchMock })

    // PLAT-61 诊断可用性：失败不再只有笼统一句，而是带可判定的 code；message 只保留安全的技术细节。
    expect(result).toMatchObject({
      ok: false,
      failureCode: 'http_401'
    })
    expect(result.message).toContain('HTTP 401')
    expect(result.message).not.toContain('sk-test')
  })

  it('redacts a key echoed by the provider or transport error', async () => {
    const provider = createProvider({ apiKey: 'fixture-provider-key-1234567890' })
    const response = await testModelProviderConnection(provider, {
      fetch: vi.fn(async () => new Response(JSON.stringify({ error: { message: provider.apiKey } }), { status: 401 }))
    })
    const transport = await testModelProviderConnection(provider, {
      fetch: vi.fn(async () => {
        throw new Error(`connection rejected ${provider.apiKey}`)
      })
    })

    expect(JSON.stringify(response)).not.toContain(provider.apiKey!)
    expect(JSON.stringify(transport)).not.toContain(provider.apiKey!)
  })

  it('redacts a URL-encoded key echoed by the provider', async () => {
    const provider = createProvider({ apiKey: 'fixture-provider-key-1234+/=' })
    const encodedKey = encodeURIComponent(provider.apiKey!)
    const result = await testModelProviderConnection(provider, {
      fetch: vi.fn(async () => new Response(JSON.stringify({ error: { message: encodedKey } }), { status: 401 }))
    })

    expect(JSON.stringify(result)).not.toContain(encodedKey)
  })

  it('uses the provider runtime key when probing an explicit model id', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'ok' }), { status: 200 }))

    await testModelProviderConnection(createProvider(), {
      fetch: fetchMock,
      modelId: 'deepseek-ai/DeepSeek-V3.2'
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer sk-test'
        })
      })
    )
  })

  it('classifies HTTP failures into unauthorized / model_not_found / http_<status>', async () => {
    const forbidden = await testModelProviderConnection(createProvider(), {
      fetch: vi.fn(async () => new Response('', { status: 403 }))
    })
    const missingModel = await testModelProviderConnection(createProvider(), {
      fetch: vi.fn(async () => new Response(JSON.stringify({ error: { message: 'The model `deepseek-ai/DeepSeek-V3.2` does not exist' } }), { status: 404 }))
    })
    const notFound = await testModelProviderConnection(createProvider(), {
      fetch: vi.fn(async () => new Response('', { status: 404 }))
    })
    const serverError = await testModelProviderConnection(createProvider(), {
      fetch: vi.fn(async () => new Response('', { status: 500 }))
    })

    expect(forbidden).toMatchObject({ ok: false, failureCode: 'http_403', message: 'HTTP 403' })
    expect(missingModel).toMatchObject({ ok: false, failureCode: 'model_not_found' })
    expect(notFound).toMatchObject({ ok: false, failureCode: 'http_404' })
    expect(serverError).toMatchObject({ ok: false, failureCode: 'http_5xx' })
  })

  it('classifies transport errors by error.code / cause.code', async () => {
    const cases: Array<{ code: string; expected: string; message?: string }> = [
      { code: 'ENOTFOUND', expected: 'network_dns' },
      { code: 'EAI_AGAIN', expected: 'network_dns' },
      { code: 'ECONNREFUSED', expected: 'network_refused' },
      { code: 'ECONNRESET', expected: 'network_refused' },
      { code: 'UND_ERR_CONNECT_TIMEOUT', expected: 'network_timeout' },
      { code: 'ETIMEDOUT', expected: 'network_timeout' },
      { code: 'CERT_HAS_EXPIRED', expected: 'tls_error' },
      { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', expected: 'tls_error' },
      { code: 'ERR_PROXY', expected: 'proxy_error' }
    ]

    for (const entry of cases) {
      const result = await testModelProviderConnection(createProvider(), {
        fetch: vi.fn(async () => {
          throw transportError(entry.code, entry.message)
        })
      })
      expect(result, entry.code).toMatchObject({ ok: false, failureCode: entry.expected })
      // 技术细节保留在 message 里（供 UI 当 detail），不包含密钥。
      expect(result.message, entry.code).toContain(entry.code)
      expect(result.message, entry.code).not.toContain('sk-test')
    }
  })

  it('classifies proxy failures reported only through the message', async () => {
    const result = await testModelProviderConnection(createProvider(), {
      fetch: vi.fn(async () => {
        throw new Error('Proxy connection failed: socks5 127.0.0.1:6153 refused')
      })
    })

    expect(result).toMatchObject({ ok: false, failureCode: 'proxy_error' })
  })

  it('reports missing_api_key / model_not_found before any network request', async () => {
    const missingKey = await testModelProviderConnection(createProvider({ apiKey: '' }), { fetch: vi.fn() })
    const missingModel = await testModelProviderConnection(createProvider({ models: [] }), { fetch: vi.fn() })

    expect(missingKey).toMatchObject({ ok: false, failureCode: 'missing_api_key' })
    expect(missingModel).toMatchObject({ ok: false, failureCode: 'model_not_found' })
  })

  it('probes a neutral proxy target with the injected fetch and reports status/duration/host', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => new Response('<html></html>', { status: 200 }))
    const result = await probeProviderProxyTarget('https://aihubmix.com/', fetchMock as unknown as typeof fetch)

    expect(fetchMock).toHaveBeenCalledWith('https://aihubmix.com/', expect.objectContaining({ method: 'GET' }))
    expect(result).toMatchObject({ ok: true, status: 200, reasonCode: null, targetHost: 'aihubmix.com' })
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    // 无鉴权：不带任何 authorization。
    expect(JSON.stringify(fetchMock.mock.calls[0]?.[1] ?? {})).not.toContain('authorization')
  })

  it('classifies proxy probe failures with the same codes as connection checks', async () => {
    const forbidden = await probeProviderProxyTarget('https://aihubmix.com/', vi.fn(async () => new Response('', { status: 403 })))
    const timedOut = await probeProviderProxyTarget('https://aihubmix.com/', vi.fn(async () => {
      throw transportError('UND_ERR_CONNECT_TIMEOUT')
    }))

    expect(forbidden).toMatchObject({ ok: false, status: 403, reasonCode: 'http_403' })
    expect(timedOut).toMatchObject({ ok: false, status: null, reasonCode: 'network_timeout', targetHost: 'aihubmix.com' })
  })

  it('surfaces the upstream error message and classifies insufficient balance before generic 4xx', async () => {
    const upstream = 'Your account balance is insufficient. Please recharge your account to continue using the API. (tid: 2026101814045281600525844444671)'
    const result = await testModelProviderConnection(createProvider(), {
      fetch: vi.fn(async () => new Response(JSON.stringify({ error: { message: upstream } }), { status: 402 }))
    })

    expect(result).toMatchObject({ ok: false, failureCode: 'account_balance_insufficient', upstreamMessage: upstream })
    expect(result.message).toContain('HTTP 402')
    expect(result.message).toContain('tid: 2026101814045281600525844444671')
    expect(JSON.stringify(result)).not.toContain('sk-test')
  })

  it('detects insufficient balance from a 4xx message even without a 402 status', async () => {
    const result = await testModelProviderConnection(createProvider(), {
      fetch: vi.fn(async () => new Response(JSON.stringify({ error: { message: 'quota exceeded, please recharge' } }), { status: 400 }))
    })

    expect(result.failureCode).toBe('account_balance_insufficient')
    expect(result.upstreamMessage).toContain('quota exceeded')
  })

  it('redacts the key echoed inside an upstream error message and truncates it', async () => {
    const provider = createProvider({ apiKey: 'fixture-provider-key-1234567890' })
    const result = await testModelProviderConnection(provider, {
      fetch: vi.fn(async () => new Response(JSON.stringify({ error: { message: `${'x'.repeat(400)} ${provider.apiKey}` } }), { status: 400 }))
    })

    expect(JSON.stringify(result)).not.toContain(provider.apiKey!)
    expect((result.upstreamMessage ?? '').length).toBeLessThanOrEqual(200)
  })

  it('keeps a plain-text upstream body as the message', async () => {
    const result = await testModelProviderConnection(createProvider(), {
      fetch: vi.fn(async () => new Response('upstream unavailable', { status: 503 }))
    })

    expect(result).toMatchObject({ ok: false, failureCode: 'http_5xx', upstreamMessage: 'upstream unavailable' })
  })

  it('does not append another v1 segment when the provider base URL already includes an API version path', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'ok' }), { status: 200 }))

    await testModelProviderConnection(
      createProvider({
        endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://open.bigmodel.cn/api/paas/v4/' }]
      }),
      { fetch: fetchMock }
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      expect.any(Object)
    )
  })
  it('injects custom headers into the OpenAI chat connection check', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'ok' }), { status: 200 }))
    await testModelProviderConnection(createProvider({
      customHeaders: [{ name: 'X-Test', value: '1' }]
    }), { fetch: fetchMock })
    const headers = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]?.[1]?.headers as Record<string, string>
    expect(headers['X-Test']).toBe('1')
    expect(headers.authorization).toBe('Bearer sk-test')
  })

})

function transportError(code: string, message = 'fetch failed'): Error {
  const error = new Error(message) as Error & { cause?: { code?: string; message?: string } }
  error.name = 'TypeError'
  error.cause = { code, message: `${code} transport detail` }
  return error
}
