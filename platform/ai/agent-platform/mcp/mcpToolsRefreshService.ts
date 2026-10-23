import type { McpServerEntity } from '../schemas/mcpServerSchemas'
import type { McpTool } from '../schemas/toolSchemas'
import type { AgentStoreState } from '../store/agentStore'
import { setMcpRuntimeStatus, setMcpServerTools } from '../store/agentRelationsStore'
import type { McpToolInput } from '../tools/agentToolCatalog'
import { classifyMcpRuntimeError } from './mcpRuntimeError'

export type McpToolDiscovery = (server: McpServerEntity, state: AgentStoreState) => Promise<readonly McpToolInput[]>

export type RefreshMcpServerToolsOptions = {
  discoverTools?: McpToolDiscovery
  now?: () => number
  throwOnError?: boolean
  preserveToolsOnError?: boolean
}

export type RefreshMcpServerToolsResult = {
  state: AgentStoreState
  tools: McpTool[]
}

export async function refreshMcpServerTools(
  state: AgentStoreState,
  serverId: string,
  options: RefreshMcpServerToolsOptions = {}
): Promise<RefreshMcpServerToolsResult> {
  const server = state.mcpServers.find((item) => item.id === serverId)
  if (!server) throw new Error(`MCP server "${serverId}" was not found.`)

  const now = options.now ?? Date.now
  if (!server.isActive) {
    const disabledState = setMcpServerTools(
      setMcpRuntimeStatus(state, server.id, { state: 'disabled', lastCheckedAt: now() }),
      server.id,
      []
    )
    return { state: disabledState, tools: [] }
  }

  const connectingState = setMcpRuntimeStatus(state, server.id, { state: 'connecting', lastCheckedAt: now() })
  try {
    const discoveredTools = await (options.discoverTools ?? discoverToolsFromSnapshot)(server, connectingState)
    const withTools = setMcpServerTools(connectingState, server.id, discoveredTools)
    const connectedState = setMcpRuntimeStatus(withTools, server.id, { state: 'connected', lastCheckedAt: now() })
    return { state: connectedState, tools: connectedState.mcpToolsByServerId[server.id] ?? [] }
  } catch (error) {
    const classification = classifyMcpRuntimeError(error)
    const nextState = options.preserveToolsOnError ? connectingState : setMcpServerTools(connectingState, server.id, [])
    const errorState = setMcpRuntimeStatus(nextState, server.id, {
      state: 'error',
      message: errorMessage(error),
      errorKind: classification.kind,
      retryable: classification.retryable,
      lifecycleState: classification.retryable ? 'reconnect-scheduled' : 'terminal-error',
      lastCheckedAt: now()
    })
    if (options.throwOnError !== false) throw error
    return { state: errorState, tools: errorState.mcpToolsByServerId[server.id] ?? [] }
  }
}

async function discoverToolsFromSnapshot(server: McpServerEntity, state: AgentStoreState): Promise<readonly McpToolInput[]> {
  return state.mcpToolsByServerId[server.id] ?? []
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'Failed to refresh MCP tools.'
}
