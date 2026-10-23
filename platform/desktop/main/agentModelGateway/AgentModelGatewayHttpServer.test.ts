import { describe, expect, it, vi } from 'vitest'

import type { ModelProvider } from '../../../ai/providers/modelProviderTypes'
import { AgentModelGatewayConfigService } from './AgentModelGatewayConfigService'
import { AgentModelGatewayHttpServer } from './AgentModelGatewayHttpServer'
import { createAgentModelGatewayProviderAdapter } from './AgentModelGatewayProviderAdapter'

const provider: ModelProvider = {
  id: 'deepseek',
  name: 'DeepSeek',
  endpoints: [
    { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' },
    { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' }
  ],
  enabled: true,
  baseUrl: 'https://api.deepseek.com',

  apiKey: 'secret-key',
  models: [
    {
      id: 'deepseek-chat',
      name: 'DeepSeek Chat',
      capabilities: {
        chat: true,
        vision: false,
        embedding: false,
        tools: true,
        agentRuntimes: { claudeCode: true }
      }
    }
  ]
}

describe('AgentModelGatewayHttpServer', () => {
  it('serves health checks and rejects unauthorized Anthropic requests', async () => {
    const configService = new AgentModelGatewayConfigService()
    configService.syncProviderConfig(provider, provider.models[0]!)
    const authToken = configService.rotateAuthToken(() => new Date('2026-07-09T00:00:00.000Z'))
    const fetch = vi.fn(async () => new Response('{"id":"msg"}', { status: 200 }))

    const server = new AgentModelGatewayHttpServer({
      port: 18801,
      getAuthToken: () => configService.getAuthToken(),
      getProviderConfig: () => configService.getConfig(),
      adapter: createAgentModelGatewayProviderAdapter(),
      fetch,
      getUpstreamApiKey: () => 'secret-key'
    })

    await server.start()

    const health = await fetchImpl('http://127.0.0.1:18801/health')
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ ok: true, status: 'live' })

    const unauthorized = await fetchImpl('http://127.0.0.1:18801/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-chat', max_tokens: 1, messages: [] })
    })
    expect(unauthorized.status).toBe(401)

    const authorized = await fetchImpl('http://127.0.0.1:18801/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': authToken
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }]
      })
    })
    expect(authorized.status).toBe(200)
    expect(fetch).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer secret-key'
        }),
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false
        })
      })
    )

    await server.stop()
  })
})

function fetchImpl(input: string, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init)
}
