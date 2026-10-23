import { buildMcpToolName, toCamelSegment } from './mcpToolName'

export type McpSourceServer = {
  id?: string
  name: string
  disabledTools?: string[]
  disabledAutoApproveTools?: string[]
}

export type McpSourceTool = {
  id?: string
  name: string
}

export type McpSourceAccess = {
  enabled: boolean
  approval: 'auto' | 'prompt'
}

/** Matches a wildcard rule such as `mcp__github__*` for one server. */
export function buildMcpToolWildcard(serverName: string): string {
  return `mcp__${toCamelSegment(serverName)}__*`
}

/**
 * A source rule may be written as the raw tool name, the tool id, the wire
 * name, or a wildcard for the whole server.
 */
export function matchesSourceRule(value: string, server: McpSourceServer, tool: McpSourceTool): boolean {
  return (
    value === tool.name ||
    value === tool.id ||
    value === buildMcpToolName(server.name, tool.name) ||
    value === buildMcpToolWildcard(server.name)
  )
}

/**
 * Resolves the effective access for one MCP tool from the server-level policy.
 * A disabled tool fails closed; a tool listed for manual approval stays enabled
 * but always asks the user.
 */
export function resolveSourceAccess(server: McpSourceServer, tool: McpSourceTool): McpSourceAccess {
  const disabled = server.disabledTools?.some((rule) => matchesSourceRule(rule, server, tool)) ?? false
  if (disabled) {
    return { enabled: false, approval: 'prompt' }
  }

  const needsApproval =
    server.disabledAutoApproveTools?.some((rule) => matchesSourceRule(rule, server, tool)) ?? false

  return { enabled: true, approval: needsApproval ? 'prompt' : 'auto' }
}
