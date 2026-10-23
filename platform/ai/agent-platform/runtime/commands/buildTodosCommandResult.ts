import type {
  AgentRuntimeCommandResult,
  AgentRuntimeCommandTodosInput
} from './agentRuntimeCommandTypes'

export function buildTodosCommandResult(
  input: AgentRuntimeCommandTodosInput = { todos: [] }
): Extract<AgentRuntimeCommandResult, { type: 'todos' }> {
  const todos = input.todos ?? []
  return {
    type: 'todos',
    summary: todos.length === 0 ? 'No runtime todos are available.' : `Runtime todos (${todos.length})`,
    todos
  }
}
