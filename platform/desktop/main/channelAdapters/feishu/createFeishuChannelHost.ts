import type {
  AgentChannelRuntimeHost,
  AgentChannelRuntimeHostContext,
  AgentChannelRuntimeStatusUpdate
} from '../../../../ai/agent-platform/channels/channelRuntimeHost'
import type { FeishuAgentChannelEntity, FeishuDomain } from '../../../../ai/agent-platform/schemas/channelSchemas'
import { createAllowedChatGuard } from '../shared/createAllowedChatGuard'
import { createRuntimeStatusBus } from '../shared/createRuntimeStatusBus'
import { isSlashCommand } from '../shared/isSlashCommand'
import { splitChannelMessage } from '../shared/splitChannelMessage'

const FEISHU_MAX_LENGTH = 4000

const DOMAIN_BASE: Record<FeishuDomain, string> = {
  feishu: 'https://open.feishu.cn',
  lark: 'https://open.larksuite.com'
}

export type FeishuMessageEvent = {
  sender?: {
    sender_id?: { open_id?: string; user_id?: string }
  }
  message?: {
    message_id?: string
    chat_id?: string
    message_type?: string
    content?: string
  }
}

export type FeishuClient = {
  connect: (onMessage: (event: FeishuMessageEvent) => void | Promise<void>) => Promise<void>
  close: () => Promise<void>
  sendText: (chatId: string, text: string) => Promise<void>
  sendTyping?: (chatId: string) => Promise<void>
}

export type CreateFeishuChannelHostDependencies = {
  createClient?: (input: {
    appId: string
    appSecret: string
    encryptKey: string
    verificationToken: string
    domain: FeishuDomain
    fetchImpl?: typeof fetch
  }) => FeishuClient
  fetchImpl?: typeof fetch
}

export async function createFeishuChannelHost(
  channel: FeishuAgentChannelEntity,
  context: AgentChannelRuntimeHostContext,
  deps: CreateFeishuChannelHostDependencies = {}
): Promise<AgentChannelRuntimeHost> {
  const statusBus = createRuntimeStatusBus()
  const allowedIds = channel.activeChatIds?.length ? channel.activeChatIds : channel.config.allowed_chat_ids
  const allowedChatGuard = createAllowedChatGuard(allowedIds)
  const createClient =
    deps.createClient ??
    ((input) =>
      createDefaultFeishuClient({
        ...input,
        fetchImpl: input.fetchImpl ?? deps.fetchImpl
      }))

  const client = createClient({
    appId: channel.config.app_id,
    appSecret: channel.config.app_secret,
    encryptKey: channel.config.encrypt_key,
    verificationToken: channel.config.verification_token,
    domain: channel.config.domain,
    fetchImpl: deps.fetchImpl
  })

  const handleEvent = async (event: FeishuMessageEvent): Promise<void> => {
    const chatId = String(event.message?.chat_id ?? '').trim()
    if (!chatId || !allowedChatGuard.isAllowed(chatId)) return
    if (event.message?.message_type && event.message.message_type !== 'text') return

    let text = ''
    try {
      const parsed = JSON.parse(event.message?.content ?? '{}') as { text?: string }
      text = (parsed.text ?? '').replace(/@_user_\d+/g, '').trim()
    } catch {
      return
    }
    if (!text) return

    const userId = event.sender?.sender_id?.open_id ?? event.sender?.sender_id?.user_id
    const commandText = isSlashCommand(text) ? (text.split(/\s+/, 1)[0] ?? text) : text

    await context.handleIncomingText?.({
      agentId: channel.agentId ?? '',
      channelId: channel.id,
      channelType: 'feishu',
      chatId,
      userId,
      text: commandText
    })
  }

  return {
    connect: async () => {
      publishStatus(statusBus, {
        runtimeState: 'connecting',
        lifecycleState: 'connecting',
        message: 'Connecting Feishu bot'
      })
      try {
        await client.connect(handleEvent)
        publishStatus(statusBus, {
          runtimeState: 'connected',
          lifecycleState: 'ready',
          message: 'Feishu bot connected'
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
        message: 'Feishu bot stopped'
      })
    },
    subscribeToRuntimeStatus: (listener) => statusBus.subscribe(listener),
    sendMessage: async (chatId, text) => {
      for (const chunk of splitChannelMessage(text, FEISHU_MAX_LENGTH)) {
        await client.sendText(chatId, chunk)
      }
    },
    sendTypingIndicator: async (chatId) => {
      await client.sendTyping?.(chatId)
    }
  }
}

function createDefaultFeishuClient(input: {
  appId: string
  appSecret: string
  encryptKey: string
  verificationToken: string
  domain: FeishuDomain
  fetchImpl?: typeof fetch
}): FeishuClient {
  const resolveFetch = async (): Promise<typeof fetch> => {
    if (input.fetchImpl) return input.fetchImpl
    const { getPlatformFetch } = await import('../../../../network/platformFetch')
    return getPlatformFetch()
  }
  const baseUrl = DOMAIN_BASE[input.domain]
  let tenantAccessToken: string | null = null

  async function ensureToken(): Promise<string> {
    if (tenantAccessToken) return tenantAccessToken
    const fetchFn = await resolveFetch()
    const response = await fetchFn(`${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: input.appId, app_secret: input.appSecret })
    })
    if (!response.ok) {
      throw new Error(`Feishu auth failed: HTTP ${response.status}`)
    }
    const data = (await response.json()) as { code?: number; tenant_access_token?: string; msg?: string }
    if (data.code !== 0 || !data.tenant_access_token) {
      throw new Error(`Feishu auth failed: ${data.msg ?? 'missing token'}`)
    }
    tenantAccessToken = data.tenant_access_token
    return tenantAccessToken
  }

  return {
    async connect() {
      await ensureToken()
      // Live WS/event long-connection requires Lark SDK; inject createClient in production wiring/tests.
    },
    async close() {
      tenantAccessToken = null
    },
    async sendText(chatId, text) {
      const token = await ensureToken()
      const fetchFn = await resolveFetch()
      const response = await fetchFn(`${baseUrl}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: 'post',
          content: JSON.stringify({
            zh_cn: {
              content: [[{ tag: 'md', text }]]
            }
          })
        })
      })
      if (!response.ok) {
        throw new Error(`Feishu send failed: HTTP ${response.status}`)
      }
    },
    async sendTyping() {
      // Feishu has no public typing API; reactions are optional and require message ids.
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
