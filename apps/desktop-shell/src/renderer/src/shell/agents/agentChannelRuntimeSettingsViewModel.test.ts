import { describe, expect, it } from 'vitest'

import type { AgentChannelRuntimeSnapshot } from '@platform/ai/agent-platform/channels/ChannelRuntimeService'
import type { AgentChannelEntity } from '@platform/ai/agent-platform/schemas/channelSchemas'

import { agentText } from './agentText'
import { buildSessionChannelRuntimeSettingCards } from './agentChannelRuntimeSettingsViewModel'

const runtimeText = agentText['en-US'].sessionItem.channelRuntime
const settingsText = agentText['en-US'].settingsDrawer.channelRuntime

function createChannel(overrides: Partial<AgentChannelEntity> = {}): AgentChannelEntity {
  return {
    id: 'channel-1',
    type: 'telegram',
    name: 'Telegram Ops',
    agentId: 'agent-1',
    sessionId: 'session-1',
    workspace: { type: 'system' },
    config: { bot_token: 'token' },
    isActive: true,
    activeChatIds: ['chat-1'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  } as AgentChannelEntity
}

describe('agentChannelRuntimeSettingsViewModel', () => {
  it('builds settings cards for session-bound channels with rich diagnostics', () => {
    const cards = buildSessionChannelRuntimeSettingCards({
      sessionId: 'session-1',
      channels: [createChannel()],
      snapshot: {
        channels: [
          {
            channelId: 'channel-1',
            type: 'telegram',
            agentId: 'agent-1',
            sessionId: 'session-1',
            isActive: true,
            activeChatCount: 2,
            runtimeState: 'error',
            runtimeLifecycleState: 'session-expired',
            credentialState: 'expired',
            sessionState: 'expired',
            runtimeMessage: 'Session expired. Scan again.',
            credentialHint: 'Open Telegram and rescan.',
            credentialUrl: 'https://example.com/reauth',
            credentialQrText: 'otpauth://telegram/refresh',
            credentialExpiresAt: 1_735_689_600_000,
            lastCheckedAt: 1_735_689_601_000,
            updatedAt: 1_735_689_602_000
          }
        ]
      } satisfies AgentChannelRuntimeSnapshot,
      runtimeText,
      settingsText
    })

    expect(cards).toEqual([
      {
        channelId: 'channel-1',
        channelName: 'Telegram Ops',
        channelType: 'telegram',
        runtimeTone: 'error',
        runtimeLabel: 'Error',
        lifecycleLabel: 'Session expired',
        credentialLabel: 'Expired',
        sessionLabel: 'Expired',
        runtimeMessage: 'Session expired. Scan again.',
        credentialHint: 'Open Telegram and rescan.',
        credentialUrl: 'https://example.com/reauth',
        credentialQrText: 'otpauth://telegram/refresh',
        activeChatsLabel: '2 active chats',
        updatedAtLabel: 'Updated 2025-01-01T00:00:02.000Z',
        expiresAtLabel: 'Expires at 2025-01-01T00:00:00.000Z',
        lastCheckedAtLabel: 'Last checked 2025-01-01T00:00:01.000Z'
      }
    ])
  })

  it('sorts higher-priority runtime states ahead of healthy channels', () => {
    const cards = buildSessionChannelRuntimeSettingCards({
      sessionId: 'session-1',
      channels: [
        createChannel({ id: 'channel-connected', name: 'Connected channel' }),
        createChannel({ id: 'channel-connecting', name: 'Connecting channel' }),
        createChannel({ id: 'channel-error', name: 'Error channel' })
      ],
      snapshot: {
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
            channelId: 'channel-connecting',
            type: 'telegram',
            agentId: 'agent-1',
            sessionId: 'session-1',
            isActive: true,
            activeChatCount: 1,
            runtimeState: 'connecting',
            updatedAt: 200
          },
          {
            channelId: 'channel-error',
            type: 'telegram',
            agentId: 'agent-1',
            sessionId: 'session-1',
            isActive: true,
            activeChatCount: 1,
            runtimeState: 'error',
            updatedAt: 300
          }
        ]
      } satisfies AgentChannelRuntimeSnapshot,
      runtimeText,
      settingsText
    })

    expect(cards.map((card) => card.channelId)).toEqual([
      'channel-error',
      'channel-connecting',
      'channel-connected'
    ])
  })

  it('sorts equal-priority channels by raw update time instead of formatted label text', () => {
    const cards = buildSessionChannelRuntimeSettingCards({
      sessionId: 'session-1',
      channels: [
        createChannel({ id: 'channel-older', name: 'Older channel' }),
        createChannel({ id: 'channel-newer', name: 'Newer channel' })
      ],
      snapshot: {
        channels: [
          {
            channelId: 'channel-older',
            type: 'telegram',
            agentId: 'agent-1',
            sessionId: 'session-1',
            isActive: true,
            activeChatCount: 1,
            runtimeState: 'connected',
            updatedAt: Date.parse('2026-02-01T00:00:00.000Z')
          },
          {
            channelId: 'channel-newer',
            type: 'telegram',
            agentId: 'agent-1',
            sessionId: 'session-1',
            isActive: true,
            activeChatCount: 1,
            runtimeState: 'connected',
            updatedAt: Date.parse('2026-12-01T00:00:00.000Z')
          }
        ]
      } satisfies AgentChannelRuntimeSnapshot,
      runtimeText,
      settingsText
    })

    expect(cards.map((card) => card.channelId)).toEqual([
      'channel-newer',
      'channel-older'
    ])
  })

  it('falls back to inactive runtime state when a bound channel has no runtime snapshot entry', () => {
    const cards = buildSessionChannelRuntimeSettingCards({
      sessionId: 'session-1',
      channels: [createChannel({ isActive: false, activeChatIds: [], updatedAt: '2026-01-02T00:00:00.000Z' })],
      snapshot: { channels: [] },
      runtimeText,
      settingsText
    })

    expect(cards).toEqual([
      {
        channelId: 'channel-1',
        channelName: 'Telegram Ops',
        channelType: 'telegram',
        runtimeTone: 'inactive',
        runtimeLabel: 'Inactive',
        activeChatsLabel: '0 active chats',
        updatedAtLabel: 'Updated 2026-01-02T00:00:00.000Z'
      }
    ])
  })
})
