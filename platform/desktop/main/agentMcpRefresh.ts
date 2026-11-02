import type { McpRuntimeService, RefreshMcpServerToolsResult } from '../../ai/agent-platform/mcp'
import type { AgentStoreState } from '../../ai/agent-platform/store/agentStore'

/**
 * 刷新单个 MCP 服务器工具时要的三件事。
 *
 * 导出它，是因为**装配现在在 `composition/` 里拼这条链**，而依赖形状属于这个函数、不属于调用点——
 * 在调用点各抄一份 `{ getState, refreshServerTools, replaceAgentState }`，第三个调用点就会抄漏一项。
 */
export type AgentMcpRefreshDependencies = {
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
