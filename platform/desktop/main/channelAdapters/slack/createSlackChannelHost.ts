import type {
  AgentChannelRuntimeHost,
  AgentChannelRuntimeHostContext,
  AgentChannelRuntimeStatusUpdate
} from '../../../../ai/agent-platform/channels/channelRuntimeHost'
import type { SlackAgentChannelEntity } from '../../../../ai/agent-platform/schemas/channelSchemas'
import { createAllowedChatGuard } from '../shared/createAllowedChatGuard'
import { createRuntimeStatusBus } from '../shared/createRuntimeStatusBus'
import { splitChannelMessage } from '../shared/splitChannelMessage'
import { handleSlackMessageEvent, handleSlackSlashCommand, type SlackSocketEnvelope } from './slackEventHandlers'
import { toSlackMarkdown } from './slackMarkdown'

export type { SlackSocketEnvelope }

const SLACK_API_BASE = 'https://slack.com/api'
const SLACK_MAX_LENGTH = 4000

export type SlackWebSocketLike = {
  send: (data: string) => void
  close: () => void
  onOpen?: (handler: () => void) => void
  onMessage?: (handler: (data: string) => void) => void
  onClose?: (handler: () => void) => void
  onError?: (handler: (error: unknown) => void) => void
}

export type SlackApiClient = {
  request: (method: string, body?: Record<string, unknown>) => Promise<Record<string, unknown>>
  openSocket: () => Promise<SlackWebSocketLike>
}

export type CreateSlackChannelHostDependencies = {
  createApiClient?: (input: { botToken: string; appToken: string; fetchImpl?: typeof fetch }) => SlackApiClient
  fetchImpl?: typeof fetch
}

export async function createSlackChannelHost(
  channel: SlackAgentChannelEntity,
  context: AgentChannelRuntimeHostContext,
  deps: CreateSlackChannelHostDependencies = {}
): Promise<AgentChannelRuntimeHost> {
  const statusBus = createRuntimeStatusBus()
  const allowedIds = channel.activeChatIds?.length ? channel.activeChatIds : channel.config.allowed_channel_ids
  const allowedChatGuard = createAllowedChatGuard(allowedIds)
  const createApiClient =
    deps.createApiClient ??
    ((input) => createDefaultSlackApiClient(input.botToken, input.appToken, input.fetchImpl ?? deps.fetchImpl))
  const api = createApiClient({
    botToken: channel.config.bot_token,
    appToken: channel.config.app_token,
    fetchImpl: deps.fetchImpl
  })

  let socket: SlackWebSocketLike | null = null
  let botUserId: string | null = null
  const streamingMessageTs = new Map<string, string>()

  const handleEnvelope = async (raw: string): Promise<void> => {
    let envelope: SlackSocketEnvelope
    try {
      envelope = JSON.parse(raw) as SlackSocketEnvelope
    } catch {
      return
    }

    if (envelope.envelope_id) {
      socket?.send(JSON.stringify({ envelope_id: envelope.envelope_id }))
    }

    if (envelope.type === 'hello') {
      publishStatus(statusBus, {
        runtimeState: 'connected',
        lifecycleState: 'ready',
        message: 'Slack Socket Mode connected'
      })
      return
    }

    if (envelope.type === 'disconnect') {
      publishStatus(statusBus, {
        runtimeState: 'connecting',
        lifecycleState: 'reconnecting',
        message: 'Slack requested disconnect'
      })
      socket?.close()
      return
    }

    if (envelope.type === 'slash_commands' && envelope.payload) {
      await handleSlackSlashCommand(channel, context, allowedChatGuard, envelope.payload)
      return
    }

    if (envelope.type === 'events_api' && envelope.payload?.event) {
      await handleSlackMessageEvent(channel, context, allowedChatGuard, envelope.payload.event, botUserId)
    }
  }

  return {
    connect: async () => {
      publishStatus(statusBus, {
        runtimeState: 'connecting',
        lifecycleState: 'connecting',
        message: 'Connecting Slack Socket Mode'
      })
      try {
        const auth = await api.request('auth.test', {})
        botUserId = typeof auth.user_id === 'string' ? auth.user_id : null
        socket = await api.openSocket()
        socket.onMessage?.((data) => {
          void handleEnvelope(data)
        })
        socket.onError?.((error) => {
          publishStatus(statusBus, {
            runtimeState: 'error',
            lifecycleState: 'terminal-error',
            errorKind: 'transient',
            retryable: true,
            message: error instanceof Error ? error.message : String(error)
          })
        })
        socket.onClose?.(() => {
          publishStatus(statusBus, {
            runtimeState: null,
            lifecycleState: 'reconnecting',
            message: 'Slack socket closed'
          })
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
      socket?.close()
      socket = null
      streamingMessageTs.clear()
      publishStatus(statusBus, {
        runtimeState: null,
        lifecycleState: 'terminal-error',
        message: 'Slack bot stopped'
      })
    },
    subscribeToRuntimeStatus: (listener) => statusBus.subscribe(listener),
    sendMessage: async (chatId, text) => {
      const mrkdwn = toSlackMarkdown(text)
      for (const chunk of splitChannelMessage(mrkdwn, SLACK_MAX_LENGTH)) {
        await api.request('chat.postMessage', { channel: chatId, text: chunk })
      }
    },
    sendTypingIndicator: async () => {
      // Slack bots have no public typing API; acknowledgment is handled elsewhere.
    },
    onTextUpdate: async (chatId, text) => {
      const existingTs = streamingMessageTs.get(chatId)
      const content =
        text.length > SLACK_MAX_LENGTH
          ? `${toSlackMarkdown(text).slice(0, SLACK_MAX_LENGTH - 3)}...`
          : toSlackMarkdown(text)
      if (existingTs) {
        await api.request('chat.update', { channel: chatId, ts: existingTs, text: content || '...' })
        return
      }
      const posted = await api.request('chat.postMessage', { channel: chatId, text: content || '...' })
      if (typeof posted.ts === 'string') streamingMessageTs.set(chatId, posted.ts)
    }
  }
}

function createDefaultSlackApiClient(botToken: string, appToken: string, fetchImpl?: typeof fetch): SlackApiClient {
  const resolveFetch = async (): Promise<typeof fetch> => {
    if (fetchImpl) return fetchImpl
    const { getPlatformFetch } = await import('../../../../network/platformFetch')
    return getPlatformFetch()
  }

  return {
    async request(method, body = {}) {
      const fetchFn = await resolveFetch()
      const response = await fetchFn(`${SLACK_API_BASE}/${method}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify(body)
      })
      if (!response.ok) {
        throw new Error(`Slack API ${method} failed: HTTP ${response.status}`)
      }
      const data = (await response.json()) as { ok?: boolean; error?: string } & Record<string, unknown>
      if (!data.ok) {
        throw new Error(`Slack API ${method} failed: ${data.error ?? 'unknown error'}`)
      }
      return data
    },
    async openSocket() {
      const fetchFn = await resolveFetch()
      const response = await fetchFn(`${SLACK_API_BASE}/apps.connections.open`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${appToken}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      })
      if (!response.ok) {
        throw new Error(`Slack Socket Mode open failed: HTTP ${response.status}`)
      }
      const data = (await response.json()) as { ok?: boolean; url?: string; error?: string }
      if (!data.ok || !data.url) {
        throw new Error(`Slack Socket Mode open failed: ${data.error ?? 'no URL'}`)
      }

      throw new Error(`Slack Socket Mode URL acquired (${data.url}) but no WebSocket factory was injected`)
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
