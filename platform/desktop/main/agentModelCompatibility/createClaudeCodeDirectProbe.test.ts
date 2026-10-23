import { describe, expect, it, vi } from 'vitest'

import type { ProviderState } from '../../../ai/providers/modelProviderTypes'
import { buildMessagesUrl } from '../../../ai/providers/providerEndpoints'
import { createClaudeCodeDirectProbe } from './createClaudeCodeDirectProbe'

const readyProviderState: ProviderState = {
  providers: [
    {
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
      ],
      defaultChatModelId: 'deepseek-chat'
    }
  ]
}

describe('createClaudeCodeDirectProbe', () => {
  it('builds Anthropic Messages URLs for direct and /anthropic base URLs', () => {
    expect(buildMessagesUrl('https://api.deepseek.com/anthropic')).toBe(
      'https://api.deepseek.com/anthropic/v1/messages'
    )
    expect(buildMessagesUrl('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com/v1/messages')
  })

  it('classifies 401 responses as auth failures', async () => {
    const fetch = vi.fn(async () => new Response('authentication_failed', { status: 401 }))

    const snapshot = await createClaudeCodeDirectProbe(
      {
        providerState: readyProviderState,
        providerId: 'deepseek',
        modelId: 'deepseek-chat'
      },
      { fetch, now: () => new Date('2026-07-09T00:00:00.000Z') }
    )

    expect(snapshot.status).toBe('auth-failed')
    expect(snapshot.route).toBe('direct')
    expect(fetch).toHaveBeenCalledWith(
      'https://api.deepseek.com/anthropic/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'secret-key'
        })
      })
    )
  })

  it('classifies 403 responses as forbidden', async () => {
    const snapshot = await createClaudeCodeDirectProbe(
      {
        providerState: readyProviderState,
        providerId: 'deepseek',
        modelId: 'deepseek-chat'
      },
      {
        fetch: vi.fn(async () => new Response('forbidden', { status: 403 })),
        now: () => new Date('2026-07-09T00:00:00.000Z')
      }
    )

    expect(snapshot.status).toBe('forbidden')
  })

  it('treats successful responses as ready even when ordinary chat would also succeed', async () => {
    const snapshot = await createClaudeCodeDirectProbe(
      {
        providerState: readyProviderState,
        providerId: 'deepseek',
        modelId: 'deepseek-chat'
      },
      {
        fetch: vi.fn(async () => new Response('{"id":"msg_123"}', { status: 200 })),
        now: () => new Date('2026-07-09T00:00:00.000Z')
      }
    )

    expect(snapshot.status).toBe('ready')
  })

  it('treats model validation 400 responses as auth-passed readiness', async () => {
    const snapshot = await createClaudeCodeDirectProbe(
      {
        providerState: readyProviderState,
        providerId: 'deepseek',
        modelId: 'deepseek-chat'
      },
      {
        fetch: vi.fn(async () => new Response('{"error":"invalid model"}', { status: 400 })),
        now: () => new Date('2026-07-09T00:00:00.000Z')
      }
    )

    expect(snapshot.status).toBe('ready')
  })

  it('classifies missing endpoint responses as protocol unsupported', async () => {
    const snapshot = await createClaudeCodeDirectProbe(
      {
        providerState: readyProviderState,
        providerId: 'deepseek',
        modelId: 'deepseek-chat'
      },
      {
        fetch: vi.fn(async () => new Response('not found', { status: 404 })),
        now: () => new Date('2026-07-09T00:00:00.000Z')
      }
    )

    expect(snapshot.status).toBe('protocol-unsupported')
  })

  it('classifies probe timeouts separately from auth failures', async () => {
    const fetch = vi.fn((_url, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    })

    const snapshot = await createClaudeCodeDirectProbe(
      {
        providerState: readyProviderState,
        providerId: 'deepseek',
        modelId: 'deepseek-chat'
      },
      {
        fetch,
        timeoutMs: 5,
        now: () => new Date('2026-07-09T00:00:00.000Z')
      }
    )

    expect(snapshot.status).toBe('timeout')
  })

  it('aborts in-flight probes when the caller abort signal fires', async () => {
    const controller = new AbortController()
    const fetch = vi.fn((_url, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
        controller.abort('user-cancel')
      })
    })

    const snapshot = await createClaudeCodeDirectProbe(
      {
        providerState: readyProviderState,
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
        abortSignal: controller.signal
      },
      {
        fetch,
        now: () => new Date('2026-07-09T00:00:00.000Z')
      }
    )

    expect(snapshot.status).toBe('unknown')
    expect(snapshot.message).toContain('aborted')
  })

  it('summarizes a 429 overloaded_error body instead of dumping raw JSON', async () => {
    const body = JSON.stringify({
      type: 'error',
      error: {
        type: 'overloaded_error',
        code: '1305',
        message: 'The service may be temporarily overloaded.'
      },
      request_id: 'req_abc123'
    })
    const fetch = vi.fn(async () => new Response(body, {
      status: 429,
      headers: { 'content-type': 'application/json' }
    }))

    const snapshot = await createClaudeCodeDirectProbe(
      {
        providerState: readyProviderState,
        providerId: 'deepseek',
        modelId: 'deepseek-chat'
      },
      { fetch, now: () => new Date('2026-07-09T00:00:00.000Z') }
    )

    expect(snapshot.message).toContain('HTTP 429')
    expect(snapshot.message).toContain('overloaded_error')
    expect(snapshot.message).toContain('req_abc123')
    expect(snapshot.message).not.toContain('{"')
    expect(snapshot.message).not.toContain('"type":"error"')
    expect(snapshot.message?.length ?? 0).toBeLessThanOrEqual(240)
  })

  it('classifies a messages-protocol 500 as protocol unsupported with a summarized body', async () => {
    const body = JSON.stringify({
      code: 500,
      msg: '模型 glm-4.6 下无渠道支持messages协议，请注意使用的接口协议'
    })
    const fetch = vi.fn(async () => new Response(body, {
      status: 500,
      headers: { 'content-type': 'application/json' }
    }))

    const snapshot = await createClaudeCodeDirectProbe(
      {
        providerState: readyProviderState,
        providerId: 'deepseek',
        modelId: 'deepseek-chat'
      },
      { fetch, now: () => new Date('2026-07-09T00:00:00.000Z') }
    )

    expect(snapshot.status).toBe('protocol-unsupported')
    expect(snapshot.message).toContain('HTTP 500')
    expect(snapshot.message).toContain('messages协议')
    expect(snapshot.message).not.toContain('{"')
  })
})
