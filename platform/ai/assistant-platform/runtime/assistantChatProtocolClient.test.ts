import { describe, expect, it, vi } from 'vitest'

import type { ProviderChatEndpoint } from '../../providers/modelProviderTypes'
import { requestAssistantChatCompletion } from './assistantChatProtocolClient'

/**
 * T4/T5：按模型选择的协议派发。默认链路（chat/completions）逐字不变；
 * 只有模型显式选了 responses / gemini **且**供应商配了对应端点时才改道，
 * 否则在发请求前抛 provider-configuration-required。
 */
const chatEndpoints: ProviderChatEndpoint[] = [{ protocol: 'chat-completions', baseUrl: 'https://api.acme.test' }]

const messages = [
  { role: 'system' as const, content: 'Be brief.' },
  { role: 'user' as const, content: 'Hi' }
]

function okResponses(): Response {
  return new Response(JSON.stringify({ output_text: 'responses reply' }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function okGemini(): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: 'gemini reply' }] } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

function okChat(): Response {
  return new Response(
    'data: {"choices":[{"delta":{"content":"chat reply"}}]}\n\ndata: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } }
  )
}

type Call = { url: string; init: RequestInit }

async function run(options: {
  protocol?: 'chat-completions' | 'responses' | 'gemini'
  /** 端点清单（`[0]` = 默认端点）；不给就只有 chat/completions 一条。 */
  endpoints?: ProviderChatEndpoint[]
  response?: () => Response
  withTools?: boolean
} = {}): Promise<{ result: Awaited<ReturnType<typeof requestAssistantChatCompletion>>; calls: Call[] }> {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return options.response?.() ?? okChat()
  })
  const tools = options.withTools
    ? [
        {
          type: 'function' as const,
          function: { name: 'web_search', description: 'search', parameters: { type: 'object' } }
        }
      ]
    : undefined
  const result = await requestAssistantChatCompletion({
    // 协议是模型自己的事实：harness 默认把模型当作 chat-completions 模型。
    protocol: options.protocol ?? 'chat-completions',
    baseUrl: 'https://api.acme.test',
    endpoints: options.endpoints ?? chatEndpoints,
    apiKey: 'sk-test-1234567890',
    providerId: 'acme',
    modelId: 'acme-chat',
    messages,
    temperature: 0.2,
    fetch: fetchMock as unknown as typeof fetch,
    ...(tools ? { tools, executeTool: async () => ({ ok: true, content: 'x' }) } : {})
  })
  return { result, calls }
}

describe('requestAssistantChatCompletion', () => {
  it('keeps chat/completions for a chat-completions model', async () => {
    const { result, calls } = await run()

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.acme.test/v1/chat/completions')
    expect(result.text).toBe('chat reply')
  })

  it('refuses to guess when the model has no protocol', async () => {
    const fetchMock = vi.fn(async () => okChat())
    await expect(requestAssistantChatCompletion({
      baseUrl: 'https://api.acme.test',
      apiKey: 'sk-test-1234567890',
      modelId: 'acme-chat',
      messages,
      fetch: fetchMock as unknown as typeof fetch
    })).rejects.toMatchObject({
      name: 'ProviderRuntimeFailureError',
      code: 'provider-configuration-required'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('routes to the Responses endpoint only when the model selected it', async () => {
    const { result, calls } = await run({
      protocol: 'responses',
      endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.acme.test' },
          { protocol: 'responses', baseUrl: 'https://responses.acme.test/base' }
        ],
      response: okResponses
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://responses.acme.test/base/v1/responses')
    expect(result.text).toBe('responses reply')
  })

  it('routes to the Gemini endpoint only when the model selected it', async () => {
    const { result, calls } = await run({
      protocol: 'gemini',
      endpoints: [
        { protocol: 'gemini', baseUrl: 'https://gemini.acme.test' } as const
      ],
      response: okGemini
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://gemini.acme.test/v1beta/models/acme-chat:generateContent')
    expect(result.text).toBe('gemini reply')
  })

  it('refuses to send anything when the selected protocol has no configured endpoint', async () => {
    const fetchMock = vi.fn(async () => okResponses())
    const base = {
      baseUrl: 'https://api.acme.test',
      apiKey: 'sk-test-1234567890',
      modelId: 'acme-chat',
      messages,
      fetch: fetchMock as unknown as typeof fetch
    }

    // 选中 responses 但没配 responses 端点 ⇒ 拒绝，且不回落到 chat/completions
    await expect(
      requestAssistantChatCompletion({ ...base, protocol: 'responses', endpoints: [] })
    ).rejects.toMatchObject({
      name: 'ProviderRuntimeFailureError',
      code: 'provider-configuration-required'
    })
    // 选中 gemini 但没配 gemini 端点 ⇒ 同样拒绝
    await expect(
      requestAssistantChatCompletion({ ...base, endpoints: [{ protocol: 'responses', baseUrl: 'https://r.test' } as const, { protocol: 'gemini', baseUrl: '' } as const], })
    ).rejects.toMatchObject({
      name: 'ProviderRuntimeFailureError',
      code: 'provider-configuration-required'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('translates a neutral protocol failure into assistant failure evidence', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'Incorrect API key' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      })
    )

    await expect(
      requestAssistantChatCompletion({
        protocol: 'responses',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.acme.test' },
          { protocol: 'responses', baseUrl: 'https://responses.acme.test' }
        ],
        baseUrl: 'https://api.acme.test',
        apiKey: 'sk-test-1234567890',
        providerId: 'acme',
        modelId: 'acme-chat',
        messages,
        fetch: fetchMock as unknown as typeof fetch
      } as const)
    ).rejects.toMatchObject({
      name: 'AssistantInvocationFailureError',
      message: 'provider-request-failed',
      evidence: { phase: 'response', httpStatus: 401, providerId: 'acme', modelId: 'acme-chat' }
    })
  })

  it('forwards tools to responses but never to gemini', async () => {
    const responses = await run({
      protocol: 'responses',
      endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.acme.test' },
          { protocol: 'responses', baseUrl: 'https://responses.acme.test' }
        ],
      response: okResponses,
      withTools: true
    })
    const responsesBody = JSON.parse(String(responses.calls[0]?.init.body)) as { tools?: unknown }
    expect(responsesBody.tools).toEqual([
      { type: 'function', name: 'web_search', description: 'search', parameters: { type: 'object' } }
    ])

    const gemini = await run({
      protocol: 'gemini',
      endpoints: [
        { protocol: 'gemini', baseUrl: 'https://gemini.acme.test' } as const
      ],
      response: okGemini,
      withTools: true
    })
    expect(JSON.parse(String(gemini.calls[0]?.init.body))).not.toHaveProperty('tools')
  })
})
