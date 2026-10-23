import type { AgentEntity, AgentPermissionMode } from '../schemas/agentSchemas'
import type { McpServerEntity } from '../schemas/mcpServerSchemas'
import type { McpTool, Tool } from '../schemas/toolSchemas'
import { claudeCodeBuiltinToolDescriptors } from './builtinClaudeTools'
import { resolveSourceAccess } from './mcpSourcePolicy'
import {
  buildMcpToolWireName,
  isToolDisabled,
  resolveToolApproval,
  type ClaudeToolDescriptor
} from './toolRules'

export type McpToolsByServerId = Record<string, McpTool[]>
export type McpToolInput = Partial<McpTool> & Pick<McpTool, 'name'>

export type AgentToolCatalogInput = {
  agent: Pick<AgentEntity, 'type' | 'mcps' | 'disabledTools' | 'configuration'>
  mcpServers: readonly McpServerEntity[]
  mcpToolsByServerId?: McpToolsByServerId
}

export type AgentToolCatalog = {
  all: Tool[]
  enabled: Tool[]
  disabled: Tool[]
  builtin: Tool[]
  mcp: Tool[]
}

export function createMcpToolsByServerId(seed: McpToolsByServerId = {}): McpToolsByServerId {
  return Object.fromEntries(
    Object.entries(seed).map(([serverId, tools]) => [serverId, tools.map((tool) => createMcpTool(tool))])
  )
}

export function createMcpTool(raw: McpToolInput): McpTool {
  return {
    id: raw.id?.trim() || raw.name,
    name: raw.name,
    description: raw.description,
    inputSchema: raw.inputSchema
  }
}

export function listMcpToolsForServer(cache: McpToolsByServerId, serverId: string): McpTool[] {
  return [...(cache[serverId] ?? [])]
}

export function upsertMcpToolsForServer(
  cache: McpToolsByServerId,
  serverId: string,
  tools: readonly McpToolInput[]
): McpToolsByServerId {
  return {
    ...cache,
    [serverId]: tools.map((tool) => createMcpTool(tool))
  }
}

export function removeMcpToolsForServer(cache: McpToolsByServerId, serverId: string): McpToolsByServerId {
  const next = { ...cache }
  delete next[serverId]
  return next
}

export function buildAgentToolCatalog(input: AgentToolCatalogInput): AgentToolCatalog {
  const descriptors = buildAgentToolDescriptors(input)
  const disabledDescriptors = descriptors.filter((descriptor) =>
    isToolDisabled(descriptor, { disabledTools: input.agent.disabledTools })
  )
  const enabledDescriptors = descriptors.filter(
    (descriptor) => !isToolDisabled(descriptor, { disabledTools: input.agent.disabledTools })
  )

  const all = descriptors.map((descriptor) => toTool(descriptor, input.agent.configuration?.permission_mode))
  const enabled = enabledDescriptors.map((descriptor) => toTool(descriptor, input.agent.configuration?.permission_mode))
  const disabled = disabledDescriptors.map((descriptor) => toTool(descriptor, input.agent.configuration?.permission_mode))

  return {
    all,
    enabled,
    disabled,
    builtin: all.filter((tool) => tool.origin === 'builtin'),
    mcp: all.filter((tool) => tool.origin === 'mcp')
  }
}

export function buildAgentToolDescriptors(input: AgentToolCatalogInput): ClaudeToolDescriptor[] {
  if ((input.agent.type ?? 'claude-code') !== 'claude-code') return []

  const descriptors: ClaudeToolDescriptor[] = [...claudeCodeBuiltinToolDescriptors()]
  const selectedServers = new Map(input.mcpServers.map((server) => [server.id, server]))
  const mcpToolsByServerId = input.mcpToolsByServerId ?? {}

  for (const serverId of input.agent.mcps ?? []) {
    const server = selectedServers.get(serverId)
    if (!server?.isActive) continue
    descriptors.push(...mcpToolDescriptors(server, mcpToolsByServerId[server.id] ?? []))
  }

  return descriptors
}

function mcpToolDescriptors(server: McpServerEntity, tools: readonly McpTool[]): ClaudeToolDescriptor[] {
  return tools.flatMap((tool) => {
    const sourceAccess = resolveSourceAccess(server, tool)
    if (!sourceAccess.enabled) return []

    return [
      {
        id: buildMcpToolWireName(server.name, tool.name),
        name: tool.name,
        description: tool.description ?? '',
        origin: 'mcp',
        sourceId: server.id,
        sourceName: server.name,
        sourceToolName: tool.name,
        sourceApproval: sourceAccess.approval
      }
    ]
  })
}

function toTool(descriptor: ClaudeToolDescriptor, permissionMode: AgentPermissionMode | undefined): Tool {
  const decision = resolveToolApproval(descriptor, { permissionMode })
  return {
    id: descriptor.id,
    name: descriptor.name,
    description: descriptor.description,
    origin: descriptor.origin,
    approval: decision.approval,
    sourceId: descriptor.sourceId,
    sourceName: descriptor.sourceName
  }
}
