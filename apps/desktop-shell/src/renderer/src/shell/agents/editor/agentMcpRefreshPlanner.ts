import type { McpServerEntity } from '@platform/ai/agent-platform/schemas/mcpServerSchemas'
import type { McpToolsByServerId } from '@platform/ai/agent-platform/tools/agentToolCatalog'

export type McpToolRefreshPlanInput = {
  boundServerIds: readonly string[]
  servers: readonly McpServerEntity[]
  toolsByServerId: McpToolsByServerId
  requestedServerIds?: ReadonlySet<string>
}

export function planMcpToolRefreshes(input: McpToolRefreshPlanInput): string[] {
  const serversById = new Map(input.servers.map((server) => [server.id, server]))
  const requested = input.requestedServerIds ?? new Set<string>()
  return Array.from(new Set(input.boundServerIds)).filter((serverId) => {
    const server = serversById.get(serverId)
    if (!server?.isActive) return false
    if (requested.has(serverId)) return false
    return (input.toolsByServerId[serverId]?.length ?? 0) === 0
  })
}
