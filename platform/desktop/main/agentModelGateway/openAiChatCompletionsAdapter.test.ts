import { describe, expect, it, vi } from 'vitest'

import { buildChatCompletionsUrl } from '../../../ai/providers/providerEndpoints'
import {
  convertOpenAiChatCompletionToAnthropic,
  forwardOpenAiChatCompletions,
  mapAnthropicRequestToOpenAiChatCompletions
} from './openAiChatCompletionsAdapter'
import { parseAnthropicMessagesRequest } from './anthropicMessagesTypes'

describe('openAiChatCompletionsAdapter', () => {
  it('maps Anthropic Messages requests to OpenAI Chat Completions payloads', () => {
    const request = parseAnthropicMessagesRequest(
      JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 32,
        temperature: 0.2,
        system: 'Be concise.',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'hello' }]
          }
        ],
        tools: [
          {
            name: 'lookup',
            description: 'Lookup a value',
            input_schema: { type: 'object', properties: { q: { type: 'string' } } }
          }
        ],
        tool_choice: { type: 'auto' }
      })
    )

    expect(mapAnthropicRequestToOpenAiChatCompletions(request)).toEqual({
      model: 'deepseek-chat',
      max_tokens: 32,
      temperature: 0.2,
      stream: false,
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'hello' }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup',
            description: 'Lookup a value',
            parameters: { type: 'object', properties: { q: { type: 'string' } } }
          }
        }
      ],
      tool_choice: 'auto'
    })
  })

  it('converts non-stream OpenAI Chat Completions responses to Anthropic Messages', () => {
    const anthropic = convertOpenAiChatCompletionToAnthropic(
      {
        id: 'chatcmpl_1',
        model: 'deepseek-chat',
        choices: [
          {
            message: {
              content: 'pong',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'lookup', arguments: '{"q":"btc"}' }
                }
              ]
            },
            finish_reason: 'tool_calls'
          }
        ],
        usage: { prompt_tokens: 3, completion_tokens: 5 }
      },
      'deepseek-chat'
    )

    expect(anthropic).toMatchObject({
      id: 'chatcmpl_1',
      type: 'message',
      role: 'assistant',
      model: 'deepseek-chat',
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'pong' },
        { type: 'tool_use', id: 'call_1', name: 'lookup', input: { q: 'btc' } }
      ],
      usage: { input_tokens: 3, output_tokens: 5 }
    })
  })

  it('streams OpenAI Chat text deltas as Anthropic-compatible SSE', async () => {
    const stream = [
      'data: {"id":"chatcmpl_stream","choices":[{"delta":{"content":"hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n'
    ].join('')

    const result = await forwardOpenAiChatCompletions({
      upstreamBaseUrl: 'https://api.deepseek.com',
      upstreamApiKey: 'secret-key',
      body: JSON.stringify({
        model: 'deepseek-chat',
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
    expect(result.headers['content-type']).toContain('text/event-stream')
    expect(result.body).toContain('event: message_start')
    expect(result.body).toContain('event: content_block_delta')
    expect(result.body).toContain('"text":"hel"')
    expect(result.body).toContain('"text":"lo"')
    expect(result.body).toContain('event: message_stop')
  })

  it('streams OpenAI Chat tool calls as Anthropic tool_use events', async () => {
    const stream = [
      'data: {"id":"chatcmpl_tools","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"lookup","arguments":"{\\"q\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"btc\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n'
    ].join('')

    const result = await forwardOpenAiChatCompletions({
      upstreamBaseUrl: 'https://api.openai.com/v1',
      upstreamApiKey: 'secret-key',
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 16,
        stream: true,
        messages: [{ role: 'user', content: 'lookup btc' }]
      }),
      fetch: vi.fn(async () =>
        new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' }
        })
      )
    })

    expect(result.body).toContain('"type":"tool_use"')
    expect(result.body).toContain('"name":"lookup"')
    expect(result.body).toContain('input_json_delta')
    expect(result.body).toContain('tool_use')
  })

  it('forwards non-stream OpenAI Chat requests and does not return 501', async () => {
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.deepseek.com/v1/chat/completions')
      expect(init?.headers).toMatchObject({
        authorization: 'Bearer secret-key'
      })
      return new Response(
        JSON.stringify({
          id: 'chatcmpl_ok',
          model: 'deepseek-chat',
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 }
        }),
        { status: 200 }
      )
    })

    const result = await forwardOpenAiChatCompletions({
      upstreamBaseUrl: 'https://api.deepseek.com',
      upstreamApiKey: 'secret-key',
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 8,
        messages: [{ role: 'user', content: 'ping' }]
      }),
      fetch
    })

    expect(result.status).toBe(200)
    expect(JSON.parse(result.body)).toMatchObject({
      type: 'message',
      content: [{ type: 'text', text: 'ok' }]
    })
    expect(result.body).not.toContain('unsupported_api_type')
  })

  it('classifies upstream auth failures safely', async () => {
    const result = await forwardOpenAiChatCompletions({
      upstreamBaseUrl: 'https://api.deepseek.com',
      upstreamApiKey: 'secret-key',
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 8,
        messages: [{ role: 'user', content: 'ping' }]
      }),
      fetch: vi.fn(async () => new Response('invalid api key secret-key', { status: 401 }))
    })

    expect(result.status).toBe(401)
    expect(result.body).toContain('Upstream provider authentication failed')
    expect(result.body).not.toContain('secret-key')
  })

  it('builds OpenAI Chat Completions URLs from provider base URLs', () => {
    expect(buildChatCompletionsUrl('https://api.deepseek.com')).toBe(
      'https://api.deepseek.com/v1/chat/completions'
    )
    expect(buildChatCompletionsUrl('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/chat/completions'
    )
  })
})
