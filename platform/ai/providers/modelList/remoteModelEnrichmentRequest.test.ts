import { describe, expect, it, vi } from 'vitest'

import type { ModelProvider } from '../modelProviderTypes'
import { DEFAULT_MODEL_LIST_SHAPE, type ModelListEnrichment, type ModelListShape } from './modelListShape'
import {
  buildEnrichmentPageUrl,
  listRemoteModels,
  ModelListRequestError,
  resolveEnrichmentHost
} from './remoteModelList'

const BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const MAIN_URL = `${BASE_URL}/models`
const ENRICHMENT_PATH = '/api/v1/models'

const ENRICHMENT: ModelListEnrichment = {
  path: ENRICHMENT_PATH,
  itemsPath: 'output.models',
  idPath: 'model',
  pages: { pageParam: 'page_no', sizeParam: 'page_size', size: 200, maxPages: 5 },
  aliases: {
    contextWindow: [{ path: 'model_info.context_window' }],
    'price.prompt': [{
      path: 'prices.0.prices',
      read: 'match',
      where: { path: 'type', equals: 'input_token' },
      valuePath: 'price'
    }],
    'price.completion': [{
      path: 'prices.0.prices',
      read: 'match',
      where: { path: 'type', equals: 'output_token' },
      valuePath: 'price'
    }]
  }
}

function provider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: 'dashscope',
    name: 'Bailian',
    endpoints: [{ protocol: 'chat-completions', baseUrl: BASE_URL }],
    enabled: true,
    baseUrl: BASE_URL,
    apiKey: 'sk-test',
    models: [],
    ...overrides
  }
}

