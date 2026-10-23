import { describe, expect, it, vi } from 'vitest'

import { createAgentModelGatewayProviderAdapter } from './AgentModelGatewayProviderAdapter'
import type { AgentModelGatewayProviderConfig } from './agentModelGatewayTypes'

describe('AgentModelGatewayProviderAdapter', () => {
  it('forwards anthropic-messages without returning 501', async () => {
    const adapter = createAgentModelGatewayProviderAdapter()
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'msg_1', type: 'message' }), { status: 200 }))

    const result = await adapter.forwardAnthropicMessages({
      config: config('anthropic-messages', 'https://api.anthropic.com'),
      body: JSON.stringify({
        model: 'claude-sonnet-4',
        max_tokens: 8,
        messages: [{ role: 'user', content: 'ping' }]
      }),
      upstreamApiKey: 'secret-key',
      fetch
    })

    expect(result.status).toBe(200)
    expect(fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST'
      })
    )
  })

  it('routes openai-chat-completions without returning 501 unsupported_api_type', async () => {
    const adapter = createAgentModelGatewayProviderAdapter()
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'chatcmpl_1',
          model: 'deepseek-chat',
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 }
        }),
        { status: 200 }
      )
    )

    const result = await adapter.forwardAnthropicMessages({
      config: config('openai-chat-completions', 'https://api.deepseek.com'),
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 8,
        messages: [{ role: 'user', content: 'ping' }]
      }),
      upstreamApiKey: 'secret-key',
      fetch
    })

    expect(result.status).toBe(200)
    expect(result.body).not.toContain('unsupported_api_type')
    expect(JSON.parse(result.body)).toMatchObject({
      type: 'message',
      content: [{ type: 'text', text: 'ok' }]
    })
  })

  it('routes openai-responses without returning 501 unsupported_api_type', async () => {
    const adapter = createAgentModelGatewayProviderAdapter()
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'resp_1',
          model: 'gpt-4.1',
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
          usage: { input_tokens: 1, output_tokens: 1 }
        }),
        { status: 200 }
      )
    )

    const result = await adapter.forwardAnthropicMessages({
      config: config('openai-responses', 'https://api.openai.com/v1'),
      body: JSON.stringify({
        model: 'gpt-4.1',
        max_tokens: 8,
        messages: [{ role: 'user', content: 'ping' }]
      }),
      upstreamApiKey: 'secret-key',
      fetch
    })

    expect(result.status).toBe(200)
    expect(result.body).not.toContain('unsupported_api_type')
    expect(JSON.parse(result.body)).toMatchObject({
      type: 'message',
      content: [{ type: 'text', text: 'ok' }]
    })
  })
})

function config(
  apiType: AgentModelGatewayProviderConfig['apiType'],
  upstreamBaseUrl: string
): AgentModelGatewayProviderConfig {
  return {
    providerId: 'provider-1',
    modelId: 'model-1',
    apiType,
    upstreamBaseUrl,
    hasUpstreamApiKey: true,
    configVersion: '1',
    updatedAt: '2026-07-09T00:00:00.000Z'
  }
}
