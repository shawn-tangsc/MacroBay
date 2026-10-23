import type {
  AgentChannelRuntimeHost,
  AgentChannelRuntimeHostContext,
  AgentChannelRuntimeStatusUpdate
} from '../../../../ai/agent-platform/channels/channelRuntimeHost'
import type { WeChatAgentChannelEntity } from '../../../../ai/agent-platform/schemas/channelSchemas'
import { createAllowedChatGuard } from '../shared/createAllowedChatGuard'
import { createRuntimeStatusBus } from '../shared/createRuntimeStatusBus'
import { isSlashCommand } from '../shared/isSlashCommand'
import { splitChannelMessage } from '../shared/splitChannelMessage'
import { createWeChatProtocol, type WeChatProtocol } from './WeChatProtocol'

const WECHAT_MAX_LENGTH = 2000

export type CreateWeChatChannelHostDependencies = {
  createProtocol?: (input: {
    tokenPath: string
    onQrUrl: (url: string) => void
    onError: (error: unknown) => void
  }) => WeChatProtocol
}

export async function createWeChatChannelHost(
  channel: WeChatAgentChannelEntity,
  context: AgentChannelRuntimeHostContext,
  deps: CreateWeChatChannelHostDependencies = {}
): Promise<AgentChannelRuntimeHost> {
  const statusBus = createRuntimeStatusBus()
  const allowedIds = channel.activeChatIds?.length ? channel.activeChatIds : channel.config.allowed_chat_ids
  const allowedChatGuard = createAllowedChatGuard(allowedIds)
  const createProtocol =
    deps.createProtocol ??
    ((input) =>
      createWeChatProtocol({
        tokenPath: input.tokenPath,
        onQrUrl: input.onQrUrl,
        onError: input.onError
      }))

  let protocol: WeChatProtocol | null = null
  let runPromise: Promise<void> | null = null

  return {
    connect: async () => {
      publishStatus(statusBus, {
        runtimeState: 'connecting',
        lifecycleState: 'connecting',
        message: 'Connecting WeChat bot'
      })

      protocol = createProtocol({
        tokenPath: channel.config.token_path,
        onQrUrl: (url) => {
          publishStatus(statusBus, {
            runtimeState: 'connecting',
            lifecycleState: 'awaiting-qr-scan',
            credentialState: 'required',
            credentialUrl: url,
            credentialQrText: url,
            message: 'Scan WeChat QR to continue'
          })
        },
        onError: (error) => {
          publishStatus(statusBus, {
            runtimeState: 'error',
            lifecycleState: 'terminal-error',
            errorKind: 'transient',
            retryable: true,
            message: error instanceof Error ? error.message : String(error)
          })
        }
      })

      try {
        const hasCredentials = await protocol.hasCredentials()
        if (!hasCredentials) {
          publishStatus(statusBus, {
            runtimeState: 'connecting',
            lifecycleState: 'awaiting-credential',
            credentialState: 'required',
            message: 'WeChat credentials required'
          })
        }

        const credentials = await protocol.login()
        protocol.onMessage(async (message) => {
          if (!allowedChatGuard.isAllowed(message.userId)) return
          const text = message.text.trim()
          if (!text) return
          const commandText = isSlashCommand(text) ? (text.split(/\s+/, 1)[0] ?? text) : text
          await context.handleIncomingText?.({
            agentId: channel.agentId ?? '',
            channelId: channel.id,
            channelType: 'wechat',
            chatId: message.userId,
            userId: message.userId,
            userName: message.userId,
            text: commandText
          })
        })

        publishStatus(statusBus, {
          runtimeState: 'connected',
          lifecycleState: 'ready',
          credentialState: 'captured',
          sessionState: 'active',
          message: `WeChat bot ready (${credentials.userId})`
        })

        runPromise = protocol.run().catch((error) => {
          publishStatus(statusBus, {
            runtimeState: 'error',
            lifecycleState: 'terminal-error',
            errorKind: 'transient',
            retryable: true,
            message: error instanceof Error ? error.message : String(error)
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
      protocol?.stop()
      protocol = null
      if (runPromise) {
        await Promise.race([runPromise, new Promise((resolve) => setTimeout(resolve, 50))])
        runPromise = null
      }
      publishStatus(statusBus, {
        runtimeState: null,
        lifecycleState: 'terminal-error',
        message: 'WeChat bot stopped'
      })
    },
    subscribeToRuntimeStatus: (listener) => statusBus.subscribe(listener),
    sendMessage: async (chatId, text) => {
      if (!protocol) throw new Error('WeChat bot is not connected')
      for (const chunk of splitChannelMessage(text, WECHAT_MAX_LENGTH)) {
        await protocol.send(chatId, chunk)
      }
    },
    sendTypingIndicator: async (chatId) => {
      if (!protocol) return
      try {
        await protocol.sendTyping(chatId)
      } catch {
        // Typing requires a prior context token.
      }
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
