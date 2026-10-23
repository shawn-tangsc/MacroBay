import type {
  AgentRuntimeCommandCostInput,
  AgentRuntimeCommandResult
} from './agentRuntimeCommandTypes'

export function buildCostCommandResult(
  input: AgentRuntimeCommandCostInput
): Extract<AgentRuntimeCommandResult, { type: 'cost' }> {
  const usage = [
    { label: 'Messages', value: String(input.messageCount) },
    { label: 'Messages with stats', value: String(input.messagesWithStats) },
    { label: 'Prompt tokens', value: String(input.promptTokens) },
    { label: 'Completion tokens', value: String(input.completionTokens) },
    { label: 'Thought tokens', value: String(input.thoughtsTokens) },
    { label: 'Total tokens', value: String(input.totalTokens) }
  ]

  return {
    type: 'cost',
    summary:
      input.messagesWithStats === 0
        ? 'No token usage stats are available for this session yet.'
        : `Token usage across ${input.messagesWithStats} message(s) with stats.`,
    usage
  }
}
