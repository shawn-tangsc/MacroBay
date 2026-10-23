import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import type { TelegramAgentChannelEntity } from '../../../../ai/agent-platform/schemas/channelSchemas'
import type { AgentChannelIncomingTextEvent } from '../../../../ai/agent-platform/channels/channelRuntimeHost'
import { createTelegramChannelHost, type TelegramBotLike } from './createTelegramChannelHost'

type MockTelegramBot = {
  use: Mock
  command: Mock
  on: Mock
  catch: Mock
  start: Mock
  stop: Mock
  api: {
    setMyCommands: Mock
    sendMessage: Mock
    editMessageText: Mock
    sendMessageDraft?: Mock
    sendChatAction: Mock
    getFile: Mock
  }
}

const mockBot: MockTelegramBot = {
  use: vi.fn(),
  command: vi.fn(),
  on: vi.fn(),
  catch: vi.fn(),
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  api: {
    setMyCommands: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 10 }),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    sendMessageDraft: vi.fn().mockResolvedValue(undefined),
    sendChatAction: vi.fn().mockResolvedValue(undefined),
    getFile: vi.fn().mockResolvedValue({ file_path: 'photos/file.jpg' })
  }
}

vi.mock('grammy', () => ({
  Bot: vi.fn(function Bot() {
    return mockBot
  })
}))

vi.mock('telegram-markdown-v2', () => ({
  convert: (text: string) => text.replaceAll('.', '\\.')
}))

