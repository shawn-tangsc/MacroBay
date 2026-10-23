import type {
  AgentChannelRuntimeHost,
  AgentChannelRuntimeHostContext,
  AgentChannelRuntimeStatusUpdate
} from '../../../../ai/agent-platform/channels/channelRuntimeHost'
import type { QQAgentChannelEntity } from '../../../../ai/agent-platform/schemas/channelSchemas'
import { createAllowedChatGuard } from '../shared/createAllowedChatGuard'
import { createRuntimeStatusBus } from '../shared/createRuntimeStatusBus'
import { isSlashCommand } from '../shared/isSlashCommand'
import { splitChannelMessage } from '../shared/splitChannelMessage'

const QQ_MAX_LENGTH = 2000
const QQ_API_BASE = 'https://api.sgroup.qq.com'

export type QqIncomingMessage = {
  chatId: string
  userId: string
  userName?: string
  text: string
}

export type QqGatewayClient = {
  connect: (onMessage: (message: QqIncomingMessage) => void | Promise<void>) => Promise<void>
  close: () => Promise<void>
  sendText: (chatId: string, text: string) => Promise<void>
  sendTyping?: (chatId: string) => Promise<void>
}

export type CreateQqChannelHostDependencies = {
  createClient?: (input: {
    appId: string
    clientSecret: string
    fetchImpl?: typeof fetch
  }) => QqGatewayClient
  fetchImpl?: typeof fetch
}

export async function createQqChannelHost(
  channel: QQAgentChannelEntity,
  context: AgentChannelRuntimeHostContext,
  deps: CreateQqChannelHostDependencies = {}
): Promise<AgentChannelRuntimeHost> {
  const statusBus = createRuntimeStatusBus()
  const allowedIds = channel.activeChatIds?.length ? channel.activeChatIds : channel.config.allowed_chat_ids
  const allowedChatGuard = createAllowedChatGuard(allowedIds)
  const createClient =
    deps.createClient ??
    ((input) => createDefaultQqClient({ ...input, fetchImpl: input.fetchImpl ?? deps.fetchImpl }))

  const client = createClient({
    appId: channel.config.app_id,
    clientSecret: channel.config.client_secret,
    fetchImpl: deps.fetchImpl
  })

  const handleMessage = async (message: QqIncomingMessage): Promise<void> => {
    const rawId = message.chatId.includes(':') ? message.chatId.split(':')[1] : message.chatId
    if (!allowedChatGuard.isAllowed(message.chatId) && !allowedChatGuard.isAllowed(rawId)) return

    const text = message.text.replace(/<@!\d+>/g, '').trim()
    if (!text) return
    const commandText = isSlashCommand(text) ? (text.split(/\s+/, 1)[0] ?? text) : text

    await context.handleIncomingText?.({
      agentId: channel.agentId ?? '',
      channelId: channel.id,
      channelType: 'qq',
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
        message: 'Connecting QQ bot'
      })
      try {
        await client.connect(handleMessage)
        publishStatus(statusBus, {
          runtimeState: 'connected',
          lifecycleState: 'ready',
          message: 'QQ bot connected'
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
      publishStatus(statusBus, {
        runtimeState: null,
        lifecycleState: 'terminal-error',
        message: 'QQ bot stopped'
      })
    },
    subscribeToRuntimeStatus: (listener) => statusBus.subscribe(listener),
    sendMessage: async (chatId, text) => {
      for (const chunk of splitChannelMessage(text, QQ_MAX_LENGTH)) {
        await client.sendText(chatId, chunk)
      }
    },
    sendTypingIndicator: async (chatId) => {
      await client.sendTyping?.(chatId)
    }
  }
}

function createDefaultQqClient(input: {
  appId: string
  clientSecret: string
  fetchImpl?: typeof fetch
}): QqGatewayClient {
  const resolveFetch = async (): Promise<typeof fetch> => {
    if (input.fetchImpl) return input.fetchImpl
    const { getPlatformFetch } = await import('../../../../network/platformFetch')
    return getPlatformFetch()
  }
  let accessToken: string | null = null

  async function ensureToken(): Promise<string> {
    if (accessToken) return accessToken
    const fetchFn = await resolveFetch()
    const response = await fetchFn('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: input.appId, clientSecret: input.clientSecret })
    })
    if (!response.ok) throw new Error(`QQ token failed: HTTP ${response.status}`)
    const data = (await response.json()) as { access_token?: string }
    if (!data.access_token) throw new Error('QQ token response missing access_token')
    accessToken = data.access_token
    return accessToken
  }

  return {
    async connect() {
      await ensureToken()
      // Live gateway WS requires injectable createClient for CI; production can inject platform WS.
    },
    async close() {
      accessToken = null
    },
    async sendText(chatId, text) {
      const token = await ensureToken()
      const fetchFn = await resolveFetch()
      const [type, id] = chatId.split(':')
      const endpoint =
        type === 'c2c'
          ? `${QQ_API_BASE}/v2/users/${id}/messages`
          : type === 'group'
            ? `${QQ_API_BASE}/v2/groups/${id}/messages`
            : type === 'dm'
              ? `${QQ_API_BASE}/dms/${id}/messages`
              : `${QQ_API_BASE}/channels/${id}/messages`

      const response = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `QQBot ${token}`,
          'Content-Type': 'application/json',
          'X-Union-Appid': input.appId
        },
        body: JSON.stringify({ markdown: { content: text }, msg_type: 2 })
      })
      if (!response.ok) throw new Error(`QQ send failed: HTTP ${response.status}`)
    },
    async sendTyping() {
      // QQ typing is best-effort and endpoint-specific; injectable clients may implement it.
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
