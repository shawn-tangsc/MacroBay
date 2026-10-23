import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentChannelIncomingTextEvent } from '../../../../ai/agent-platform/channels/channelRuntimeHost'
import type { DiscordAgentChannelEntity } from '../../../../ai/agent-platform/schemas/channelSchemas'
import {
  createDiscordChannelHost,
  type DiscordGatewayClient,
  type DiscordIncomingMessage
} from './createDiscordChannelHost'

describe('createDiscordChannelHost', () => {
  let onMessage: ((message: DiscordIncomingMessage) => void | Promise<void>) | null = null
  let client: DiscordGatewayClient

  beforeEach(() => {
    onMessage = null
    client = {
      connect: vi.fn(async (handler) => {
        onMessage = handler
      }),
      close: vi.fn().mockResolvedValue(undefined),
      sendText: vi.fn().mockResolvedValue(undefined),
      sendTyping: vi.fn().mockResolvedValue(undefined),
      editText: vi.fn().mockResolvedValue(undefined)
    }
  })

  it('connects, forwards allowed text, and supports send/typing', async () => {
    const received: AgentChannelIncomingTextEvent[] = []
    const statuses: Array<string | null | undefined> = []
    const host = await createDiscordChannelHost(
      createChannel({ activeChatIds: ['channel:c1'] }),
      {
        handleIncomingText: async (input) => {
          received.push(input)
        }
      },
      { createClient: () => client }
    )
    host.subscribeToRuntimeStatus?.((status) => statuses.push(status.lifecycleState))

    await host.connect()
    await onMessage?.({
      chatId: 'channel:c1',
      channelId: 'c1',
      userId: 'u1',
      userName: 'Ada',
      text: 'hello <@123>'
    })
    await onMessage?.({
      chatId: 'channel:c1',
      channelId: 'c1',
      userId: 'bot',
      text: 'ignored',
      isBot: true
    })
    await onMessage?.({
      chatId: 'channel:blocked',
      channelId: 'blocked',
      userId: 'u2',
      text: 'nope'
    })
    await onMessage?.({
      chatId: 'channel:c1',
      channelId: 'c1',
      userId: 'u1',
      text: '/whoami'
    })
    await host.sendMessage?.('channel:c1', 'reply')
    await host.sendTypingIndicator?.('channel:c1')
    await host.close()

    expect(statuses).toContain('ready')
    expect(received).toEqual([
      {
        agentId: 'agent-1',
        channelId: 'discord-1',
        channelType: 'discord',
        chatId: 'channel:c1',
        userId: 'u1',
        userName: 'Ada',
        text: 'hello'
      },
      {
        agentId: 'agent-1',
        channelId: 'discord-1',
        channelType: 'discord',
        chatId: 'channel:c1',
        userId: 'u1',
        text: '/whoami'
      }
    ])
    expect(client.sendText).toHaveBeenCalledWith('channel:c1', 'reply')
    expect(client.sendTyping).toHaveBeenCalledWith('channel:c1')
  })
})

function createChannel(overrides: Partial<DiscordAgentChannelEntity> = {}): DiscordAgentChannelEntity {
  return {
    id: 'discord-1',
    type: 'discord',
    name: 'Discord',
    agentId: 'agent-1',
    sessionId: null,
    workspace: { type: 'system' },
    config: {
      bot_token: 'discord-token',
      allowed_channel_ids: ['channel:c1']
    },
    isActive: true,
    activeChatIds: ['channel:c1'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}
