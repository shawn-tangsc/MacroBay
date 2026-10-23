import { describe, expect, it } from 'vitest'

import { getAgentChannelTypeIconName, getAgentChannelTypeIconUrl, getSessionChannelTypeBySessionId } from './agentChannelVisuals'

describe('agentChannelVisuals', () => {
  it('maps channel types to stable icon names', () => {
    expect(getAgentChannelTypeIconName('telegram')).toBe('telegram')
    expect(getAgentChannelTypeIconName('discord')).toBe('discord')
    expect(getAgentChannelTypeIconName('slack')).toBe('slack')
  })

  it('returns undefined for unsupported channel types', () => {
    expect(getAgentChannelTypeIconName(undefined)).toBeUndefined()
    expect(getAgentChannelTypeIconName('unknown')).toBeUndefined()
  })

  it('resolves channel types to bundled icon asset urls', () => {
    expect(getAgentChannelTypeIconUrl('telegram')).toContain('telegram.png')
    expect(getAgentChannelTypeIconUrl('feishu')).toContain('feishu.jpeg')
    expect(getAgentChannelTypeIconUrl('qq')).toContain('qq.svg')
    expect(getAgentChannelTypeIconUrl('unknown')).toBeUndefined()
  })

  it('builds a session->channelType index from active session-bound channels only', () => {
    expect(
      getSessionChannelTypeBySessionId([
        {
          id: 'channel-1',
          type: 'telegram',
          name: 'Telegram',
          sessionId: 'session-1',
          workspace: { type: 'system' },
          config: { bot_token: 'token' },
          isActive: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'channel-2',
          type: 'discord',
          name: 'Discord',
          sessionId: 'session-2',
          workspace: { type: 'system' },
          config: { bot_token: 'token' },
          isActive: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'channel-3',
          type: 'slack',
          name: 'Slack',
          workspace: { type: 'system' },
          config: { bot_token: 'token', app_token: 'app-token' },
          isActive: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ])
    ).toEqual({ 'session-1': 'telegram' })
  })
})
