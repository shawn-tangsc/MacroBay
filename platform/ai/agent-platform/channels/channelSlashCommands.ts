import type { AgentChannelEntity } from '../schemas/channelSchemas'

export const channelSlashCommands = [
  { command: 'new', description: 'Start a new conversation' },
  { command: 'compact', description: 'Compact conversation history' },
  { command: 'context', description: 'Show current session context summary' },
  { command: 'cost', description: 'Show token usage statistics' },
  { command: 'todos', description: 'List current runtime todos' },
  { command: 'help', description: 'Show available commands' },
  { command: 'whoami', description: 'Show chat info' }
] as const

export type ChannelSlashCommandName = (typeof channelSlashCommands)[number]['command']

export type ChannelCommandRequest = {
  agentId: string
  channelId: string
  chatId: string
  channelType?: AgentChannelEntity['type']
  userId?: string
  userName?: string
  rawText: string
  command: ChannelSlashCommandName
  sessionId?: string
}

export type ChannelCommandDispatchResult = {
  trackedSessionId?: string
}

const channelCommandPattern = new RegExp(
  `^\\/(${channelSlashCommands.map((item) => item.command).join('|')})\\b`,
  'i'
)

export const DEFAULT_CHANNEL_SESSION_NAME = 'Channel session'

export function parseChannelSlashCommand(text: string): ChannelSlashCommandName | null {
  const match = text.trim().match(channelCommandPattern)
  const command = match?.[1]?.toLowerCase()
  if (!command) return null
  return channelSlashCommands.find((item) => item.command === command)?.command ?? null
}

export function buildChannelHelpText(input: {
  agentName?: string | null
  agentDescription?: string | null
}): string {
  const lines = [
    `*${input.agentName?.trim() || 'Agent'}*`,
    input.agentDescription?.trim() ? `_${input.agentDescription.trim()}_` : '',
    '',
    'Available commands:',
    ...channelSlashCommands.map((item) => `/${item.command} - ${item.description}`)
  ]
  return lines.filter(Boolean).join('\n')
}
