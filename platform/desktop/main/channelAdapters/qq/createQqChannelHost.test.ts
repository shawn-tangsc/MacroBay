import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentChannelIncomingTextEvent } from '../../../../ai/agent-platform/channels/channelRuntimeHost'
import type { QQAgentChannelEntity } from '../../../../ai/agent-platform/schemas/channelSchemas'
import { createQqChannelHost, type QqGatewayClient, type QqIncomingMessage } from './createQqChannelHost'

describe('createQqChannelHost', () => {
  let onMessage: ((message: QqIncomingMessage) => void | Promise<void>) | null = null
  let client: QqGatewayClient

  beforeEach(() => {
    onMessage = null
    client = {
      connect: vi.fn(async (handler) => {
        onMessage = handler
      }),
      close: vi.fn().mockResolvedValue(undefined),
      sendText: vi.fn().mockResolvedValue(undefined),
      sendTyping: vi.fn().mockResolvedValue(undefined)
    }
  })

  it('forwards group/C2C messages and supports send/typing', async () => {
    const received: AgentChannelIncomingTextEvent[] = []
    const host = await createQqChannelHost(
      createChannel({ activeChatIds: ['group:g1', 'c2c:u1'] }),
      {
        handleIncomingText: async (input) => {
          received.push(input)
        }
      },
      { createClient: () => client }
    )

    await host.connect()
    await onMessage?.({ chatId: 'group:g1', userId: 'm1', userName: 'Ada', text: 'hello <@!123>' })
    await onMessage?.({ chatId: 'c2c:u1', userId: 'u1', text: '/compact' })
    await onMessage?.({ chatId: 'group:blocked', userId: 'x', text: 'nope' })
    await host.sendMessage?.('group:g1', 'reply')
    await host.sendTypingIndicator?.('group:g1')
    await host.close()

    expect(received).toEqual([
      {
        agentId: 'agent-1',
        channelId: 'qq-1',
        channelType: 'qq',
        chatId: 'group:g1',
        userId: 'm1',
        userName: 'Ada',
        text: 'hello'
      },
      {
        agentId: 'agent-1',
        channelId: 'qq-1',
        channelType: 'qq',
        chatId: 'c2c:u1',
        userId: 'u1',
        text: '/compact'
      }
    ])
    expect(client.sendText).toHaveBeenCalledWith('group:g1', 'reply')
    expect(client.sendTyping).toHaveBeenCalledWith('group:g1')
  })
})

function createChannel(overrides: Partial<QQAgentChannelEntity> = {}): QQAgentChannelEntity {
  return {
    id: 'qq-1',
    type: 'qq',
    name: 'QQ',
    agentId: 'agent-1',
    sessionId: null,
    workspace: { type: 'system' },
    config: {
      app_id: 'app',
      client_secret: 'secret',
      allowed_chat_ids: ['group:g1']
    },
    isActive: true,
    activeChatIds: ['group:g1'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}
