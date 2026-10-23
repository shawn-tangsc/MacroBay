import type {
  AgentRuntimeCommandContextInput,
  AgentRuntimeCommandResult
} from './agentRuntimeCommandTypes'

export function buildContextCommandResult(
  input: AgentRuntimeCommandContextInput
): Extract<AgentRuntimeCommandResult, { type: 'context' }> {
  const sections = [
    { label: 'Agent', value: `${input.agentName} (${input.agentType})` },
    { label: 'Session', value: `${input.sessionName} [${input.sessionId}]` },
    {
      label: 'Workspace',
      value: input.workspacePath
        ? `${input.workspacePath}${input.workspaceType ? ` (${input.workspaceType})` : ''}`
        : 'none'
    },
    { label: 'Runtime route', value: input.runtimeRoute ?? 'unknown' },
    { label: 'Warm state', value: input.warmState ?? 'unknown' },
    { label: 'Enabled MCP servers', value: String(input.enabledMcpCount) },
    { label: 'Enabled skills', value: String(input.enabledSkillCount) },
    { label: 'Enabled tools', value: String(input.enabledToolCount) },
    { label: 'Recent messages', value: String(input.recentMessageCount) }
  ]

  return {
    type: 'context',
    summary: `Context for ${input.agentName} / ${input.sessionName}`,
    sections
  }
}
