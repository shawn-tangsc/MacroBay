import type { AgentChannelRuntimeHostContext } from '../../../../ai/agent-platform/channels/channelRuntimeHost'
import type { SlackAgentChannelEntity } from '../../../../ai/agent-platform/schemas/channelSchemas'
import type { AllowedChatGuard } from '../shared/createAllowedChatGuard'
import { isSlashCommand } from '../shared/isSlashCommand'

export type SlackSocketEnvelope = {
  envelope_id?: string
  type?: 'events_api' | 'slash_commands' | 'interactive' | 'hello' | 'disconnect' | string
  payload?: {
    event?: {
      type?: string
      subtype?: string
      channel?: string
      user?: string
      text?: string
      ts?: string
    }
    command?: string
    text?: string
    user_id?: string
    user_name?: string
    channel_id?: string
  }
}

export async function handleSlackMessageEvent(
  channel: SlackAgentChannelEntity,
  context: AgentChannelRuntimeHostContext,
  allowedChatGuard: AllowedChatGuard,
  event: NonNullable<NonNullable<SlackSocketEnvelope['payload']>['event']>,
  botUserId: string | null
): Promise<void> {
  if (event.type !== 'message') return
  if (event.subtype && event.subtype !== 'file_share') return
  if (event.user && botUserId && event.user === botUserId) return

  const chatId = String(event.channel ?? '').trim()
  if (!chatId || !allowedChatGuard.isAllowed(chatId)) return

  const text = (event.text ?? '').replace(/<@[A-Z0-9]+>/g, '').trim()
  if (!text) return

  if (isSlashCommand(text)) {
    await context.handleIncomingText?.({
      agentId: channel.agentId ?? '',
      channelId: channel.id,
      channelType: 'slack',
      chatId,
      userId: event.user,
      text: text.split(/\s+/, 1)[0] ?? text
    })
    return
  }

  await context.handleIncomingText?.({
    agentId: channel.agentId ?? '',
    channelId: channel.id,
    channelType: 'slack',
    chatId,
    userId: event.user,
    text
  })
}

export async function handleSlackSlashCommand(
  channel: SlackAgentChannelEntity,
  context: AgentChannelRuntimeHostContext,
  allowedChatGuard: AllowedChatGuard,
  payload: NonNullable<SlackSocketEnvelope['payload']>
): Promise<void> {
  const chatId = String(payload.channel_id ?? '').trim()
  const command = (payload.command ?? '').replace(/^\//, '').toLowerCase()
  if (!chatId || !allowedChatGuard.isAllowed(chatId)) return
  if (!['new', 'compact', 'help', 'whoami'].includes(command)) return

  await context.handleIncomingText?.({
    agentId: channel.agentId ?? '',
    channelId: channel.id,
    channelType: 'slack',
    chatId,
    userId: payload.user_id,
    userName: payload.user_name,
    text: `/${command}`
  })
}
