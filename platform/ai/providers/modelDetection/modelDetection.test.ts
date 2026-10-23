import { describe, expect, it, vi } from 'vitest'

import type { ModelDefinition, ModelProvider } from '../modelProviderTypes'
import { detectModel } from './detect'
import { collectProbedProtocols } from './probedProtocols'
import { runModelDetection } from './run'

/**
 * PLAT-82：检测 = 联通性 + 协议支持，两种模式可多选；结果只存内存。
 *
 * 覆盖设计 §8 的平台侧断言：请求构造、跳过、端点不支持、429、声明失败、去重、
 * 并发 5、取消上报、不写库。
 */
function provider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: 'acme',
    name: 'Acme',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.example.test' }
    ],
    enabled: true,
    baseUrl: 'https://api.example.test',
    apiKey: 'sk-test',
    models: [],
    ...overrides
  }
}

function chatModel(overrides: Partial<ModelDefinition> = {}): ModelDefinition {
  return { id: 'acme-chat', name: 'Acme Chat', capabilities: { chat: true }, chatProtocol: 'chat-completions', ...overrides }
}

function ok(): Response {
  return new Response('{}', { status: 200 })
}

function detect(model: ModelDefinition, modes: Array<'connectivity' | 'protocol'>, options: {
  provider?: ModelProvider
  fetch?: typeof fetch
  signal?: AbortSignal
} = {}) {
  return detectModel(options.provider ?? provider(), model, modes, {
    runId: 'run-1',
    fetch: options.fetch ?? (async () => ok()) as unknown as typeof fetch,
    ...(options.signal ? { signal: options.signal } : {})
  })
}