function shape(overrides: Partial<ModelListShape> = {}): ModelListShape {
  return { ...DEFAULT_MODEL_LIST_SHAPE, defaultCurrency: 'CNY', enrichment: ENRICHMENT, ...overrides }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function nativePage(models: readonly unknown[]): Response {
  return json({ code: '200', success: true, output: { total: models.length, page_no: 1, page_size: 200, models } })
}

function pagesOf(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => String((call as unknown as [string])[0]))
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

describe('enrichment URL derivation', () => {
  it('uses the provider baseUrl origin, not the baseUrl path', () => {
    // baseUrl 是 compatible-mode 前缀，补充源在主机根的 /api/v1/models。
    expect(resolveEnrichmentHost(BASE_URL)).toBe('https://dashscope.aliyuncs.com')
    expect(buildEnrichmentPageUrl(BASE_URL, ENRICHMENT, 1)).toBe(
      'https://dashscope.aliyuncs.com/api/v1/models?page_no=1&page_size=200'
    )
    expect(buildEnrichmentPageUrl(`${BASE_URL}/`, ENRICHMENT, 2)).toBe(
      'https://dashscope.aliyuncs.com/api/v1/models?page_no=2&page_size=200'
    )
  })

  it('keeps a custom port and accepts a path without a leading slash', () => {
    expect(buildEnrichmentPageUrl('https://api.example.test:8443/v1', ENRICHMENT, 3)).toBe(
      'https://api.example.test:8443/api/v1/models?page_no=3&page_size=200'
    )
    expect(buildEnrichmentPageUrl(BASE_URL, { ...ENRICHMENT, path: 'api/v1/models' }, 1)).toBe(
      'https://dashscope.aliyuncs.com/api/v1/models?page_no=1&page_size=200'
    )
  })

  it('returns undefined for an unparseable baseUrl', () => {
    expect(resolveEnrichmentHost('not a url')).toBeUndefined()
    expect(buildEnrichmentPageUrl('not a url', ENRICHMENT, 1)).toBeUndefined()
  })
})

describe('model list enrichment request', () => {
  it('paginates the enrichment source by integer page and merges by id', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === MAIN_URL) return json({ data: [{ id: 'qwen3.8-max' }, { id: 'qwen-plus' }] })
      if (url.includes(`${ENRICHMENT_PATH}?page_no=1`)) {
        return nativePage([
          {
            model: 'qwen3.8-max',
            model_info: { context_window: 1000000 },
            prices: [{ prices: [{ type: 'input_token', price: '12' }, { type: 'output_token', price: '36' }] }]
          },
          { model: 'text-embedding-v3' }
        ])
      }
      if (url.includes(`${ENRICHMENT_PATH}?page_no=2`)) return nativePage([{ model: 'qwen-plus' }])
      return nativePage([])
    })

    const models = await listRemoteModels(provider(), shape(), { fetch: fetchMock as unknown as typeof fetch })

    expect(pagesOf(fetchMock)).toEqual([
      MAIN_URL,
      'https://dashscope.aliyuncs.com/api/v1/models?page_no=1&page_size=200',
      'https://dashscope.aliyuncs.com/api/v1/models?page_no=2&page_size=200',
      'https://dashscope.aliyuncs.com/api/v1/models?page_no=3&page_size=200'
    ])
    // 空页视为末尾，不再空转到 maxPages。
    expect(models.map((model) => model.id)).toEqual(['qwen3.8-max', 'qwen-plus'])
    expect(models[0]).toMatchObject({
      contextLength: 1000000,
      pricing: { currency: 'CNY', promptPerMillion: 12, completionPerMillion: 36 }
    })
    // 只在补充源出现的 id 不会被新增。
    expect(models.map((model) => model.id)).not.toContain('text-embedding-v3')
  })

  it('reuses the same bearer headers for the enrichment request', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === MAIN_URL ? json({ data: [{ id: 'qwen-plus' }] }) : nativePage([]))

    await listRemoteModels(provider(), shape(), { fetch: fetchMock as unknown as typeof fetch })

    const [mainInit, enrichmentInit] = fetchMock.mock.calls.map(
      (call) => (call as unknown as [string, RequestInit])[1]
    )
    expect(mainInit?.headers).toEqual(enrichmentInit?.headers)
    expect((enrichmentInit?.headers as Record<string, string>).authorization).toBe('Bearer sk-test')
    expect((enrichmentInit?.headers as Record<string, string>)['x-goog-api-key']).toBeUndefined()
  })

  it('stops at maxPages when pages never come back empty', async () => {
    const bounded = shape({ enrichment: { ...ENRICHMENT, pages: { ...ENRICHMENT.pages, maxPages: 2 } } })
    const fetchMock = vi.fn(async (url: string) =>
      url === MAIN_URL ? json({ data: [{ id: 'qwen-plus' }] }) : nativePage([{ model: 'qwen-plus' }]))

    await listRemoteModels(provider(), bounded, { fetch: fetchMock as unknown as typeof fetch })

    expect(fetchMock).toHaveBeenCalledTimes(1 + 2)
    expect(pagesOf(fetchMock).at(-1)).toBe(
      'https://dashscope.aliyuncs.com/api/v1/models?page_no=2&page_size=200'
    )
  })

  it('fails the whole sync when any enrichment page fails', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === MAIN_URL) return json({ data: [{ id: 'qwen-plus' }] })
      if (url.includes('page_no=1')) return nativePage([{ model: 'qwen-plus' }])
      return json({ message: 'boom' }, 429)
    })

    const error = await failureOf(listRemoteModels(provider(), shape(), {
      fetch: fetchMock as unknown as typeof fetch
    }))
    expect(error.reasonCode).toBe('rate_limited')
    expect(error.message).toContain('HTTP 429')
    // 主列表成功、补充源失败时必须在消息里标出来，否则用户只看到一句 HTTP 4xx。
    expect(error.message).toContain('Metadata enrichment failed:')
  })

  it('treats an unreadable enrichment envelope as an invalid response', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === MAIN_URL ? json({ data: [{ id: 'qwen-plus' }] }) : json({ output: { models: 'nope' } }))

    const error = await failureOf(listRemoteModels(provider(), shape(), {
      fetch: fetchMock as unknown as typeof fetch
    }))
    expect(error.reasonCode).toBe('invalid_response')
  })

  it('does not request an enrichment source when the shape declares none', async () => {
    const fetchMock = vi.fn(async () => json({ data: [{ id: 'gpt-5' }] }))
    await listRemoteModels(provider({ id: 'openai', baseUrl: 'https://api.openai.com/v1' }), DEFAULT_MODEL_LIST_SHAPE, {
      fetch: fetchMock as unknown as typeof fetch
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
