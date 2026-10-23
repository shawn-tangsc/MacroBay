import { describe, expect, it, vi } from 'vitest'

import type { EndpointProbeKind, EndpointProbeVerdict } from './providerEndpointProbe'
import { probeProviderEndpoint } from './providerEndpointProbe'
import type { ModelProvider } from './modelProviderTypes'

/**
 * PLAT-63：单端点「测试」探测。
 * 判定按端点语义分档（400/422=存在但参数问题、401/403=存在但鉴权失败、404/405=路径不存在），
 * 绝不把所有非 2xx 当失败；也绝不回显 Key / 自定义头 / 原始 JSON。
 */
const apiKey = 'sk-secret-key-1234567890'
const headerValue = 'team-secret-value-xyz'

const provider: ModelProvider = {
  id: 'acme',
  name: 'Acme',
  endpoints: [
    { protocol: 'chat-completions', baseUrl: 'https://api.acme.test' }
  ],
  enabled: true,
  baseUrl: 'https://api.acme.test',
  apiKey,
  customHeaders: [{ name: 'x-team', value: headerValue }],
  models: [{ id: 'acme-chat', name: 'Acme Chat', capabilities: { chat: true } }]
}

function jsonResponse(status: number, body: unknown = {}): Response {
  // 204 不允许带 body。
  const payload = status === 204 ? null : JSON.stringify(body)
  return new Response(payload, { status, headers: { 'content-type': 'application/json' } })
}

type ProbeCall = { url: string; init: RequestInit }

async function run(
  kind: EndpointProbeKind,
  options: {
    response?: Response | Error
    baseUrl?: string
    provider?: ModelProvider
    timeoutMs?: number
  } = {}
): Promise<{ result: Awaited<ReturnType<typeof probeProviderEndpoint>>; calls: ProbeCall[] }> {
  const calls: ProbeCall[] = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    if (options.response instanceof Error) throw options.response
    return options.response ?? jsonResponse(200)
  })
  const result = await probeProviderEndpoint(options.provider ?? provider, {
    fetch: fetchMock as unknown as typeof fetch,
    kind,
    baseUrl: options.baseUrl ?? provider.baseUrl,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
  })
  return { result, calls }
}

function bodyOf(call: ProbeCall): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>
}

function headersOf(call: ProbeCall): Record<string, string> {
  return call.init.headers as Record<string, string>
}

describe('probeProviderEndpoint requests', () => {
  it('posts the OpenAI chat probe with the first chat model, ping message and bearer auth', async () => {
    const { result, calls } = await run('openai')

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.acme.test/v1/chat/completions')
    expect(calls[0]?.init.method).toBe('POST')
    expect(headersOf(calls[0] as ProbeCall).authorization).toBe(`Bearer ${apiKey}`)
    expect(headersOf(calls[0] as ProbeCall)['content-type']).toBe('application/json')
    // 自定义头参与请求（但不进返回值）。
    expect(headersOf(calls[0] as ProbeCall)['x-team']).toBe(headerValue)
    expect(bodyOf(calls[0] as ProbeCall)).toEqual({
      model: 'acme-chat',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 8
    })
    expect(result.verdict).toBe('available')
    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.kind).toBe('openai')
  })

  it('does not repeat the version segment when the saved base URL already carries one', async () => {
    const { calls } = await run('openai', { baseUrl: 'https://api.acme.test/v1/' })

    expect(calls[0]?.url).toBe('https://api.acme.test/v1/chat/completions')
  })

  it('posts the Anthropic messages probe with x-api-key and anthropic-version headers', async () => {
    const { result, calls } = await run('anthropic', { baseUrl: 'https://api.acme.test' })

    expect(calls[0]?.url).toBe('https://api.acme.test/v1/messages')
    const headers = headersOf(calls[0] as ProbeCall)
    expect(headers['x-api-key']).toBe(apiKey)
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers.authorization).toBeUndefined()
    expect(bodyOf(calls[0] as ProbeCall)).toEqual({
      model: 'acme-chat',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'ping' }]
    })
    expect(result.verdict).toBe('available')
  })

  it('posts the Responses probe with input and max_output_tokens', async () => {
    const { result, calls } = await run('responses')

    expect(calls[0]?.url).toBe('https://api.acme.test/v1/responses')
    expect(bodyOf(calls[0] as ProbeCall)).toEqual({
      model: 'acme-chat',
      input: 'ping',
      max_output_tokens: 16
    })
    expect(result.verdict).toBe('available')
  })

  it('posts the Gemini native probe against v1beta models generateContent with an API-key header', async () => {
    const { result, calls } = await run('gemini')

    expect(calls[0]?.url).toBe('https://api.acme.test/v1beta/models/acme-chat:generateContent')
    expect(calls[0]?.url).not.toContain('key=')
    const headers = headersOf(calls[0] as ProbeCall)
    expect(headers['x-goog-api-key']).toBe(apiKey)
    expect(headers.authorization).toBeUndefined()
    expect(bodyOf(calls[0] as ProbeCall)).toEqual({
      contents: [{ parts: [{ text: 'ping' }] }],
      generationConfig: { maxOutputTokens: 16 }
    })
    expect(result.verdict).toBe('available')
  })

  it('strips a models/ prefix from the Gemini model id before building the URL', async () => {
    const { calls } = await run('gemini', {
      provider: {
        ...provider,
        models: [{ id: 'models/gemini-2.0-flash', name: 'Gemini 2.0 Flash', capabilities: { chat: true } }]
      }
    })

    expect(calls[0]?.url).toBe('https://api.acme.test/v1beta/models/gemini-2.0-flash:generateContent')
  })

  it('never logs the Gemini key and keeps it out of the returned message', async () => {
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
    ]
    try {
      const { result } = await run('gemini', {
        response: jsonResponse(401, { error: { message: `API key not valid: ${apiKey}` } })
      })

      expect(result.verdict).toBe('exists_auth_failed')
      expect(result.message).toContain('HTTP 401')
      expect(result.message).not.toContain(apiKey)
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  it('posts the image generation probe with a tiny ping prompt', async () => {
    const { result, calls } = await run('imageGeneration')

    expect(calls[0]?.url).toBe('https://api.acme.test/v1/images/generations')
    expect(bodyOf(calls[0] as ProbeCall)).toEqual({
      model: 'acme-chat',
      prompt: 'ping',
      n: 1,
      size: '256x256'
    })
    expect(result.verdict).toBe('available')
  })

  it('marks image editing as unsupported without sending any request', async () => {
    const { result, calls } = await run('imageEdit')

    expect(calls).toHaveLength(0)
    expect(result.verdict).toBe('unsupported')
    expect(result.ok).toBe(false)
    expect(result.status).toBeNull()
  })

  it('never probes without a configured model', async () => {
    const { result, calls } = await run('openai', {
      provider: { ...provider, models: [] }
    })

    expect(calls).toHaveLength(0)
    expect(result.verdict).toBe('no_model')
  })

  it('never probes a non-http base URL', async () => {
    const { result, calls } = await run('openai', { baseUrl: 'api.acme.test' })

    expect(calls).toHaveLength(0)
    expect(result.verdict).toBe('unreachable')
    expect(result.status).toBeNull()
  })
})

