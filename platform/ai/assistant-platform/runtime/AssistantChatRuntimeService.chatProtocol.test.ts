import { describe, expect, it, vi } from 'vitest'

import type { ProviderChatEndpoint } from '../../providers/modelProviderTypes'
import { createAssistantPlatformDatabase } from '../db/createAssistantPlatformDatabase'
import { createAssistantPlatformRepositories } from '../repositories/createAssistantPlatformRepositories'
import { createDefaultAssistantSeed } from '../seeds/defaultAssistantSeed'
import { createAssistantChatRuntimeService } from './AssistantChatRuntimeService'

/**
 * T4/T5：助手聊天按模型协议派发。
 * - 默认模型 ⇒ 仍打 `/v1/chat/completions`（既有链路不动）；
 * - 模型显式选 responses / gemini + 端点已配 ⇒ 各自端点，消息正常落盘；
 * - 模型选了协议但端点没配 ⇒ 报错且**不发任何请求**。
 */
function harness(
  chatProtocol: 'chat-completions' | 'responses' | 'gemini' | 'messages' | undefined,
  endpoints: ProviderChatEndpoint[],
  options: { enableWebSearch?: boolean; webSearchService?: unknown } = {}
) {
  const db = createAssistantPlatformDatabase(':memory:')
  const repos = createAssistantPlatformRepositories(db)
  const defaults = createDefaultAssistantSeed()
  const seed = options.enableWebSearch
    ? { ...defaults, settings: { ...defaults.settings, enableWebSearch: true } }
    : defaults
  repos.assistants.create(seed)
  const topic = repos.topics.create({ assistantId: seed.id, name: 'Protocol routing' })
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })
  )
  const runtime = createAssistantChatRuntimeService({
    repos,
    fetch: fetch as unknown as typeof globalThis.fetch,
    ...(options.webSearchService ? { webSearchService: options.webSearchService as never } : {}),
    getProviderState: async () => ({
      providers: [
        {
          id: 'acme',
          name: 'Acme',
          // 端点清单是唯一事实源（`[0]` = 默认端点）；`endpoints` 由各用例声明。
          endpoints,
          enabled: true,
          baseUrl: 'https://api.acme.test',
          apiKey: 'sk-test-1234567890',
          models: [
            {
              id: 'acme-chat',
              name: 'Acme Chat',
              capabilities: {
                chat: true,
                vision: false,
                embedding: false,
                tools: options.enableWebSearch === true,
                agentRuntimes: {}
              },
              // T4/T5：协议写在模型上（默认 chat-completions），运行时不再跟随供应商默认。
              chatProtocol: chatProtocol ?? 'chat-completions'
            }
          ],
          defaultChatModelId: 'acme-chat',
          isSystem: false,
          websites: {}
        }
      ]
    })
  })
  const assistant = repos.assistants.getById(seed.id)!
  repos.assistants.update(assistant.id, { modelId: 'acme:acme-chat' })
  return { repos, topic, fetch, runtime }
}

async function send(runtime: ReturnType<typeof createAssistantChatRuntimeService>, topicId: string) {
  return runtime.open({ topicId, trigger: 'submit-message', userMessageParts: [{ type: 'text', text: 'Hi' }] })
}

function assistantMessage(repos: ReturnType<typeof createAssistantPlatformRepositories>, topicId: string) {
  return repos.messages.listByTopic(topicId).find((message) => message.role === 'assistant')
}

