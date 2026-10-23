import { describe, expect, it, vi } from 'vitest'

import type { ProviderChatEndpoint } from '../../providers/modelProviderTypes'
import { requestAssistantChatCompletion } from './assistantChatProtocolClient'

/**
 * B 包：助手侧把 chat 形状的 tools 传给**非默认协议**链路。
 *
 * 映射只发生在这里：`ChatCompletionTool`（嵌套 `function`）→ 中性 `ChatProtocolTool`（扁平），
 * 由 Responses 适配器再翻译成供应商形状。gemini/messages 这条链路仍旧不发 tools。
 */
const messages = [{ role: 'user' as const, content: 'Current docs?' }]

const webSearchTool = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description: 'Search the web',
    parameters: { type: 'object', properties: { query: { type: 'string' } } }
  }
}

type Call = { url: string; init: RequestInit }

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

async function run(options: {
  protocol: 'responses' | 'gemini' | 'messages'
  /** 端点清单（`[0]` = 默认端点）。 */
  endpoints: readonly ProviderChatEndpoint[]
  responses: Array<() => Response>
  maxToolCalls?: number
  executeTool?: (call: { id: string; name: string; argumentsJson: string }) => Promise<unknown>
}): Promise<{ result: Awaited<ReturnType<typeof requestAssistantChatCompletion>>; calls: Call[] }> {
  const calls: Call[] = []
  let index = 0
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const next = options.responses[index]
    index += 1
    if (!next) throw new Error('unexpected extra provider request')
    return next()
  })
  const result = await requestAssistantChatCompletion({
    protocol: options.protocol,
    baseUrl: 'https://api.acme.test',
    endpoints: options.endpoints,
    apiKey: 'sk-test-1234567890',
    providerId: 'acme',
    modelId: 'acme-chat',
    messages,
    temperature: 0.2,
    fetch: fetchMock as unknown as typeof fetch,
    tools: [webSearchTool],
    executeTool: (options.executeTool ?? (async () => ({ ok: true, content: 'tool output' }))) as never,
    ...(options.maxToolCalls === undefined ? {} : { maxToolCalls: options.maxToolCalls })
  })
  return { result, calls }
}

describe('requestAssistantChatCompletion tool forwarding', () => {
  it('maps chat tools onto the Responses request and returns the citation message part', async () => {
    const executeTool = vi.fn(async () => ({
      ok: true,
      content: 'sources',
      messagePart: { type: 'web-search', toolName: 'web_search', status: 'success', query: 'docs' }
    }))
    const { result, calls } = await run({
      protocol: 'responses',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://api.acme.test' },
        { protocol: 'responses', baseUrl: 'https://responses.acme.test' }
      ],
      responses: [
        () =>
          jsonResponse({
            output: [
              { type: 'function_call', name: 'web_search', arguments: '{"query":"docs"}', call_id: 'call_1' }
            ]
          }),
        () => jsonResponse({ output_text: 'Answer with citation.' })
      ],
      executeTool
    })

    expect(calls).toHaveLength(2)
    expect(calls[0]?.url).toBe('https://responses.acme.test/v1/responses')
    const firstBody = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>
    expect(firstBody.tools).toEqual([
      {
        type: 'function',
        name: 'web_search',
        description: 'Search the web',
        parameters: webSearchTool.function.parameters
      }
    ])
    expect(firstBody.tool_choice).toBe('auto')

    expect(executeTool).toHaveBeenCalledWith({
      id: 'call_1',
      name: 'web_search',
      argumentsJson: '{"query":"docs"}'
    })
    const secondInput = JSON.parse(String(calls[1]?.init.body)).input as Array<Record<string, unknown>>
    expect(secondInput[secondInput.length - 1]).toEqual({
      type: 'function_call_output',
      call_id: 'call_1',
      output: 'sources'
    })

    expect(result.text).toBe('Answer with citation.')
    expect(result.messageParts).toEqual([
      { type: 'web-search', toolName: 'web_search', status: 'success', query: 'docs' }
    ])
  })

  it('passes maxToolCalls down to the Responses tool loop', async () => {
    await expect(
      run({
        protocol: 'responses',
        endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://api.acme.test' },
        { protocol: 'responses', baseUrl: 'https://responses.acme.test' }
      ],
        maxToolCalls: 1,
        responses: [
          () =>
            jsonResponse({
              output: [
                { type: 'function_call', name: 'web_search', arguments: '{}', call_id: 'call_1' },
                { type: 'function_call', name: 'web_search', arguments: '{}', call_id: 'call_2' }
              ]
            })
        ]
      })
    ).rejects.toThrow('Model tool call limit exceeded.')
  })

  it('keeps tools away from the gemini path', async () => {
    const { calls } = await run({
      protocol: 'gemini',
      endpoints: [
        { protocol: 'gemini', baseUrl: 'https://gemini.acme.test' } as const
      ],
      responses: [() => jsonResponse({ candidates: [{ content: { parts: [{ text: 'gemini reply' }] } }] })]
    })

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>
    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('tool_choice')
  })
})
