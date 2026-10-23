import { describe, expect, it } from 'vitest'

import type { AgentChannelRuntimeSnapshot } from '@platform/ai/agent-platform/channels/ChannelRuntimeService'

import { agentText } from './agentText'
import { buildSessionChannelRuntimeBadgeBySessionId } from './agentChannelRuntimeViewModel'

const t = agentText['en-US'].sessionItem.channelRuntime

describe('agentChannelRuntimeViewModel', () => {
  it('builds session-bound channel runtime badges with diagnostic tooltip lines', () => {
    const badges = buildSessionChannelRuntimeBadgeBySessionId(
      {
        channels: [
          {
            channelId: 'channel-1',
            type: 'telegram',
            agentId: 'agent-1',
            sessionId: 'session-1',
            isActive: true,
            activeChatCount: 1,
            runtimeState: 'connecting',
            runtimeMessage: 'Waiting for QR scan',
            runtimeLifecycleState: 'awaiting-qr-scan',
            credentialState: 'required',
            credentialHint: 'Open Telegram and scan the code.',
            credentialQrText: 'otpauth://telegram',
            credentialExpiresAt: 1_725_000_000_000,
            sessionState: 'reconnecting',
            runtimeRetryable: true,
            lastCheckedAt: 1_725_000_001_000,
            updatedAt: 1_725_000_001_500
          }
        ]
      } satisfies AgentChannelRuntimeSnapshot,
      t
    )

    expect(badges).toEqual({
      'session-1': {
        channelId: 'channel-1',
        channelType: 'telegram',
        tone: 'connecting',
        label: 'Connecting',
        tooltipLines: [
          'Channel status: Connecting',
          'Lifecycle: Awaiting QR scan',
          'Credential: Required',
          'Session: Reconnecting',
          'Hint: Open Telegram and scan the code.',
          'Message: Waiting for QR scan',
          'Retry: Retryable',
          'QR text: otpauth://telegram',
          'Expires at 2024-08-30T06:40:00.000Z',
          'Last checked 2024-08-30T06:40:01.000Z'
        ]
      }
    })
  })

  it('prefers the highest-priority active runtime entry for the same session', () => {
    const badges = buildSessionChannelRuntimeBadgeBySessionId(
      {
        channels: [
          {
            channelId: 'channel-connected',
            type: 'telegram',
            agentId: 'agent-1',
            sessionId: 'session-1',
            isActive: true,
            activeChatCount: 1,
            runtimeState: 'connected',
            updatedAt: 100
          },
          {
            channelId: 'channel-error',
            type: 'slack',
            agentId: 'agent-1',
            sessionId: 'session-1',
            isActive: true,
            activeChatCount: 1,
            runtimeState: 'error',
            runtimeMessage: 'Token expired',
            updatedAt: 90
          }
        ]
      } satisfies AgentChannelRuntimeSnapshot,
      t
    )

    expect(badges['session-1']).toEqual({
      channelId: 'channel-error',
      channelType: 'slack',
      tone: 'error',
      label: 'Error',
      tooltipLines: ['Channel status: Error', 'Message: Token expired']
    })
  })

  it('ignores inactive and unbound channels', () => {
    const badges = buildSessionChannelRuntimeBadgeBySessionId(
      {
        channels: [
          {
            channelId: 'channel-inactive',
            type: 'telegram',
            agentId: 'agent-1',
            sessionId: 'session-1',
            isActive: false,
            activeChatCount: 0,
            runtimeState: 'inactive',
            updatedAt: 100
          },
          {
            channelId: 'channel-unbound',
            type: 'slack',
            agentId: 'agent-1',
            sessionId: null,
            isActive: true,
            activeChatCount: 1,
            runtimeState: 'connected',
            updatedAt: 101
          }
        ]
      } satisfies AgentChannelRuntimeSnapshot,
      t
    )

    expect(badges).toEqual({})
  })
})