describe('PLAT-82 model detection', () => {
  it('builds one minimal chat request on the model protocol', async () => {
    const fetchMock = vi.fn(async () => ok())
    const result = await detect(chatModel(), ['connectivity'], { fetch: fetchMock as unknown as typeof fetch })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example.test/v1/chat/completions')
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'acme-chat',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1
    })
    expect(result).toMatchObject({ status: 'ok', connectivity: { status: 'ok' } })
  })

  it('probes embedding and rerank on their own leaves', async () => {
    const fetchMock = vi.fn(async () => ok())
    await detect({ id: 'bge-m3', name: 'bge', capabilities: { chat: false, embedding: true } }, ['connectivity'], {
      fetch: fetchMock as unknown as typeof fetch
    })
    await detect({ id: 'bge-rerank', name: 'rerank', capabilities: { chat: false, rerank: true } }, ['connectivity'], {
      fetch: fetchMock as unknown as typeof fetch
    })

    const urls = fetchMock.mock.calls.map((call) => (call as unknown as [string])[0])
    expect(urls).toEqual([
      'https://api.example.test/v1/embeddings',
      'https://api.example.test/v1/rerank'
    ])
  })

  it('skips media models, disabled providers and keyless providers without sending requests', async () => {
    const fetchMock = vi.fn(async () => ok())

    const video = await detect(
      { id: 'seedance', name: 'Seedance', capabilities: { chat: false, videoGeneration: true } },
      ['connectivity'],
      { fetch: fetchMock as unknown as typeof fetch }
    )
    expect(video).toMatchObject({ status: 'skipped', connectivity: { status: 'skipped', reasonCode: 'non_text_generation' } })

    const disabled = await detect(chatModel(), ['connectivity', 'protocol'], {
      provider: provider({ enabled: false }),
      fetch: fetchMock as unknown as typeof fetch
    })
    expect(disabled).toMatchObject({
      status: 'skipped',
      connectivity: { status: 'skipped', reasonCode: 'provider_disabled' },
      protocolSkipReason: 'provider_disabled'
    })

    const keyless = await detect(chatModel(), ['connectivity', 'protocol'], {
      provider: provider({ apiKey: '' }),
      fetch: fetchMock as unknown as typeof fetch
    })
    expect(keyless).toMatchObject({
      status: 'failed',
      connectivity: { status: 'failed', reasonCode: 'missing_api_key' },
      protocolSkipReason: 'missing_api_key'
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips protocol mode for non-chat models and for providers without chat endpoints', async () => {
    const fetchMock = vi.fn(async () => ok())

    const embedding = await detect(
      { id: 'bge-m3', name: 'bge', capabilities: { chat: false, embedding: true } },
      ['protocol'],
      { fetch: fetchMock as unknown as typeof fetch }
    )
    expect(embedding).toMatchObject({ status: 'skipped', protocolSkipReason: 'not_chat_model' })

    // 纯 Gemini 供应商：chat-completions 不算可用（providerSupportsChatCompletions=false）。
    const geminiWithoutEndpoint = await detect(chatModel({ chatProtocol: 'gemini' }), ['protocol'], {
      provider: provider({ endpoints: [{ protocol: 'gemini', baseUrl: '' }] }),
      fetch: fetchMock as unknown as typeof fetch
    })
    expect(geminiWithoutEndpoint).toMatchObject({ status: 'skipped', protocolSkipReason: 'protocol_not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats an unsupported messages endpoint as endpoint_unsupported and sends one request', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/messages')
        ? new Response('{"error":"messages not supported by this channel"}', { status: 404 })
        : ok())
    const result = await detect(
      chatModel({ id: 'glm-5', messagesSupport: 'yes' }),
      ['protocol'],
      {
        provider: provider({
          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://api.example.test' },
            { protocol: 'messages', baseUrl: 'https://api.example.test/anthropic' }
          ]
        }),
        fetch: fetchMock as unknown as typeof fetch
      }
    )

    expect(fetchMock).toHaveBeenCalledTimes(2) // chat/completions（成功）+ messages（失败）
    expect(result.status).toBe('failed')
    expect(result.protocols).toEqual([
      { protocol: 'chat-completions', ok: true },
      { protocol: 'messages', ok: false, reasonCode: 'endpoint_unsupported' }
    ])
    expect(result.declaredProtocolFailures).toEqual(['messages'])
  })

  it('records 429 as rate_limited and keeps the queue moving', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":"rate limit"}', { status: 429 }))
    const outcome = await runModelDetection({
      provider: provider(),
      models: [chatModel({ id: 'a' }), chatModel({ id: 'b' })],
      modes: ['connectivity'],
      fetch: fetchMock as unknown as typeof fetch,
      runId: 'run-429'
    })

    expect(outcome.results).toHaveLength(2)
    expect(outcome.results.every((result) => result.reasonCode === 'rate_limited')).toBe(true)
  })

  it('records 401/403 per model instead of short-circuiting the run', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const body = String(init?.body ?? '')
      if (body.includes('unauthorized-model')) return new Response('{"error":"invalid api key"}', { status: 401 })
      if (body.includes('forbidden-model')) return new Response('{"error":"forbidden"}', { status: 403 })
      return ok()
    })
    const outcome = await runModelDetection({
      provider: provider(),
      models: [
        chatModel({ id: 'unauthorized-model' }),
        chatModel({ id: 'forbidden-model' }),
        chatModel({ id: 'healthy-model' })
      ],
      modes: ['connectivity'],
      fetch: fetchMock as unknown as typeof fetch,
      runId: 'run-auth'
    })

    // 每个模型各自出结论；401/403 不打断队列，也不会被当成「密钥失效」统一短路。
    const byId = Object.fromEntries(outcome.results.map((entry) => [entry.modelId, entry.reasonCode]))
    expect(byId).toEqual({
      'unauthorized-model': 'http_401',
      'forbidden-model': 'http_403',
      'healthy-model': undefined
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('only marks declared protocols as failures (chat/completions never counts)', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":"nope"}', { status: 400 }))
    const undeclared = await detect(chatModel({ id: 'plain' }), ['protocol'], {
      provider: provider({
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.example.test' },
          { protocol: 'messages', baseUrl: 'https://api.example.test/anthropic' }
        ]
      }),
      fetch: fetchMock as unknown as typeof fetch
    })
    expect(undeclared.protocols?.map((entry) => entry.ok)).toEqual([false, false])
    expect(undeclared.declaredProtocolFailures).toEqual([])
  })

  it('dedupes identical url+body across both modes', async () => {
    const fetchMock = vi.fn(async () => ok())
    const result = await detect(chatModel(), ['connectivity', 'protocol'], {
      fetch: fetchMock as unknown as typeof fetch
    })

    // chat/completions 只有一条通道：两个模式各要一次，但 url+body 相同 ⇒ 只发一次。
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      status: 'ok',
      connectivity: { status: 'ok' },
      protocols: [{ protocol: 'chat-completions', ok: true }]
    })
  })

  it('marks the reused protocol outcome when it shares the connectivity request', async () => {
    const fetchMock = vi.fn(async () => ok())
    // 供应商只配了 chat/completions 一条端点 ⇒ 协议探测与联通性请求完全相同。
    const result = await detect(chatModel(), ['connectivity', 'protocol'], {
      fetch: fetchMock as unknown as typeof fetch
    })

    // 复用的是**结论**，不是「没测」：协议项必须落在结果里，并标出来源是复用。
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.protocols).toEqual([{ protocol: 'chat-completions', ok: true, reused: true }])
    expect(result.declaredProtocolFailures).toEqual([])
  })

  it('marks a reused protocol failure instead of dropping it', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":"messages not supported by this channel"}', { status: 404 }))
    // 供应商只有 messages 一条端点，模型走 messages ⇒ 两个模式同一条请求。
    const result = await detect(
      chatModel({ id: 'claude-x', chatProtocol: 'messages', messagesSupport: 'yes' }),
      ['connectivity', 'protocol'],
      {
        provider: provider({ endpoints: [{ protocol: 'messages', baseUrl: 'https://api.example.test' }] }),
        fetch: fetchMock as unknown as typeof fetch
      }
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.protocols).toEqual([
      { protocol: 'messages', ok: false, reasonCode: 'endpoint_unsupported', reused: true }
    ])
    expect(result.declaredProtocolFailures).toEqual(['messages'])
  })

  it('probes each configured protocol once even if the endpoint list repeats a protocol', async () => {
    const fetchMock = vi.fn(async () => ok())
    const result = await detect(chatModel(), ['protocol'], {
      provider: provider({
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.example.test' },
          { protocol: 'chat-completions', baseUrl: 'https://api.example.test/v1' }
        ]
      }),
      fetch: fetchMock as unknown as typeof fetch
    })

    // 同协议重复声明 ⇒ 一条协议通道；不能靠 url+body 去重才碰巧不重复计数。
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.protocols).toEqual([{ protocol: 'chat-completions', ok: true }])
  })

  it('keeps every configured protocol when the provider has four endpoints', async () => {
    const fetchMock = vi.fn(async () => ok())
    const result = await detect(chatModel(), ['connectivity', 'protocol'], {
      provider: provider({
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.example.test' },
          { protocol: 'responses', baseUrl: 'https://api.example.test/v1' },
          { protocol: 'messages', baseUrl: 'https://api.example.test/anthropic' },
          { protocol: 'gemini', baseUrl: 'https://api.example.test/gemini' }
        ]
      }),
      fetch: fetchMock as unknown as typeof fetch
    })

    // 联通性 1 条 + 另外 3 条协议 ⇒ 4 次请求；chat/completions 复用联通性结论。
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(result.protocols).toEqual([
      { protocol: 'chat-completions', ok: true, reused: true },
      { protocol: 'responses', ok: true },
      { protocol: 'messages', ok: true },
      { protocol: 'gemini', ok: true }
    ])
  })

  it('collects only the passed protocols as the write-back material', () => {
    const entries = collectProbedProtocols([
      {
        runId: 'run-1',
        modelId: 'both',
        status: 'ok',
        protocols: [
          { protocol: 'chat-completions', ok: true, reused: true },
          { protocol: 'messages', ok: true }
        ]
      },
      {
        runId: 'run-1',
        modelId: 'partial',
        status: 'failed',
        reasonCode: 'endpoint_unsupported',
        protocols: [
          { protocol: 'chat-completions', ok: true },
          { protocol: 'messages', ok: false, reasonCode: 'endpoint_unsupported' }
        ]
      },
      // 全部失败 / 协议被跳过 ⇒ 不写任何东西（失败不写负结论）。
      {
        runId: 'run-1',
        modelId: 'all-failed',
        status: 'failed',
        protocols: [{ protocol: 'messages', ok: false, reasonCode: 'endpoint_unsupported' }]
      },
      { runId: 'run-1', modelId: 'skipped', status: 'skipped', protocolSkipReason: 'not_chat_model' }
    ])

    expect(entries).toEqual([
      { modelId: 'both', protocols: ['chat-completions', 'messages'] },
      { modelId: 'partial', protocols: ['chat-completions'] }
    ])
  })

  it('runs five probes at a time', async () => {
    let inFlight = 0
    let peak = 0
    const fetchMock = vi.fn(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return ok()
    })

    const models = Array.from({ length: 12 }, (_, index) => chatModel({ id: `m-${index}` }))
    const outcome = await runModelDetection({
      provider: provider(),
      models,
      modes: ['connectivity'],
      fetch: fetchMock as unknown as typeof fetch,
      runId: 'run-concurrency'
    })

    expect(outcome.results).toHaveLength(12)
    expect(peak).toBe(5)
  })

  it('reports in-flight models as cancelled and stops scheduling new ones', async () => {
    const controller = new AbortController()
    const started: string[] = []
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { model: string }
      started.push(body.model)
      if (started.length === 1) controller.abort('stop')
      await new Promise((resolve) => setTimeout(resolve, 5))
      if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      return ok()
    })

    const reported: string[] = []
    const models = Array.from({ length: 10 }, (_, index) => chatModel({ id: `m-${index}` }))
    const outcome = await runModelDetection({
      provider: provider(),
      models,
      modes: ['connectivity'],
      fetch: fetchMock as unknown as typeof fetch,
      runId: 'run-cancel',
      concurrency: 2,
      signal: controller.signal,
      onResult: (result) => reported.push(`${result.modelId}:${result.status}`)
    })

    expect(outcome.cancelled).toBe(true)
    expect(started.length).toBeLessThan(models.length)
    expect(reported.length).toBeLessThan(models.length)
    // 在飞模型照常上报 `cancelled`；已完成的结果保留。
    expect(reported.some((entry) => entry.endsWith(':cancelled'))).toBe(true)
    expect(reported.every((entry) => entry.endsWith(':cancelled') || entry.endsWith(':ok'))).toBe(true)
  })

  it('never mutates the provider or model records (memory-only results)', async () => {
    const providerRecord = provider({
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://api.example.test' },
        { protocol: 'messages', baseUrl: 'https://api.example.test/anthropic' }
      ]
    })
    const modelRecord = chatModel({ messagesSupport: 'yes' })
    const providerSnapshot = JSON.parse(JSON.stringify(providerRecord))
    const modelSnapshot = JSON.parse(JSON.stringify(modelRecord))

    await detectModel(providerRecord, modelRecord, ['connectivity', 'protocol'], {
      runId: 'run-readonly',
      fetch: (async () => ok()) as unknown as typeof fetch
    })

    expect(JSON.parse(JSON.stringify(providerRecord))).toEqual(providerSnapshot)
    expect(JSON.parse(JSON.stringify(modelRecord))).toEqual(modelSnapshot)
  })
})