describe('assistant chat protocol routing', () => {
  it('keeps /v1/chat/completions for models without an explicit protocol', async () => {
    const h = harness(undefined, [
      { protocol: 'chat-completions', baseUrl: 'https://api.acme.test' },
      { protocol: 'responses', baseUrl: 'https://responses.acme.test' },
      { protocol: 'gemini', baseUrl: 'https://gemini.acme.test' }
    ])
    h.fetch.mockImplementation(async () =>
      new Response('data: {"choices":[{"delta":{"content":"default path"}}]}\n\ndata: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' }
      })
    )

    await send(h.runtime, h.topic.id)
    await vi.waitFor(() => expect(assistantMessage(h.repos, h.topic.id)?.status).toBe('success'))

    expect(h.fetch.mock.calls[0]?.[0]).toBe('https://api.acme.test/v1/chat/completions')
    expect(assistantMessage(h.repos, h.topic.id)?.data.parts[0]).toMatchObject({ text: 'default path' })
  })

  it('uses the configured Responses endpoint when the model selected it', async () => {
    const h = harness('responses', [
      { protocol: 'chat-completions', baseUrl: 'https://api.acme.test' },
      { protocol: 'responses', baseUrl: 'https://responses.acme.test/base' }
    ])
    h.fetch.mockImplementation(async () =>
      new Response(JSON.stringify({ output_text: 'responses path' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )

    await send(h.runtime, h.topic.id)
    await vi.waitFor(() => expect(assistantMessage(h.repos, h.topic.id)?.status).toBe('success'))

    expect(h.fetch.mock.calls[0]?.[0]).toBe('https://responses.acme.test/base/v1/responses')
    expect(assistantMessage(h.repos, h.topic.id)?.data.parts[0]).toMatchObject({ text: 'responses path' })
  })

  it('uses the configured Gemini endpoint when the model selected it', async () => {
    const h = harness('gemini', [
      { protocol: 'chat-completions', baseUrl: 'https://api.acme.test' },
      { protocol: 'gemini', baseUrl: 'https://gemini.acme.test' }
    ])
    h.fetch.mockImplementation(async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'gemini path' }] } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )

    await send(h.runtime, h.topic.id)
    await vi.waitFor(() => expect(assistantMessage(h.repos, h.topic.id)?.status).toBe('success'))

    expect(h.fetch.mock.calls[0]?.[0]).toBe(
      'https://gemini.acme.test/v1beta/models/acme-chat:generateContent'
    )
    expect(assistantMessage(h.repos, h.topic.id)?.data.parts[0]).toMatchObject({ text: 'gemini path' })
  })

  /**
   * PLAT-69：`messages` 协议走 `/v1/messages`（x-api-key），并且能用 `anthropicBaseUrl`
   * （官方 Anthropic 预设只配这个字段）当作端点。
   */
  it('uses the Anthropic messages endpoint when the model selected it', async () => {
    const h = harness('messages', [
      { protocol: 'chat-completions', baseUrl: 'https://api.acme.test' },
      { protocol: 'messages', baseUrl: 'https://anthropic.acme.test' }
    ])
    h.fetch.mockImplementation(async () =>
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'messages path' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )

    await send(h.runtime, h.topic.id)
    await vi.waitFor(() => expect(assistantMessage(h.repos, h.topic.id)?.status).toBe('success'))

    expect(h.fetch.mock.calls[0]?.[0]).toBe('https://anthropic.acme.test/v1/messages')
    const headers = (h.fetch.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-test-1234567890')
    expect(assistantMessage(h.repos, h.topic.id)?.data.parts[0]).toMatchObject({ text: 'messages path' })
  })

  it('uses the declared messages endpoint for the messages protocol', async () => {
    const h = harness('messages', [
      { protocol: 'chat-completions', baseUrl: 'https://api.acme.test' },
      { protocol: 'messages', baseUrl: 'https://anthropic-direct.acme.test' }
    ])
    h.fetch.mockImplementation(async () =>
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'direct path' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )

    await send(h.runtime, h.topic.id)
    await vi.waitFor(() => expect(assistantMessage(h.repos, h.topic.id)?.status).toBe('success'))

    expect(h.fetch.mock.calls[0]?.[0]).toBe('https://anthropic-direct.acme.test/v1/messages')
  })

  it('fails closed without sending anything when the selected endpoint is missing', async () => {
    const h = harness('responses', [{ protocol: 'chat-completions', baseUrl: 'https://api.acme.test' }])

    await send(h.runtime, h.topic.id)
    await vi.waitFor(() => expect(assistantMessage(h.repos, h.topic.id)?.status).toBe('error'))

    expect(h.fetch).not.toHaveBeenCalled()
    expect(assistantMessage(h.repos, h.topic.id)?.data.parts[0]).toMatchObject({
      type: 'error',
      code: 'provider-configuration-required'
    })
  })

  /**
   * B 包：模型选 responses + 端点已配 + 助手开启网页搜索 ⇒ 走 `/v1/responses` 的工具循环，
   * 网页搜索卡片照旧落盘（默认协议仍是 chat/completions，这条路径只在显式选择时生效）。
   */
  it('runs the web search tool loop over the Responses endpoint and keeps the citation card', async () => {
    const webSearchService = {
      searchKeywords: vi.fn(async () => ({
        providerId: 'tavily',
        capability: 'searchKeywords',
        inputs: ['docs'],
        results: [{ title: 'Docs', url: 'https://example.com/docs', content: 'source content', sourceInput: 'docs' }]
      })),
      fetchUrls: vi.fn()
    }
    const h = harness('responses', [
      { protocol: 'chat-completions', baseUrl: 'https://api.acme.test' },
      { protocol: 'responses', baseUrl: 'https://responses.acme.test' }
    ], {
      enableWebSearch: true,
      webSearchService
    })
    h.fetch
      .mockResolvedValueOnce(
        Response.json({
          output: [{ type: 'function_call', name: 'web_search', arguments: '{"query":"docs"}', call_id: 'call_1' }]
        })
      )
      .mockResolvedValueOnce(Response.json({ output_text: 'Answer with citation.' }))

    await send(h.runtime, h.topic.id)
    await vi.waitFor(() => expect(assistantMessage(h.repos, h.topic.id)?.status).toBe('success'))

    expect(h.fetch.mock.calls.map((call) => call[0])).toEqual([
      'https://responses.acme.test/v1/responses',
      'https://responses.acme.test/v1/responses'
    ])
    const firstBody = JSON.parse(String(h.fetch.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    const sentTools = firstBody.tools as Array<Record<string, unknown>>
    expect(sentTools).toContainEqual(
      expect.objectContaining({ type: 'function', name: 'web_search', parameters: expect.any(Object) })
    )
    // 必须是 Responses 的扁平形状，不能是 chat 的嵌套 `function` 形状
    expect(sentTools.every((tool) => typeof tool.name === 'string' && !('function' in tool))).toBe(true)
    expect(assistantMessage(h.repos, h.topic.id)?.data.parts).toEqual([
      expect.objectContaining({ type: 'web-search', toolName: 'web_search', status: 'success', query: 'docs' }),
      { type: 'text', text: 'Answer with citation.' }
    ])
    expect(webSearchService.searchKeywords).toHaveBeenCalledWith(
      { keywords: ['docs'] },
      expect.objectContaining({
        consumer: expect.objectContaining({ kind: 'assistant', id: h.repos.assistants.list()[0]?.id, sessionId: h.topic.id })
      })
    )
  })
})
