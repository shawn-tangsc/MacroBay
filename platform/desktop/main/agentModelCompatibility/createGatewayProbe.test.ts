import { describe, expect, it, vi } from 'vitest'

import type { AgentModelGatewaySnapshot } from '../agentModelGateway/agentModelGatewayTypes'
import { createGatewayProbe } from './createGatewayProbe'

describe('createGatewayProbe', () => {
  it('classifies stopped gateway separately from upstream failure', async () => {
    const snapshot = await createGatewayProbe(
      { providerId: 'deepseek', modelId: 'deepseek-chat' },
      {
        fetch: vi.fn(),
        getGatewaySnapshot: () => gatewaySnapshot({ enabled: true, state: 'stopped' }),
        getGatewayAuthToken: () => 'token',
        now: () => new Date('2026-07-09T00:00:00.000Z')
      }
    )

    expect(snapshot.status).toBe('unknown')
    expect(snapshot.message).toContain('stopped')
    expect(snapshot.route).toBe('gateway')
  })

  it('probes local Anthropic Messages endpoint when gateway is running', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ ok: true, status: 'live' }), { status: 200 })
      }
      return new Response('{"id":"msg"}', { status: 200 })
    })

    const snapshot = await createGatewayProbe(
      { providerId: 'deepseek', modelId: 'deepseek-chat' },
      {
        fetch,
        getGatewaySnapshot: () =>
          gatewaySnapshot({
            enabled: true,
            state: 'running',
            baseUrl: 'http://127.0.0.1:18779/anthropic'
          }),
        getGatewayAuthToken: () => 'local-token',
        now: () => new Date('2026-07-09T00:00:00.000Z')
      }
    )

    expect(snapshot.status).toBe('ready')
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:18779/anthropic/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'local-token'
        })
      })
    )
  })
})

function gatewaySnapshot(overrides: Partial<AgentModelGatewaySnapshot> = {}): AgentModelGatewaySnapshot {
  return {
    enabled: false,
    state: 'disabled',
    port: 18779,
    updatedAt: '2026-07-09T00:00:00.000Z',
    ...overrides
  }
}
