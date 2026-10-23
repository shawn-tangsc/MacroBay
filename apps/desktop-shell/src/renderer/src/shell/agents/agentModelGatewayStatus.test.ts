import { describe, expect, it } from 'vitest'

import { resolveAgentModelGatewayStatusView } from './agentModelGatewayStatus'

describe('resolveAgentModelGatewayStatusView', () => {
  it('treats missing or disabled snapshots as disabled', () => {
    expect(resolveAgentModelGatewayStatusView(null)).toMatchObject({
      state: 'disabled',
      canEnable: true,
      canStart: false
    })
    expect(
      resolveAgentModelGatewayStatusView({
        enabled: false,
        state: 'disabled',
        port: 18779,
        updatedAt: '2026-07-09T00:00:00.000Z'
      })
    ).toMatchObject({
      state: 'disabled',
      tone: 'neutral'
    })
  })

  it('exposes start/stop actions from real gateway states', () => {
    expect(
      resolveAgentModelGatewayStatusView({
        enabled: true,
        state: 'stopped',
        port: 18779,
        updatedAt: '2026-07-09T00:00:00.000Z'
      })
    ).toMatchObject({
      state: 'stopped',
      canStart: true,
      canStop: false
    })

    expect(
      resolveAgentModelGatewayStatusView({
        enabled: true,
        state: 'running',
        port: 18779,
        baseUrl: 'http://127.0.0.1:18779/anthropic',
        updatedAt: '2026-07-09T00:00:00.000Z'
      })
    ).toMatchObject({
      state: 'running',
      tone: 'success',
      canStart: false,
      canStop: true
    })
  })
})
