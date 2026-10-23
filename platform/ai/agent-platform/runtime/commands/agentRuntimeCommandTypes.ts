export type AgentRuntimeCommandName = '/context' | '/cost' | '/todos'

export type AgentRuntimeCommandSection = {
  label: string
  value: string
}

export type AgentRuntimeCommandUsage = {
  label: string
  value: string
}

export type AgentRuntimeTodoItem = {
  id: string
  label: string
  status: 'pending' | 'in_progress' | 'completed' | 'error'
}

export type AgentRuntimeCommandResult =
  | { type: 'context'; summary: string; sections: AgentRuntimeCommandSection[] }
  | { type: 'cost'; summary: string; usage: AgentRuntimeCommandUsage[] }
  | { type: 'todos'; summary: string; todos: AgentRuntimeTodoItem[] }

export type AgentRuntimeCommandContextInput = {
  agentName: string
  agentType: string
  sessionName: string
  sessionId: string
  workspacePath: string | null
  workspaceType: string | null
  runtimeRoute: string | null
  warmState: string | null
  enabledMcpCount: number
  enabledSkillCount: number
  enabledToolCount: number
  recentMessageCount: number
}

export type AgentRuntimeCommandCostInput = {
  messageCount: number
  promptTokens: number
  completionTokens: number
  thoughtsTokens: number
  totalTokens: number
  messagesWithStats: number
}

export type AgentRuntimeCommandTodosInput = {
  todos: AgentRuntimeTodoItem[]
}

export function formatAgentRuntimeCommandResultText(result: AgentRuntimeCommandResult): string {
  switch (result.type) {
    case 'context':
      return [
        result.summary,
        ...result.sections.map((section) => `${section.label}: ${section.value}`)
      ].join('\n')
    case 'cost':
      return [result.summary, ...result.usage.map((item) => `${item.label}: ${item.value}`)].join('\n')
    case 'todos':
      if (result.todos.length === 0) return result.summary
      return [
        result.summary,
        ...result.todos.map((todo) => `- [${todo.status}] ${todo.label}`)
      ].join('\n')
  }
}

export function isAgentRuntimeCommandName(value: string): value is AgentRuntimeCommandName {
  return value === '/context' || value === '/cost' || value === '/todos'
}
