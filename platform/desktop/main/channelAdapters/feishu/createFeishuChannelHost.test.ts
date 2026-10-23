import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentChannelIncomingTextEvent } from '../../../../ai/agent-platform/channels/channelRuntimeHost'
import type { FeishuAgentChannelEntity } from '../../../../ai/agent-platform/schemas/channelSchemas'
import { createFeishuChannelHost, type FeishuClient, type FeishuMessageEvent } from './createFeishuChannelHost'

describe('createFeishuChannelHost', () => {
  let onMessage: ((event: FeishuMessageEvent) => void | Promise<void>) | null = null
  let client: FeishuClient

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

  it('connects, forwards allowed text, and sends messages', async () => {
    const received: AgentChannelIncomingTextEvent[] = []
    const statuses: Array<string | null | undefined> = []
    const host = await createFeishuChannelHost(
      createChannel(),
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
      sender: { sender_id: { open_id: 'ou_1' } },
      message: {
        chat_id: 'oc_1',
        message_type: 'text',
        content: JSON.stringify({ text: 'hello @_user_1' })
      }
    })
    await onMessage?.({
      sender: { sender_id: { open_id: 'ou_1' } },
      message: {
        chat_id: 'oc_1',
        message_type: 'text',
        content: JSON.stringify({ text: '/help please' })
      }
    })
    await host.sendMessage?.('oc_1', 'reply')
    await host.sendTypingIndicator?.('oc_1')
    await host.close()

    expect(statuses).toContain('ready')
    expect(received).toEqual([
      {
        agentId: 'agent-1',
        channelId: 'feishu-1',
        channelType: 'feishu',
        chatId: 'oc_1',
        userId: 'ou_1',
        text: 'hello'
      },
      {
        agentId: 'agent-1',
        channelId: 'feishu-1',
        channelType: 'feishu',
        chatId: 'oc_1',
        userId: 'ou_1',
        text: '/help'
      }
    ])
    expect(client.sendText).toHaveBeenCalledWith('oc_1', 'reply')
    expect(client.sendTyping).toHaveBeenCalledWith('oc_1')
    expect(client.close).toHaveBeenCalledTimes(1)
  })

  it('drops unauthorized chats', async () => {
    const received: AgentChannelIncomingTextEvent[] = []
    const host = await createFeishuChannelHost(
      createChannel({ activeChatIds: ['oc_1'] }),
      {
        handleIncomingText: async (input) => {
          received.push(input)
        }
      },
      { createClient: () => client }
    )

    await host.connect()
    await onMessage?.({
      message: {
        chat_id: 'oc_blocked',
        message_type: 'text',
        content: JSON.stringify({ text: 'nope' })
      }
    })

    expect(received).toEqual([])
  })
})

function createChannel(overrides: Partial<FeishuAgentChannelEntity> = {}): FeishuAgentChannelEntity {
  return {
    id: 'feishu-1',
    type: 'feishu',
    name: 'Feishu',
    agentId: 'agent-1',
    sessionId: null,
    workspace: { type: 'system' },
    config: {
      app_id: 'app',
      app_secret: 'secret',
      encrypt_key: 'enc',
      verification_token: 'verify',
      domain: 'feishu',
      allowed_chat_ids: ['oc_1']
    },
    isActive: true,
    activeChatIds: ['oc_1'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}