describe('probeProviderEndpoint verdicts', () => {
  const cases: Array<[number, EndpointProbeVerdict]> = [
    [200, 'available'],
    [204, 'available'],
    [400, 'exists_param_error'],
    [422, 'exists_param_error'],
    [401, 'exists_auth_failed'],
    [403, 'exists_auth_failed'],
    [404, 'missing'],
    [405, 'missing'],
    [429, 'exists'],
    [500, 'exists'],
    [503, 'exists']
  ]

  it.each(cases)('classifies HTTP %i as %s', async (status, verdict) => {
    const { result } = await run('openai', { response: jsonResponse(status, { error: { message: 'nope' } }) })

    expect(result.status).toBe(status)
    expect(result.verdict).toBe(verdict)
    expect(result.ok).toBe(status >= 200 && status < 300)
  })

  it('classifies transport failures as unreachable', async () => {
    const dns = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    const { result } = await run('openai', { response: dns })

    expect(result.verdict).toBe('unreachable')
    expect(result.status).toBeNull()
    expect(result.ok).toBe(false)
  })

  it('classifies a probe timeout as unreachable instead of failing', async () => {
    const calls: ProbeCall[] = []
    const fetchMock = vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
      })
    })
    const result = await probeProviderEndpoint(provider, {
      fetch: fetchMock as unknown as typeof fetch,
      kind: 'openai',
      baseUrl: provider.baseUrl,
      timeoutMs: 5
    })

    expect(calls).toHaveLength(1)
    expect(result.verdict).toBe('unreachable')
    expect(result.status).toBeNull()
  })
})

describe('probeProviderEndpoint safety', () => {
  it('keeps the upstream message but redacts the key and never returns raw JSON', async () => {
    const { result } = await run('openai', {
      response: jsonResponse(401, { error: { message: `Incorrect API key provided: ${apiKey}` } })
    })

    expect(result.message).toContain('HTTP 401')
    expect(result.message).toContain('[redacted]')
    expect(result.message).not.toContain(apiKey)
    expect(result.message).not.toContain(headerValue)
    expect(result.message).not.toContain('{"error"')
    expect(result.message.length).toBeLessThanOrEqual(220)
  })

  it('never returns custom header values or the key on transport failures', async () => {
    const { result } = await run('openai', {
      response: new Error(`connect failed for ${apiKey} with ${headerValue}`)
    })

    expect(result.verdict).toBe('unreachable')
    expect(result.message).not.toContain(apiKey)
    expect(result.message).not.toContain(headerValue)
  })
})
