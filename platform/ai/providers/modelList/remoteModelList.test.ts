import { describe, expect, it, vi } from 'vitest'

import type { ModelProvider } from '../modelProviderTypes'
import {
  listRemoteModels,
  ModelListRequestError,
  buildListPathUrl,
  buildModelsUrl,
  resolveGeminiHost
} from './remoteModelList'
import { DEFAULT_MODEL_LIST_SHAPE } from './modelListShape'
import { resolveModelListShape } from './modelListShapes'

const GEMINI_HOST = 'https://generativelanguage.googleapis.com'

function provider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: 'openai',
    name: 'OpenAI',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.openai.com/v1' }
    ],
    enabled: true,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    models: [],
    ...overrides
  }
}

function geminiProvider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return provider({
    id: 'gemini',
    name: 'Gemini',
    endpoints: [
      { protocol: 'gemini', baseUrl: GEMINI_HOST }
    ],
    baseUrl: GEMINI_HOST,

    apiKey: 'fixture-gemini-key-1234567890',
    ...overrides
  })
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function failureOf(run: Promise<unknown>): Promise<ModelListRequestError> {
  try {
    await run
  } catch (error) {
    if (error instanceof ModelListRequestError) return error
    throw error
  }
  throw new Error('expected the call to fail')
}

function list(overrides: Partial<ModelProvider>, fetchImpl: typeof fetch) {
  const subject = provider(overrides)
  return listRemoteModels(subject, resolveModelListShape(subject), { fetch: fetchImpl })
}

