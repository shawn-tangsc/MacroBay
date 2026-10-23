import { describe, expect, it, vi } from 'vitest'

import type { ModelProvider } from '../../../ai/providers/modelProviderTypes'
import { createAgentModelGatewayService } from './AgentModelGatewayService'

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

describe('AgentModelGatewayService', () => {
  it('tracks disabled, stopped, running, and error states', async () => {
    const service = createAgentModelGatewayService({
      fetch: globalThis.fetch,
      getUpstreamApiKey: () => 'secret-key',
      now: () => new Date('2026-07-09T00:00:00.000Z'),
      port: 0
    })

    expect(service.getSnapshot()).toMatchObject({
      enabled: false,
      state: 'disabled'
    })

    service.setEnabled(true)
    expect(service.getSnapshot().state).toBe('stopped')

    const startWithoutConfig = await service.start()
    expect(startWithoutConfig.ok).toBe(false)
    expect(startWithoutConfig.snapshot.state).toBe('stopped')
  })

  it('starts a loopback gateway after provider config sync', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ ok: true, status: 'live' }), { status: 200 })
      }
      return new Response('unexpected', { status: 500 })
    })

    const service = createAgentModelGatewayService({
      fetch,
      getUpstreamApiKey: () => 'secret-key',
      now: () => new Date('2026-07-09T00:00:00.000Z'),
      port: 18799
    })

    service.setEnabled(true)
    service.syncProviderConfig(provider, provider.models[0]!)
    const started = await service.start()

    expect(started.ok).toBe(true)
    expect(started.snapshot.state).toBe('running')
    expect(started.snapshot.baseUrl).toBe('http://127.0.0.1:18799/anthropic')
    expect(service.getAuthToken()).toMatch(/^[a-f0-9]{48}$/)

    await service.stop()
    expect(service.getSnapshot().state).toBe('stopped')
  })
})
