import type { McpRuntimeService, RefreshMcpServerToolsResult } from '../../ai/agent-platform/mcp'
import type { AgentStoreState } from '../../ai/agent-platform/store/agentStore'

type AgentMcpRefreshDependencies = {
  getState: () => Promise<AgentStoreState>
  refreshServerTools: McpRuntimeService['refreshServerTools']
  replaceAgentState: (state: AgentStoreState) => Promise<AgentStoreState>
}

export async function refreshAgentMcpTools(
  deps: AgentMcpRefreshDependencies,
  serverId: string
): Promise<RefreshMcpServerToolsResult['tools']> {
  const state = await deps.getState()
  const result = await deps.refreshServerTools(state, serverId, {
    preserveToolsOnError: true,
    throwOnError: false
  })

  await deps.replaceAgentState(result.state)

  const runtimeStatus = result.state.mcpRuntimeStatusByServerId[serverId]
  if (runtimeStatus?.state === 'error') {
    throw new Error(runtimeStatus.message ?? `Failed to refresh MCP tools for "${serverId}".`)
  }

  return result.tools
}
