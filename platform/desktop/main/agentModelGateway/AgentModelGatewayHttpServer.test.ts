import { describe, expect, it, vi } from 'vitest'

import {
  AGENT_MODEL_GATEWAY_FALLBACK_TIMEOUT_MS,
  AGENT_MODEL_REQUEST_TIMEOUT_HEADER
} from '../../../ai/agent-platform/runtime/agentModelRequestBudget'
import type { ModelProvider } from '../../../ai/providers/modelProviderTypes'
import { AgentModelGatewayConfigService } from './AgentModelGatewayConfigService'
import { AgentModelGatewayHttpServer } from './AgentModelGatewayHttpServer'
import type { AgentModelGatewayProviderAdapter } from './AgentModelGatewayProviderAdapter'
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

describe('AgentModelGatewayHttpServer timeout budget', () => {
  // The production pair is "caller declares 240s, gateway falls back to 60s". Here the fallback is
  // 60ms and the declared budget 2000ms, so the same relationship is observable in milliseconds:
  // before the budget travelled with the request, every one of these requests died at the fallback.
  const FALLBACK_MS = 60
  const DECLARED_MS = 2_000
  const UPSTREAM_MS = 200

  it('times the request against the declared budget and falls back when none is declared', async () => {
    const seen: Array<number | undefined> = []
    const adapter: AgentModelGatewayProviderAdapter = {
      forwardAnthropicMessages: async (input) => {
        seen.push(input.timeoutMs)
        return { status: 200, headers: { 'content-type': 'application/json' }, body: '{"id":"msg"}' }
      }
    }

    const { server, authToken } = await startServer({ port: 18802, adapter })
    try {
      const undeclared = await postMessages(18802, authToken)
      expect(undeclared.status).toBe(200)

      const declared = await postMessages(18802, authToken, {
        [AGENT_MODEL_REQUEST_TIMEOUT_HEADER]: String(DECLARED_MS)
      })
      expect(declared.status).toBe(200)
    } finally {
      await server.stop()
    }

    expect(seen).toEqual([AGENT_MODEL_GATEWAY_FALLBACK_TIMEOUT_MS, DECLARED_MS])
  })

  it('rejects a declared budget it cannot honor instead of silently using the fallback', async () => {
    const forward = vi.fn(async () => ({ status: 200, headers: {}, body: '{"id":"msg"}' }))
    const adapter: AgentModelGatewayProviderAdapter = { forwardAnthropicMessages: forward }

    const { server, authToken } = await startServer({ port: 18803, adapter })
    try {
      const response = await postMessages(18803, authToken, {
        [AGENT_MODEL_REQUEST_TIMEOUT_HEADER]: '240'
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'invalid_request_timeout_budget' })
    } finally {
      await server.stop()
    }

    expect(forward).not.toHaveBeenCalled()
  })

  it('does not cut a slow upstream that answers inside the declared budget', async () => {
    let upstreamAborted = false
    const { server, authToken } = await startServer({
      port: 18804,
      adapter: createAgentModelGatewayProviderAdapter(),
      fetch: slowFetch(UPSTREAM_MS, () => {
        upstreamAborted = true
      }),
      fallbackTimeoutMs: FALLBACK_MS
    })

    try {
      const response = await postMessages(18804, authToken, {
        [AGENT_MODEL_REQUEST_TIMEOUT_HEADER]: String(DECLARED_MS)
      })
      expect(response.status).toBe(200)
    } finally {
      await server.stop()
    }

    expect(upstreamAborted).toBe(false)
  })

  it('still cuts at the fallback when the caller declares nothing', async () => {
    const { server, authToken } = await startServer({
      port: 18805,
      adapter: createAgentModelGatewayProviderAdapter(),
      fetch: slowFetch(UPSTREAM_MS, () => {}),
      fallbackTimeoutMs: FALLBACK_MS
    })

    try {
      const response = await postMessages(18805, authToken)
      // The gateway's own budget turning over is a timeout, not an upstream failure.
      expect(response.status).toBe(504)
    } finally {
      await server.stop()
    }
  })
})

async function startServer(options: {
  port: number
  adapter: AgentModelGatewayProviderAdapter
  fetch?: typeof fetch
  fallbackTimeoutMs?: number
}): Promise<{ server: AgentModelGatewayHttpServer; authToken: string }> {
  const configService = new AgentModelGatewayConfigService()
  configService.syncProviderConfig(provider, provider.models[0]!)
  const authToken = configService.rotateAuthToken(() => new Date('2026-07-09T00:00:00.000Z'))
  const server = new AgentModelGatewayHttpServer({
    port: options.port,
    getAuthToken: () => configService.getAuthToken(),
    getProviderConfig: () => configService.getConfig(),
    adapter: options.adapter,
    fetch: options.fetch ?? (async () => new Response('{"id":"msg"}', { status: 200 })),
    getUpstreamApiKey: () => 'secret-key',
    ...(options.fallbackTimeoutMs === undefined ? {} : { fallbackTimeoutMs: options.fallbackTimeoutMs })
  })
  await server.start()
  return { server, authToken }
}

function postMessages(
  port: number,
  authToken: string,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  return fetchImpl(`http://127.0.0.1:${port}/anthropic/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': authToken,
      ...extraHeaders
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }]
    })
  })
}

/** Behaves like a real fetch: an aborted signal rejects instead of resolving late. */
function slowFetch(delayMs: number, onAbort: () => void): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs)
      const signal = init?.signal
      if (!signal) return
      const abort = () => {
        clearTimeout(timer)
        onAbort()
        reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
      }
      if (signal.aborted) {
        abort()
        return
      }
      signal.addEventListener('abort', abort, { once: true })
    })
    return new Response('{"id":"msg"}', { status: 200 })
  }) as typeof fetch
}