describe('model list request layer', () => {
  it('requests the OpenAI-compatible /v1/models URL with a bearer token', async () => {
    const fetchMock = vi.fn(async () => json({ data: [{ id: 'gpt-5' }] }))
    const models = await list({}, fetchMock as unknown as typeof fetch)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ authorization: 'Bearer sk-test' })
      })
    )
    expect(models.map((model) => model.id)).toEqual(['gpt-5'])
  })

  it('requests origin + listPath when the shape declares a custom list path', async () => {
    // baseUrl 带版本段：listPath 取的是 **origin**，不是 baseUrl 的路径。
    const fetchMock = vi.fn(async () => json({ data: [{ model_id: 'gpt-4o' }], message: 'ok', success: true }))
    const subject = provider({ baseUrl: 'https://aihubmix.com/v1' })
    const shape = { ...DEFAULT_MODEL_LIST_SHAPE, idPath: 'model_id', listPath: '/api/v1/models' }
    const models = await listRemoteModels(subject, shape, { fetch: fetchMock as unknown as typeof fetch })

    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://aihubmix.com/api/v1/models')
    expect(models.map((model) => model.id)).toEqual(['gpt-4o'])
    // 缺省时仍是版本段推导（上面 `/v1/models` 的用例覆盖请求，这里只固化拼接口径）。
    expect(buildListPathUrl('https://aihubmix.com/v1', 'api/v1/models')).toBe('https://aihubmix.com/api/v1/models')
    expect(buildListPathUrl('not a url', '/api/v1/models')).toBeUndefined()
  })

  it('merges custom headers for bearer providers', async () => {
    const fetchMock = vi.fn(async () => json({ data: [] }))
    await list({
      customHeaders: [
        { name: 'X-Test', value: '1' },
        { name: 'authorization', value: 'must-not-override' }
      ]
    }, fetchMock as unknown as typeof fetch)

    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>
    expect(headers['X-Test']).toBe('1')
    expect(headers.authorization).toBe('Bearer sk-test')
  })

  it('uses the native gemini endpoint, x-goog-api-key, and never leaks the key into the URL', async () => {
    const fetchMock = vi.fn(async () => json({ models: [{ name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }] }))
    const subject = geminiProvider()
    const models = await listRemoteModels(subject, resolveModelListShape(subject), {
      fetch: fetchMock as unknown as typeof fetch
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${GEMINI_HOST}/v1beta/models`)
    expect(url).not.toContain('key=')
    expect(url).not.toContain('/v1/models')
    const headers = init.headers as Record<string, string>
    expect(headers['x-goog-api-key']).toBe('fixture-gemini-key-1234567890')
    expect(headers.authorization).toBeUndefined()

    // T4/T5：同步时把供应商**当前**默认端点快照成模型协议（gemini 预设的默认就是 gemini）。
    expect(models[0]).toMatchObject({ id: 'gemini-3.5-flash', provider: 'gemini', chatProtocol: 'gemini' })
  })

  it('never merges custom headers into the gemini credential header', async () => {
    const fetchMock = vi.fn(async () => json({ models: [] }))
    const subject = geminiProvider({
      customHeaders: [{ name: 'X-Test', value: '1' }, { name: 'Accept', value: 'text/html' }]
    })
    await listRemoteModels(subject, resolveModelListShape(subject), { fetch: fetchMock as unknown as typeof fetch })

    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>
    expect(headers['X-Test']).toBeUndefined()
    expect(headers['x-goog-api-key']).toBe('fixture-gemini-key-1234567890')
  })

  it('follows nextPageToken without changing the base URL shape', async () => {
    const pages = [
      { models: [{ name: 'models/a', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'tok/1' },
      { models: [{ name: 'models/b', supportedGenerationMethods: ['generateContent'] }] }
    ]
    const fetchMock = vi.fn(async () => json(pages.shift() ?? { models: [] }))
    const subject = geminiProvider()
    const models = await listRemoteModels(subject, resolveModelListShape(subject), {
      fetch: fetchMock as unknown as typeof fetch
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const urls = fetchMock.mock.calls.map((call) => String((call as unknown as [string])[0]))
    expect(urls[0]).toBe(`${GEMINI_HOST}/v1beta/models`)
    expect(urls[1]).toBe(`${GEMINI_HOST}/v1beta/models?pageToken=tok%2F1`)
    expect(models.map((model) => model.id)).toEqual(['a', 'b'])
  })

  it('fails the whole sync when a later page fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ models: [{ name: 'models/a', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'next' }))
      .mockResolvedValueOnce(json({ error: { message: 'boom' } }, 500))
    const subject = geminiProvider()

    const error = await failureOf(listRemoteModels(subject, resolveModelListShape(subject), {
      fetch: fetchMock as unknown as typeof fetch
    }))
    expect(error.reasonCode).toBe('http_5xx')
  })

  it('stops paginating at maxPages instead of looping forever', async () => {
    const fetchMock = vi.fn(async () =>
      json({ models: [{ name: 'models/a', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'again' }))
    const subject = geminiProvider()
    await listRemoteModels(subject, resolveModelListShape(subject), { fetch: fetchMock as unknown as typeof fetch })
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('reports missing credentials and a bad host without any request', async () => {
    const fetchMock = vi.fn()
    const missingKey = await failureOf(list({ apiKey: '' }, fetchMock as unknown as typeof fetch))
    expect(missingKey.reasonCode).toBe('missing_api_key')

    const missingHost = await failureOf(list({ baseUrl: '' }, fetchMock as unknown as typeof fetch))
    expect(missingHost.reasonCode).toBe('invalid_base_url')

    const badScheme = await failureOf(list({ baseUrl: 'ftp://example.test' }, fetchMock as unknown as typeof fetch))
    expect(badScheme.reasonCode).toBe('invalid_base_url')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('classifies HTTP failures with the shared reason codes', async () => {
    const cases: Array<[number, string, string]> = [
      [401, 'invalid api key', 'http_401'],
      [403, 'permission denied', 'http_403'],
      [429, 'rate limit', 'rate_limited'],
      [500, 'internal error', 'http_5xx']
    ]
    for (const [status, message, expected] of cases) {
      const error = await failureOf(list({}, (async () => json({ error: { message } }, status)) as unknown as typeof fetch))
      expect(error.reasonCode, String(status)).toBe(expected)
      expect(error.message).toContain(`HTTP ${status}`)
    }
  })

  it('never echoes the provider key in failure messages', async () => {
    const encoded = encodeURIComponent('fixture-provider-key-1234+/=')
    const first = await failureOf(list({ apiKey: 'fixture-provider-key-1234567890' }, (async () =>
      json({ error: { message: 'fixture-provider-key-1234567890' } }, 401)) as unknown as typeof fetch))
    expect(first.message).not.toContain('fixture-provider-key-1234567890')

    const second = await failureOf(list({ apiKey: 'fixture-provider-key-1234+/=' }, (async () =>
      json({ error: { message: encoded } }, 401)) as unknown as typeof fetch))
    expect(second.message).not.toContain(encoded)
  })

  it('treats an unusable envelope as an invalid response', async () => {
    const wrongEnvelope = await failureOf(list({}, (async () => json({ models: [] })) as unknown as typeof fetch))
    expect(wrongEnvelope.reasonCode).toBe('invalid_response')

    const notJson = await failureOf(list({}, (async () => new Response('nope', { status: 200 })) as unknown as typeof fetch))
    expect(notJson.reasonCode).toBe('invalid_response')
  })

  it('builds the same model URLs as the legacy helper', () => {
    expect(buildModelsUrl('https://aihubmix.com')).toBe('https://aihubmix.com/v1/models')
    expect(buildModelsUrl('https://api.z.ai/api/paas/v4/')).toBe('https://api.z.ai/api/paas/v4/models')
    expect(buildModelsUrl('https://dashscope.aliyuncs.com/compatible-mode/v1/')).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/models'
    )
    expect(buildModelsUrl('https://generativelanguage.googleapis.com/v1beta/openai')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/models'
    )
    expect(buildModelsUrl('https://ark.cn-beijing.volces.com/api/v3/')).toBe(
      'https://ark.cn-beijing.volces.com/api/v3/models'
    )
    expect(resolveGeminiHost(geminiProvider({ baseUrl: `${GEMINI_HOST}/v1beta` }))).toBe(GEMINI_HOST)
  })
})
