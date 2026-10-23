import type {
  AgentChannelRuntimeHost,
  AgentChannelRuntimeHostContext,
  AgentChannelRuntimeStatusUpdate
} from '../../../../ai/agent-platform/channels/channelRuntimeHost'
import type { DiscordAgentChannelEntity } from '../../../../ai/agent-platform/schemas/channelSchemas'
import { createAllowedChatGuard } from '../shared/createAllowedChatGuard'
import { createRuntimeStatusBus } from '../shared/createRuntimeStatusBus'
import { isSlashCommand } from '../shared/isSlashCommand'
import { splitChannelMessage } from '../shared/splitChannelMessage'

const DISCORD_API_BASE = 'https://discord.com/api/v10'
const DISCORD_MAX_LENGTH = 2000
const USER_AGENT = 'DiscordBot (https://ai-desktop.local, 1.0.0)'

export type DiscordIncomingMessage = {
  chatId: string
  channelId: string
  userId: string
  userName?: string
  text: string
  isBot?: boolean
}

export type DiscordGatewayClient = {
  connect: (onMessage: (message: DiscordIncomingMessage) => void | Promise<void>) => Promise<void>
  close: () => Promise<void>
  sendText: (chatId: string, text: string) => Promise<void>
  sendTyping?: (chatId: string) => Promise<void>
  editText?: (chatId: string, messageId: string, text: string) => Promise<void>
}

export type CreateDiscordChannelHostDependencies = {
  createClient?: (input: { botToken: string; fetchImpl?: typeof fetch }) => DiscordGatewayClient
  fetchImpl?: typeof fetch
}

export async function createDiscordChannelHost(
  channel: DiscordAgentChannelEntity,
  context: AgentChannelRuntimeHostContext,
  deps: CreateDiscordChannelHostDependencies = {}
): Promise<AgentChannelRuntimeHost> {
  const statusBus = createRuntimeStatusBus()
  const allowedIds = channel.activeChatIds?.length ? channel.activeChatIds : channel.config.allowed_channel_ids
  const allowedChatGuard = createAllowedChatGuard(allowedIds)
  const createClient =
    deps.createClient ??
    ((input) => createDefaultDiscordClient({ ...input, fetchImpl: input.fetchImpl ?? deps.fetchImpl }))

  const client = createClient({
    botToken: channel.config.bot_token,
    fetchImpl: deps.fetchImpl
  })
  const streamingMessageIds = new Map<string, string>()

  const handleMessage = async (message: DiscordIncomingMessage): Promise<void> => {
    if (message.isBot) return
    if (!allowedChatGuard.isAllowed(message.chatId) && !allowedChatGuard.isAllowed(message.channelId)) return

    const text = message.text.replace(/<@!?\d+>/g, '').trim()
    if (!text) return
    const commandText = isSlashCommand(text) ? (text.split(/\s+/, 1)[0] ?? text) : text

    await context.handleIncomingText?.({
      agentId: channel.agentId ?? '',
      channelId: channel.id,
      channelType: 'discord',
      chatId: message.chatId,
      userId: message.userId,
      userName: message.userName,
      text: commandText
    })
  }

  return {
    connect: async () => {
      publishStatus(statusBus, {
        runtimeState: 'connecting',
        lifecycleState: 'connecting',
        message: 'Connecting Discord bot'
      })
      try {
        await client.connect(handleMessage)
        publishStatus(statusBus, {
          runtimeState: 'connected',
          lifecycleState: 'ready',
          message: 'Discord bot connected'
        })
      } catch (error) {
        publishStatus(statusBus, {
          runtimeState: 'error',
          lifecycleState: 'terminal-error',
          errorKind: 'auth',
          retryable: false,
          message: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
    },
    close: async () => {
      await client.close()
      streamingMessageIds.clear()
      publishStatus(statusBus, {
        runtimeState: null,
        lifecycleState: 'terminal-error',
        message: 'Discord bot stopped'
      })
    },
    subscribeToRuntimeStatus: (listener) => statusBus.subscribe(listener),
    sendMessage: async (chatId, text) => {
      for (const chunk of splitChannelMessage(text, DISCORD_MAX_LENGTH)) {
        await client.sendText(chatId, chunk)
      }
    },
    sendTypingIndicator: async (chatId) => {
      await client.sendTyping?.(chatId)
    },
    onTextUpdate: async (chatId, text) => {
      const content = text.length > DISCORD_MAX_LENGTH ? `${text.slice(0, DISCORD_MAX_LENGTH - 3)}...` : text
      const existing = streamingMessageIds.get(chatId)
      if (existing && client.editText) {
        await client.editText(chatId, existing, content || '...')
        return
      }
      await client.sendText(chatId, content || '...')
    }
  }
}

function createDefaultDiscordClient(input: { botToken: string; fetchImpl?: typeof fetch }): DiscordGatewayClient {
  const resolveFetch = async (): Promise<typeof fetch> => {
    if (input.fetchImpl) return input.fetchImpl
    const { getPlatformFetch } = await import('../../../../network/platformFetch')
    return getPlatformFetch()
  }

  function resolveChannelId(chatId: string): string {
    return chatId.includes(':') ? (chatId.split(':')[1] ?? chatId) : chatId
  }

  return {
    async connect() {
      const fetchFn = await resolveFetch()
      const response = await fetchFn(`${DISCORD_API_BASE}/gateway/bot`, {
        headers: {
          Authorization: `Bot ${input.botToken}`,
          'User-Agent': USER_AGENT
        }
      })
      if (!response.ok) {
        throw new Error(`Discord gateway lookup failed: HTTP ${response.status}`)
      }
      // Live gateway WS requires injectable createClient for CI.
    },
    async close() {
      // no-op default
    },
    async sendText(chatId, text) {
      const channelId = resolveChannelId(chatId)
      const fetchFn = await resolveFetch()
      const response = await fetchFn(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${input.botToken}`,
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT
        },
        body: JSON.stringify({ content: text })
      })
      if (!response.ok) throw new Error(`Discord send failed: HTTP ${response.status}`)
    },
    async sendTyping(chatId) {
      const channelId = resolveChannelId(chatId)
      const fetchFn = await resolveFetch()
      await fetchFn(`${DISCORD_API_BASE}/channels/${channelId}/typing`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${input.botToken}`,
          'User-Agent': USER_AGENT
        }
      })
    }
  }
}

function publishStatus(
  statusBus: ReturnType<typeof createRuntimeStatusBus>,
  status: AgentChannelRuntimeStatusUpdate
): void {
  statusBus.publish({
    ...status,
    lastCheckedAt: Date.now()
  })
}