describe('createTelegramChannelHost', () => {
  beforeEach(() => {
    mockBot.use.mockClear()
    mockBot.command.mockClear()
    mockBot.on.mockClear()
    mockBot.catch.mockClear()
    mockBot.start.mockClear().mockResolvedValue(undefined)
    mockBot.stop.mockClear().mockResolvedValue(undefined)
    mockBot.api.setMyCommands.mockClear().mockResolvedValue(undefined)
    mockBot.api.sendMessage.mockClear().mockResolvedValue({ message_id: 10 })
    mockBot.api.editMessageText.mockClear().mockResolvedValue(undefined)
    mockBot.api.sendMessageDraft?.mockClear().mockResolvedValue(undefined)
    mockBot.api.sendChatAction.mockClear().mockResolvedValue(undefined)
    mockBot.api.getFile.mockClear().mockResolvedValue({ file_path: 'photos/file.jpg' })
  })

  it('registers Telegram commands and starts long polling', async () => {
    const host = await createTelegramChannelHost(createChannel(), {})

    await host.connect()

    expect(mockBot.use).toHaveBeenCalledTimes(1)
    expect(mockBot.command.mock.calls.map(([command]) => command)).toEqual(['new', 'compact', 'help', 'whoami'])
    expect(mockBot.on).toHaveBeenCalledWith('message:text', expect.any(Function))
    expect(mockBot.on).toHaveBeenCalledWith('message:photo', expect.any(Function))
    expect(mockBot.on).toHaveBeenCalledWith('message:document', expect.any(Function))
    expect(mockBot.api.setMyCommands).toHaveBeenCalledWith([
      { command: 'new', description: 'Start a new conversation' },
      { command: 'compact', description: 'Compact conversation history' },
      { command: 'help', description: 'Show help information' },
      { command: 'whoami', description: 'Show the current chat ID' }
    ])
    expect(mockBot.start).toHaveBeenCalledTimes(1)
  })

  it('forwards incoming text into the platform channel runtime context', async () => {
    const received: AgentChannelIncomingTextEvent[] = []
    const channel = createChannel({ activeChatIds: ['123'] })
    const host = await createTelegramChannelHost(channel, {
      handleIncomingText: async (input) => {
        received.push(input)
      }
    })

    await host.connect()
    const handler = mockBot.on.mock.calls.find(([event]) => event === 'message:text')?.[1] as (ctx: unknown) => void
    await handler({
      chat: { id: 123 },
      from: { id: 456, first_name: 'Ada' },
      message: { text: 'Hello bot' }
    })

    expect(received).toEqual([
      {
        agentId: 'agent-1',
        channelId: 'telegram-1',
        channelType: 'telegram',
        chatId: '123',
        userId: '456',
        userName: 'Ada',
        text: 'Hello bot'
      }
    ])
  })

  it('downloads photo attachments as base64 and forwards them', async () => {
    const received: AgentChannelIncomingTextEvent[] = []
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) => (name === 'content-type' ? 'image/jpeg' : null)
      },
      arrayBuffer: async () => Buffer.from('image-bytes')
    })

    const host = await createTelegramChannelHost(
      createChannel({ activeChatIds: ['123'] }),
      {
        handleIncomingText: async (input) => {
          received.push(input)
        }
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    )

    await host.connect()
    const handler = mockBot.on.mock.calls.find(([event]) => event === 'message:photo')?.[1] as (
      ctx: unknown
    ) => Promise<void>
    await handler({
      chat: { id: 123 },
      from: { id: 456, first_name: 'Ada' },
      message: {
        caption: 'look',
        photo: [{ file_id: 'small' }, { file_id: 'large' }]
      }
    })

    expect(mockBot.api.getFile).toHaveBeenCalledWith('large')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.telegram.org/file/bottest-token/photos/file.jpg',
      expect.any(Object)
    )
    expect(received[0]?.attachments).toEqual([
      {
        kind: 'image',
        name: 'photo.jpg',
        mimeType: 'image/jpeg',
        data: Buffer.from('image-bytes').toString('base64')
      }
    ])
    expect(received[0]?.text).toBe('look')
  })

  it('uses sendMessageDraft for onTextUpdate when available', async () => {
    const host = await createTelegramChannelHost(createChannel(), {})
    await host.connect()
    await host.onTextUpdate?.('123', 'streaming...')

    expect(mockBot.api.sendMessageDraft).toHaveBeenCalledWith(123, 0, 'streaming...')
  })

  it('falls back to editMessageText when draft API is unavailable', async () => {
    const botWithoutDraft = {
      ...mockBot,
      api: {
        ...mockBot.api,
        sendMessageDraft: undefined,
        sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
        editMessageText: vi.fn().mockResolvedValue(undefined)
      }
    } as unknown as TelegramBotLike

    const host = await createTelegramChannelHost(createChannel(), {}, { createBot: () => botWithoutDraft })
    await host.connect()
    await host.sendMessage?.('123', 'seed')
    await host.onTextUpdate?.('123', 'updated')

    expect(botWithoutDraft.api.editMessageText).toHaveBeenCalledWith('123', 42, 'updated', {})
  })

  it('publishes runtime status on connect and error', async () => {
    const statuses: Array<string | null | undefined> = []
    const host = await createTelegramChannelHost(createChannel(), {})
    host.subscribeToRuntimeStatus?.((status) => statuses.push(status.lifecycleState))

    await host.connect()
    const catchHandler = mockBot.catch.mock.calls[0]?.[0] as (error: unknown) => void
    catchHandler(new Error('boom'))

    expect(statuses).toContain('ready')
    expect(statuses).toContain('terminal-error')
  })

  it('forwards Telegram commands into the platform channel command seam', async () => {
    const received: AgentChannelIncomingTextEvent[] = []
    const host = await createTelegramChannelHost(createChannel({ activeChatIds: ['123'] }), {
      handleIncomingText: async (input) => {
        received.push(input)
      }
    })

    await host.connect()
    const commandHandler = mockBot.command.mock.calls.find(([command]) => command === 'new')?.[1] as (
      ctx: unknown
    ) => void
    await commandHandler({
      chat: { id: 123 },
      from: { id: 456, first_name: 'Ada' }
    })

    expect(received).toEqual([
      {
        agentId: 'agent-1',
        channelId: 'telegram-1',
        channelType: 'telegram',
        chatId: '123',
        userId: '456',
        userName: 'Ada',
        text: '/new'
      }
    ])
  })

  it('blocks unauthorized chats before they reach command or message handlers', async () => {
    const host = await createTelegramChannelHost(createChannel({ activeChatIds: ['123'] }), {})

    await host.connect()
    const middleware = mockBot.use.mock.calls[0]?.[0] as (
      ctx: { chat?: { id?: number | string } },
      next: () => Promise<void>
    ) => Promise<void>
    const next = vi.fn()

    await middleware({ chat: { id: 999 } }, next)
    expect(next).not.toHaveBeenCalled()

    await middleware({ chat: { id: 123 } }, next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('sends MarkdownV2 text and falls back to plain chunks when formatting fails', async () => {
    const host = await createTelegramChannelHost(createChannel(), {})
    await host.connect()
    mockBot.api.sendMessage.mockRejectedValueOnce(new Error("Bad Request: can't parse"))

    await host.sendMessage?.('123', 'Price is 10.5')

    expect(mockBot.api.sendMessage).toHaveBeenNthCalledWith(1, '123', 'Price is 10\\.5', {
      parse_mode: 'MarkdownV2'
    })
    expect(mockBot.api.sendMessage).toHaveBeenNthCalledWith(2, '123', 'Price is 10.5', {})
  })
})

function createChannel(overrides: Partial<TelegramAgentChannelEntity> = {}): TelegramAgentChannelEntity {
  return {
    id: 'telegram-1',
    type: 'telegram',
    name: 'Telegram',
    agentId: 'agent-1',
    sessionId: null,
    workspace: { type: 'system' },
    config: {
      bot_token: 'test-token',
      allowed_chat_ids: ['123']
    },
    isActive: true,
    activeChatIds: ['123'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}
