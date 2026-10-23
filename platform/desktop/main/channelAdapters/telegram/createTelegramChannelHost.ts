import { Bot } from 'grammy'
import { convert } from 'telegram-markdown-v2'

import type {
  AgentChannelIncomingAttachment,
  AgentChannelRuntimeHost,
  AgentChannelRuntimeHostContext,
  AgentChannelRuntimeStatusUpdate
} from '../../../../ai/agent-platform/channels/channelRuntimeHost'
import type { TelegramAgentChannelEntity } from '../../../../ai/agent-platform/schemas/channelSchemas'
import { downloadUrlAsBase64, MAX_CHANNEL_ATTACHMENT_BYTES } from '../shared/downloadAsBase64'
import { createAllowedChatGuard } from '../shared/createAllowedChatGuard'
import { createRuntimeStatusBus } from '../shared/createRuntimeStatusBus'
import { splitChannelMessage } from '../shared/splitChannelMessage'

type TelegramPhotoSize = { file_id: string; file_size?: number }
type TelegramDocument = {
  file_id: string
  file_name?: string
  mime_type?: string
  file_size?: number
}

type TelegramChatContext = {
  chat?: { id?: number | string }
  from?: { id?: number | string; first_name?: string; username?: string }
  message?: {
    text?: string
    caption?: string
    photo?: TelegramPhotoSize[]
    document?: TelegramDocument
  }
}

export type TelegramBotApi = {
  setMyCommands: (commands: Array<{ command: string; description: string }>) => Promise<void>
  sendMessage: (
    chatId: string | number,
    text: string,
    options?: Record<string, unknown>
  ) => Promise<{ message_id?: number }>
  editMessageText: (
    chatId: string | number,
    messageId: number,
    text: string,
    options?: Record<string, unknown>
  ) => Promise<unknown>
  sendMessageDraft?: (chatId: number, draftId: number, text: string) => Promise<unknown>
  sendChatAction: (chatId: string | number, action: 'typing') => Promise<void>
  getFile: (fileId: string) => Promise<{ file_path?: string }>
}

export type TelegramBotLike = {
  use: (handler: (ctx: TelegramChatContext, next: () => Promise<void>) => Promise<void>) => void
  command: (command: string, handler: (ctx: TelegramChatContext) => void | Promise<void>) => void
  on: (event: string, handler: (ctx: TelegramChatContext) => void | Promise<void>) => void
  catch: (handler: (error: unknown) => void) => void
  start: () => Promise<void>
  stop: () => Promise<void>
  api: TelegramBotApi
}

export type CreateTelegramChannelHostDependencies = {
  createBot?: (token: string) => TelegramBotLike
  fetchImpl?: typeof fetch
}

const TELEGRAM_MESSAGE_MAX_LENGTH = 4096
const TELEGRAM_COMMANDS = [
  { command: 'new', description: 'Start a new conversation' },
  { command: 'compact', description: 'Compact conversation history' },
  { command: 'help', description: 'Show help information' },
  { command: 'whoami', description: 'Show the current chat ID' }
] as const

