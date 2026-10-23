import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentChannelIncomingTextEvent } from '../../../../ai/agent-platform/channels/channelRuntimeHost'
import type { SlackAgentChannelEntity } from '../../../../ai/agent-platform/schemas/channelSchemas'
import { createSlackChannelHost, type SlackApiClient, type SlackWebSocketLike } from './createSlackChannelHost'

describe('createSlackChannelHost', () => {
  let messageHandler: ((data: string) => void) | null = null
  let socket: SlackWebSocketLike
  let api: SlackApiClient

  beforeEach(() => {
    messageHandler = null
    socket = {
      send: vi.fn(),
      close: vi.fn(),
      onMessage: (handler) => {
        messageHandler = handler
      },
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn()
    }
    api = {
      request: vi.fn().mockImplementation(async (method: string) => {
        if (method === 'auth.test') return { ok: true, user_id: 'UBOT' }
        if (method === 'chat.postMessage') return { ok: true, ts: '1.1' }
        if (method === 'chat.update') return { ok: true }
        return { ok: true }
      }),
      openSocket: vi.fn().mockResolvedValue(socket)
    }
  })

  it('connects via injected Socket Mode client and publishes ready status', async () => {
    const statuses: Array<string | null | undefined> = []
    const host = await createSlackChannelHost(createChannel(), {}, { createApiClient: () => api })
    host.subscribeToRuntimeStatus?.((status) => statuses.push(status.lifecycleState))

    await host.connect()
    messageHandler?.(JSON.stringify({ envelope_id: 'hello-1', type: 'hello' }))

    expect(api.openSocket).toHaveBeenCalledTimes(1)
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ envelope_id: 'hello-1' }))
    expect(statuses).toContain('ready')
  })

  it('forwards allowed channel text and slash commands', async () => {
    const received: AgentChannelIncomingTextEvent[] = []
    const host = await createSlackChannelHost(
      createChannel({ activeChatIds: ['C1'] }),
      {
        handleIncomingText: async (input) => {
          received.push(input)
        }
      },
      { createApiClient: () => api }
    )

    await host.connect()
    messageHandler?.(
      JSON.stringify({
        envelope_id: 'msg-1',
        type: 'events_api',
        payload: {
          event: { type: 'message', channel: 'C1', user: 'U1', text: 'hello <@UBOT>' }
        }
      })
    )
    messageHandler?.(
      JSON.stringify({
        envelope_id: 'cmd-1',
        type: 'slash_commands',
        payload: { command: '/new', channel_id: 'C1', user_id: 'U1', user_name: 'Ada' }
      })
    )

    expect(received).toEqual([
      {
        agentId: 'agent-1',
        channelId: 'slack-1',
        channelType: 'slack',
        chatId: 'C1',
        userId: 'U1',
        text: 'hello'
      },
      {
        agentId: 'agent-1',
        channelId: 'slack-1',
        channelType: 'slack',
        chatId: 'C1',
        userId: 'U1',
        userName: 'Ada',
        text: '/new'
      }
    ])
  })

  it('blocks unauthorized channels', async () => {
    const received: AgentChannelIncomingTextEvent[] = []
    const host = await createSlackChannelHost(
      createChannel({ activeChatIds: ['C1'] }),
      {
        handleIncomingText: async (input) => {
          received.push(input)
        }
      },
      { createApiClient: () => api }
    )

    await host.connect()
    messageHandler?.(
      JSON.stringify({
        type: 'events_api',
        payload: { event: { type: 'message', channel: 'C999', user: 'U1', text: 'nope' } }
      })
    )

    expect(received).toEqual([])
  })

  it('sends Slack mrkdwn and updates streaming messages in place', async () => {
    const host = await createSlackChannelHost(createChannel(), {}, { createApiClient: () => api })
    await host.connect()

    await host.sendMessage?.('C1', 'Hello **world**')
    await host.onTextUpdate?.('C1', 'partial')
    await host.onTextUpdate?.('C1', 'partial more')

    expect(api.request).toHaveBeenCalledWith('chat.postMessage', {
      channel: 'C1',
      text: 'Hello *world*'
    })
    expect(api.request).toHaveBeenCalledWith('chat.postMessage', {
      channel: 'C1',
      text: 'partial'
    })
    expect(api.request).toHaveBeenCalledWith('chat.update', {
      channel: 'C1',
      ts: '1.1',
      text: 'partial more'
    })
  })
})

function createChannel(overrides: Partial<SlackAgentChannelEntity> = {}): SlackAgentChannelEntity {
  return {
    id: 'slack-1',
    type: 'slack',
    name: 'Slack',
    agentId: 'agent-1',
    sessionId: null,
    workspace: { type: 'system' },
    config: {
      bot_token: 'xoxb-test',
      app_token: 'xapp-test',
      allowed_channel_ids: ['C1']
    },
    isActive: true,
    activeChatIds: ['C1'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}
