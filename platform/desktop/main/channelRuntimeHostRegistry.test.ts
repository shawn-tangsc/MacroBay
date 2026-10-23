import { describe, expect, it, vi } from 'vitest'

import type { AgentChannelEntity } from '../../ai/agent-platform/schemas/channelSchemas'
import type { AgentChannelRuntimeHost } from '../../ai/agent-platform/channels/channelRuntimeHost'
import { ChannelRuntimeHostRegistry } from './channelRuntimeHostRegistry'

function createChannel(overrides: Partial<AgentChannelEntity> = {}): AgentChannelEntity {
  return {
    id: 'channel-1',
    type: 'telegram',
    name: 'Telegram',
    agentId: 'agent-1',
    sessionId: 'session-1',
    workspace: { type: 'system' },
    config: { bot_token: 'token' },
    isActive: true,
    activeChatIds: ['chat-1'],
    permissionMode: 'default',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  } as AgentChannelEntity
}

describe('ChannelRuntimeHostRegistry', () => {
  it('dispatches to the registered factory for the channel type with a cloned channel payload', async () => {
    const registry = new ChannelRuntimeHostRegistry()
    const host: AgentChannelRuntimeHost = {
      connect: vi.fn(async () => {}),
      close: vi.fn(async () => {})
    }
    const factory = vi.fn(async (channel: AgentChannelEntity) => {
      channel.name = 'Mutated in factory'
      return host
    })
    const handleIncomingText = vi.fn(async () => {})
    const channel = createChannel()

    registry.register('telegram', factory)

    await expect(
      registry.createHost(channel, {
        handleIncomingText
      })
    ).resolves.toBe(host)

    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'channel-1',
        type: 'telegram'
      }),
      expect.objectContaining({
        handleIncomingText
      })
    )
    expect(channel.name).toBe('Telegram')
  })

  it('rejects duplicate registrations for the same channel type', () => {
    const registry = new ChannelRuntimeHostRegistry()
    const factory = vi.fn(async () => ({
      connect: async () => undefined,
      close: async () => undefined
    }))

    registry.register('telegram', factory)

    expect(() => registry.register('telegram', factory)).toThrow(
      'Channel adapter factory is already registered for type "telegram".'
    )
  })

  it('throws a clear adapter-missing error when no runtime host factory is registered', async () => {
    const registry = new ChannelRuntimeHostRegistry()

    await expect(registry.createHost(createChannel({ type: 'slack', config: { bot_token: 'bot', app_token: 'app' } }))).rejects.toThrow(
      'Channel adapter factory is not registered for type "slack".'
    )
  })
})