export async function createTelegramChannelHost(
  channel: TelegramAgentChannelEntity,
  context: AgentChannelRuntimeHostContext,
  deps: CreateTelegramChannelHostDependencies = {}
): Promise<AgentChannelRuntimeHost> {
  const createBot = deps.createBot ?? ((token: string) => new Bot(token) as unknown as TelegramBotLike)
  const fetchImpl = deps.fetchImpl
  const bot = createBot(channel.config.bot_token)
  const statusBus = createRuntimeStatusBus()
  const lastMessageIds = new Map<string, number>()
  const allowedChatIds = channel.activeChatIds?.length ? channel.activeChatIds : channel.config.allowed_chat_ids
  const allowedChatGuard = createAllowedChatGuard(allowedChatIds)

  bot.use(async (ctx, next) => {
    if (!allowedChatGuard.isAllowed(ctx.chat?.id)) return
    await next()
  })

  for (const command of TELEGRAM_COMMANDS) {
    bot.command(command.command, async (ctx) => {
      await forwardTelegramTextEvent(channel, context, ctx, `/${command.command}`)
    })
  }

  bot.on('message:text', async (ctx) => {
    const text = ctx.message?.text?.trim() ?? ''
    if (!text) return
    await forwardTelegramTextEvent(channel, context, ctx, text)
  })

  bot.on('message:photo', async (ctx) => {
    const photos = ctx.message?.photo ?? []
    if (!photos.length) return
    const largest = photos[photos.length - 1]
    const attachment = await downloadTelegramFile(bot, channel.config.bot_token, largest.file_id, {
      kind: 'image',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      fetchImpl
    })
    const text = ctx.message?.caption?.trim() ?? ''
    if (!text && !attachment) return
    await forwardTelegramTextEvent(channel, context, ctx, text, attachment ? [attachment] : undefined)
  })

  bot.on('message:document', async (ctx) => {
    const doc = ctx.message?.document
    if (!doc) return
    if (doc.file_size && doc.file_size > MAX_CHANNEL_ATTACHMENT_BYTES) return
    const attachment = await downloadTelegramFile(bot, channel.config.bot_token, doc.file_id, {
      kind: 'file',
      name: doc.file_name ?? 'document',
      mimeType: doc.mime_type ?? 'application/octet-stream',
      fetchImpl
    })
    const text = ctx.message?.caption?.trim() ?? ''
    if (!text && !attachment) return
    await forwardTelegramTextEvent(channel, context, ctx, text, attachment ? [attachment] : undefined)
  })

  bot.catch((error) => {
    publishStatus(statusBus, {
      runtimeState: 'error',
      lifecycleState: 'terminal-error',
      errorKind: 'transient',
      retryable: true,
      message: error instanceof Error ? error.message : String(error)
    })
  })

  return {
    connect: async () => {
      publishStatus(statusBus, {
        runtimeState: 'connecting',
        lifecycleState: 'connecting',
        message: 'Connecting Telegram bot'
      })
      try {
        await bot.api.setMyCommands([...TELEGRAM_COMMANDS])
        await bot.start()
        publishStatus(statusBus, {
          runtimeState: 'connected',
          lifecycleState: 'ready',
          message: 'Telegram bot connected'
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
      await bot.stop()
      publishStatus(statusBus, {
        runtimeState: null,
        lifecycleState: 'terminal-error',
        message: 'Telegram bot stopped'
      })
    },
    subscribeToRuntimeStatus: (listener) => statusBus.subscribe(listener),
    sendMessage: async (chatId, text) => {
      for (const chunk of splitChannelMessage(text, TELEGRAM_MESSAGE_MAX_LENGTH)) {
        try {
          const sent = await bot.api.sendMessage(chatId, convert(chunk), { parse_mode: 'MarkdownV2' })
          if (sent?.message_id != null) lastMessageIds.set(chatId, sent.message_id)
        } catch {
          const sent = await bot.api.sendMessage(chatId, chunk, {})
          if (sent?.message_id != null) lastMessageIds.set(chatId, sent.message_id)
        }
      }
    },
    sendTypingIndicator: async (chatId) => {
      await bot.api.sendChatAction(chatId, 'typing')
    },
    onTextUpdate: async (chatId, text) => {
      if (typeof bot.api.sendMessageDraft === 'function') {
        try {
          await bot.api.sendMessageDraft(Number(chatId), 0, text)
          return
        } catch {
          // Fall through to edit/send.
        }
      }

      const messageId = lastMessageIds.get(chatId)
      const truncated = text.length > TELEGRAM_MESSAGE_MAX_LENGTH ? `${text.slice(0, TELEGRAM_MESSAGE_MAX_LENGTH - 3)}...` : text
      if (messageId != null) {
        try {
          await bot.api.editMessageText(chatId, messageId, truncated, {})
          return
        } catch {
          // Fall through to send a new message.
        }
      }

      const sent = await bot.api.sendMessage(chatId, truncated, {})
      if (sent?.message_id != null) lastMessageIds.set(chatId, sent.message_id)
    }
  }
}

async function downloadTelegramFile(
  bot: TelegramBotLike,
  botToken: string,
  fileId: string,
  meta: {
    kind: AgentChannelIncomingAttachment['kind']
    name: string
    mimeType: string
    fetchImpl?: typeof fetch
  }
): Promise<AgentChannelIncomingAttachment | null> {
  try {
    const file = await bot.api.getFile(fileId)
    if (!file.file_path) return null
    const url = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`
    const resolvedFetch =
      meta.fetchImpl ??
      (await import('../../../../network/platformFetch')).getPlatformFetch()
    const downloaded = await downloadUrlAsBase64(url, {
      fetchImpl: resolvedFetch,
      fallbackMimeType: meta.mimeType
    })
    if (!downloaded) return null
    return {
      kind: meta.kind,
      name: meta.name,
      mimeType: downloaded.mimeType || meta.mimeType,
      data: downloaded.data
    }
  } catch {
    return null
  }
}

async function forwardTelegramTextEvent(
  channel: TelegramAgentChannelEntity,
  context: AgentChannelRuntimeHostContext,
  ctx: TelegramChatContext,
  text: string,
  attachments?: AgentChannelIncomingAttachment[]
): Promise<void> {
  const chatId = String(ctx.chat?.id ?? '').trim()
  const normalizedText = text.trim()
  if (!chatId || (!normalizedText && !attachments?.length)) return

  await context.handleIncomingText?.({
    agentId: channel.agentId ?? '',
    channelId: channel.id,
    channelType: 'telegram',
    chatId,
    userId: ctx.from?.id == null ? undefined : String(ctx.from.id),
    userName: ctx.from?.first_name ?? ctx.from?.username,
    text: normalizedText,
    ...(attachments?.length ? { attachments } : {})
  })
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
