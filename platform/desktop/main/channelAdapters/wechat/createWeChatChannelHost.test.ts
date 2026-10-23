import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentChannelIncomingTextEvent } from '../../../../ai/agent-platform/channels/channelRuntimeHost'
import type { WeChatAgentChannelEntity } from '../../../../ai/agent-platform/schemas/channelSchemas'
import { createWeChatChannelHost } from './createWeChatChannelHost'
import { createInjectableWeChatProtocol } from './WeChatProtocol'

describe('createWeChatChannelHost', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('publishes QR credential status then becomes ready', async () => {
    const statuses: Array<{ lifecycleState?: string | null; credentialUrl?: string | null }> = []
    let protocol: ReturnType<typeof createInjectableWeChatProtocol> | null = null

    const host = await createWeChatChannelHost(
      createChannel(),
      {},
      {
        createProtocol: (input) => {
          protocol = createInjectableWeChatProtocol({
            tokenPath: input.tokenPath,
            initialCredentials: null,
            onQrUrl: input.onQrUrl,
            onError: input.onError
          })
          return protocol
        }
      }
    )
    host.subscribeToRuntimeStatus?.((status) => {
      statuses.push({
        lifecycleState: status.lifecycleState,
        credentialUrl: status.credentialUrl
      })
    })

    await host.connect()
    await host.close()

    expect(protocol).not.toBeNull()
    expect(statuses.some((item) => item.lifecycleState === 'awaiting-qr-scan' && item.credentialUrl)).toBe(true)
    expect(statuses.some((item) => item.lifecycleState === 'ready')).toBe(true)
  })

  it('forwards allowed inbound text and supports send/typing', async () => {
    const received: AgentChannelIncomingTextEvent[] = []
    let protocol: ReturnType<typeof createInjectableWeChatProtocol> | null = null

    const host = await createWeChatChannelHost(
      createChannel({ activeChatIds: ['user-1'] }),
      {
        handleIncomingText: async (input) => {
          received.push(input)
        }
      },
      {
        createProtocol: (input) => {
          protocol = createInjectableWeChatProtocol({
            tokenPath: input.tokenPath,
            initialCredentials: {
              token: 'token',
              baseUrl: 'https://ilinkai.weixin.qq.com',
              accountId: 'bot',
              userId: 'wx-bot'
            },
            onQrUrl: input.onQrUrl,
            onError: input.onError
          })
          return protocol
        }
      }
    )

    await host.connect()
    expect(protocol).not.toBeNull()
    await protocol!.deliver({ userId: 'user-1', text: 'hello', contextToken: 'ctx' })
    await protocol!.deliver({ userId: 'blocked', text: 'nope', contextToken: 'ctx' })
    await protocol!.deliver({ userId: 'user-1', text: '/new', contextToken: 'ctx' })
    await host.sendMessage?.('user-1', 'reply')
    await host.sendTypingIndicator?.('user-1')
    await host.close()

    expect(received).toEqual([
      {
        agentId: 'agent-1',
        channelId: 'wechat-1',
        channelType: 'wechat',
        chatId: 'user-1',
        userId: 'user-1',
        userName: 'user-1',
        text: 'hello'
      },
      {
        agentId: 'agent-1',
        channelId: 'wechat-1',
        channelType: 'wechat',
        chatId: 'user-1',
        userId: 'user-1',
        userName: 'user-1',
        text: '/new'
      }
    ])
  })
})

describe('WeChatProtocol', () => {
  it('exposes injectable QR login and message delivery seams', async () => {
    const qrUrls: string[] = []
    const protocol = createInjectableWeChatProtocol({
      tokenPath: '/tmp/wechat-protocol.json',
      initialCredentials: null,
      onQrUrl: (url) => qrUrls.push(url)
    })

    expect(await protocol.hasCredentials()).toBe(false)
    const credentials = await protocol.login()
    expect(credentials.userId).toBe('wx-user')
    expect(qrUrls.length).toBeGreaterThan(0)
  })
})

function createChannel(overrides: Partial<WeChatAgentChannelEntity> = {}): WeChatAgentChannelEntity {
  return {
    id: 'wechat-1',
    type: 'wechat',
    name: 'WeChat',
    agentId: 'agent-1',
    sessionId: null,
    workspace: { type: 'system' },
    config: {
      token_path: '/tmp/wechat-1.json',
      allowed_chat_ids: ['user-1']
    },
    isActive: true,
    activeChatIds: ['user-1'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}
