import type { AgentType } from '../schemas/agentSchemas'

export type SlashCommand = {
  command: string
  description: string
}

const claudeCodeBuiltinSlashCommands: SlashCommand[] = [
  { command: '/clear', description: 'Clear conversation history' },
  { command: '/compact', description: 'Compact conversation with optional focus instructions' },
  { command: '/context', description: 'Visualize current context usage as a colored grid' },
  { command: '/cost', description: 'Show token usage statistics' },
  { command: '/todos', description: 'List current todo items' }
]

export function getBuiltinSlashCommands(agentType: AgentType | string | undefined): SlashCommand[] {
  if (agentType === 'claude-code') return claudeCodeBuiltinSlashCommands
  return []
}
