import type { AgentRuntimeCommandResult } from '@platform/ai/agent-platform/runtime/commands'

export type AgentRuntimeCommandCard = {
  command: string
  title: string
  summary: string
  rows: Array<{ label: string; value: string }>
}

export function buildAgentRuntimeCommandCard(
  command: string,
  result: AgentRuntimeCommandResult,
  titles: {
    context: string
    cost: string
    todos: string
  }
): AgentRuntimeCommandCard {
  switch (result.type) {
    case 'context':
      return {
        command,
        title: titles.context,
        summary: result.summary,
        rows: result.sections.map((section) => ({ label: section.label, value: section.value }))
      }
    case 'cost':
      return {
        command,
        title: titles.cost,
        summary: result.summary,
        rows: result.usage.map((item) => ({ label: item.label, value: item.value }))
      }
    case 'todos':
      return {
        command,
        title: titles.todos,
        summary: result.summary,
        rows: result.todos.map((todo) => ({
          label: todo.status,
          value: todo.label
        }))
      }
  }
}

export function isAgentRuntimeCommandResultPart(
  part: { type?: string; command?: unknown; result?: unknown }
): part is {
  type: 'agent-runtime-command-result'
  command: string
  result: AgentRuntimeCommandResult
  text?: string
} {
  return (
    part.type === 'agent-runtime-command-result' &&
    typeof part.command === 'string' &&
    part.result != null &&
    typeof part.result === 'object' &&
    'type' in part.result
  )
}
