import { describe, expect, it, vi } from 'vitest'

import { parseAnthropicMessagesRequest } from './anthropicMessagesTypes'
import { buildResponsesUrl } from '../../../ai/providers/providerEndpoints'
import {
  convertOpenAiResponsesToAnthropic,
  forwardOpenAiResponses,
  mapAnthropicRequestToOpenAiResponses
} from './openAiResponsesAdapter'

describe('openAiResponsesAdapter', () => {
  it('maps Anthropic Messages requests to OpenAI Responses payloads', () => {
    const request = parseAnthropicMessagesRequest(
      JSON.stringify({
        model: 'gpt-4.1',
        max_tokens: 64,
        system: 'Be careful.',
        messages: [{ role: 'user', content: 'hello' }],
        tools: [
          {
            name: 'search',
            description: 'Search',
            input_schema: { type: 'object', properties: { q: { type: 'string' } } }
          }
        ]
      })
    )

    expect(mapAnthropicRequestToOpenAiResponses(request)).toEqual({
      model: 'gpt-4.1',
      max_output_tokens: 64,
      stream: false,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: 'Be careful.' }]
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'hello' }]
        }
      ],
      tools: [
        {
          type: 'function',
          name: 'search',
          description: 'Search',
          parameters: { type: 'object', properties: { q: { type: 'string' } } }
        }
      ]
    })
  })

  it('converts non-stream OpenAI Responses results to Anthropic Messages', () => {
    const anthropic = convertOpenAiResponsesToAnthropic(
      {
        id: 'resp_1',
        model: 'gpt-4.1',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'done' }]
          },
          {
            type: 'function_call',
            id: 'call_1',
            name: 'search',
            arguments: '{"q":"eth"}'
          }
        ],
        usage: { input_tokens: 2, output_tokens: 4 }
      },
      'gpt-4.1'
    )

    expect(anthropic).toMatchObject({
      id: 'resp_1',
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'done' },
        { type: 'tool_use', id: 'call_1', name: 'search', input: { q: 'eth' } }
      ]
    })
  })

  it('streams OpenAI Responses text and completion events as Anthropic SSE', async () => {
    const stream = [
      'data: {"type":"response.created","response":{"id":"resp_stream"}}\n\n',
      'data: {"type":"response.output_text.delta","delta":"hi"}\n\n',
      'data: {"type":"response.completed","response":{"id":"resp_stream"}}\n\n'
    ].join('')

    const result = await forwardOpenAiResponses({
      upstreamBaseUrl: 'https://api.openai.com/v1',
      upstreamApiKey: 'secret-key',
      body: JSON.stringify({
        model: 'gpt-4.1',
        max_tokens: 16,
        stream: true,
        messages: [{ role: 'user', content: 'hi' }]
      }),
      fetch: vi.fn(async () =>
        new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' }
        })
      )
    })

    expect(result.status).toBe(200)
    expect(result.body).toContain('event: message_start')
    expect(result.body).toContain('"text":"hi"')
    expect(result.body).toContain('event: message_stop')
  })

  it('does not return 501 for openai-responses routes', async () => {
    const fetch = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe('https://api.openai.com/v1/responses')
      return new Response(
        JSON.stringify({
          id: 'resp_ok',
          model: 'gpt-4.1',
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
          usage: { input_tokens: 1, output_tokens: 1 }
        }),
        { status: 200 }
      )
    })

    const result = await forwardOpenAiResponses({
      upstreamBaseUrl: 'https://api.openai.com/v1',
      upstreamApiKey: 'secret-key',
      body: JSON.stringify({
        model: 'gpt-4.1',
        max_tokens: 8,
        messages: [{ role: 'user', content: 'ping' }]
      }),
      fetch
    })

    expect(result.status).toBe(200)
    expect(result.body).not.toContain('unsupported_api_type')
    expect(JSON.parse(result.body)).toMatchObject({
      content: [{ type: 'text', text: 'ok' }]
    })
  })

  it('builds OpenAI Responses URLs from provider base URLs', () => {
    expect(buildResponsesUrl('https://api.openai.com')).toBe('https://api.openai.com/v1/responses')
    expect(buildResponsesUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/responses')
  })
})
