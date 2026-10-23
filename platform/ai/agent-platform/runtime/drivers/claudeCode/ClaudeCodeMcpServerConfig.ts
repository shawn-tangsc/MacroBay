import type { McpRuntimeSourceSnapshot } from '../../../mcp/McpRuntimeService'
import type { McpServerEntity } from '../../../schemas/mcpServerSchemas'

export type ClaudeCodeMcpServerConfig =
  | {
      serverId: string
      serverName: string
      transport: 'stdio'
      command: string
      args: string[]
      env?: Record<string, string>
    }
  | {
      serverId: string
      serverName: string
      transport: 'sse' | 'streamableHttp'
      url: string
      headers?: Record<string, string>
    }

export type BuildClaudeCodeMcpServerConfigsInput = {
  servers: readonly McpServerEntity[]
  runtimeSources: readonly McpRuntimeSourceSnapshot[]
}

export function buildClaudeCodeMcpServerConfigs(
  input: BuildClaudeCodeMcpServerConfigsInput
): ClaudeCodeMcpServerConfig[] {
  const connectedServerIds = new Set(
    input.runtimeSources
      .filter((source) => source.isActive && source.runtimeState === 'connected')
      .map((source) => source.serverId)
  )
  if (connectedServerIds.size === 0) return []

  const seen = new Set<string>()
  const configs: ClaudeCodeMcpServerConfig[] = []

  for (const server of input.servers) {
    if (!server.isActive || !connectedServerIds.has(server.id) || seen.has(server.id)) continue
    seen.add(server.id)

    const config = toClaudeCodeMcpServerConfig(server)
    if (!config) continue
    configs.push(config)
  }

  return configs
}

function toClaudeCodeMcpServerConfig(server: McpServerEntity): ClaudeCodeMcpServerConfig | null {
  if (server.type === 'stdio') {
    const command = server.command?.trim()
    if (!command) return null

    return {
      serverId: server.id,
      serverName: server.name,
      transport: 'stdio',
      command,
      args: [...(server.args ?? [])],
      ...(server.env ? { env: { ...server.env } } : {})
    }
  }

  if (server.type === 'sse' || server.type === 'streamableHttp') {
    const url = server.baseUrl?.trim()
    if (!url) return null

    return {
      serverId: server.id,
      serverName: server.name,
      transport: server.type,
      url,
      ...(server.headers ? { headers: { ...server.headers } } : {})
    }
  }

  return null
}
