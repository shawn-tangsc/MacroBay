import { describe, expect, it, vi } from 'vitest'

import {
  streamOpenAiCompatibleChatCompletion,
  type AssistantToolCall
} from './assistantOpenAiStreamClient'

describe('streamOpenAiCompatibleChatCompletion', () => {
  it('preserves a typed, request-safe provider failure for a non-2xx response', async () => {
    const providerBody = [
      'Authorization: Bearer provider-secret',
      'request=https://api.example.com/v1/chat/completions?api_key=query-secret#fragment',
      'upstream capacity unavailable'
    ].join('\n')

    const invocation = streamOpenAiCompatibleChatCompletion({
      baseUrl: 'https://api.example.com/v1?should-not-leak',
      apiKey: 'provider-secret',
      modelId: 'gpt-test',
      messages: [{ role: 'user', content: 'hello' }],
      fetch: async () => new Response(providerBody, { status: 429 })
    })

    await expect(invocation).rejects.toMatchObject({
      evidence: {
        phase: 'response',
        modelId: 'gpt-test',
        httpStatus: 429,
        body: expect.stringContaining('upstream capacity unavailable')
      }
    })
    await expect(invocation).rejects.toMatchObject({
      evidence: { body: expect.not.stringMatching(/provider-secret|query-secret|fragment/) }
    })
  })

  it('marks provider evidence that was UTF-8 truncated at the platform boundary', async () => {
    const invocation = streamOpenAiCompatibleChatCompletion({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'provider-secret',
      modelId: 'gpt-test',
      messages: [{ role: 'user', content: 'hello' }],
      fetch: async () => new Response('界'.repeat(10_000), { status: 502 })
    })

    await expect(invocation).rejects.toMatchObject({
      evidence: { truncated: true }
    })
  })

  it('does not send tools when no tools are provided', async () => {
    let requestBody: unknown
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      requestBody = init?.body
      return Response.json({
        choices: [{ message: { content: 'plain answer' } }]
      })
    })

    await streamOpenAiCompatibleChatCompletion({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'model-key',
      modelId: 'gpt-test',
      messages: [{ role: 'user', content: 'hello' }],
      fetch: fetch as typeof globalThis.fetch
    })

    const body = JSON.parse(requestBody as string) as Record<string, unknown>
    expect(body).not.toHaveProperty('tools')
  })

  it('runs tool calls and continues with tool results when tools are provided', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: { name: 'web_search', arguments: '{"query":"docs"}' }
                  }
                ]
              }
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ message: { content: 'final answer with sources' } }]
        })
      )
    const executeTool = vi.fn(async (call: AssistantToolCall) => ({
      ok: true,
      content: JSON.stringify([{ id: 1, title: 'Docs', url: 'https://example.com', content: 'hello' }]),
      messagePart: {
        type: 'web-search',
        toolName: call.name,
        status: 'success',
        sources: [{ id: 1, title: 'Docs', url: 'https://example.com', snippet: 'hello' }]
      }
    }))

    const result = await streamOpenAiCompatibleChatCompletion({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'model-key',
      modelId: 'gpt-test',
      messages: [{ role: 'user', content: 'current docs?' }],
      tools: [
        {
          type: 'function',
          function: { name: 'web_search', description: 'search', parameters: { type: 'object' } }
        }
      ],
      executeTool,
      maxToolCalls: 2,
      fetch: fetch as unknown as typeof globalThis.fetch
    })

    expect(result.text).toBe('final answer with sources')
    expect(result.messageParts).toHaveLength(1)
    expect(executeTool).toHaveBeenCalledWith({
      id: 'call-1',
      name: 'web_search',
      argumentsJson: '{"query":"docs"}'
    })
    const continuationBody = JSON.parse(fetch.mock.calls[1]?.[1]?.body as string) as {
      messages: Array<{ role: string; tool_call_id?: string; content?: string }>
    }
    expect(continuationBody.messages.some((message) => message.role === 'tool' && message.tool_call_id === 'call-1')).toBe(true)
  })
})
