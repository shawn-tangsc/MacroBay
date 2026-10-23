import type { AgentEffort, AgentPermissionMode } from '../../../schemas/agentSchemas'
import type { Tool } from '../../../schemas/toolSchemas'
import type { McpRuntimeSourceSnapshot } from '../../../mcp/McpRuntimeService'
import { cloneAgentSkillRuntimeEntry, type AgentSkillRuntimeEntry } from '../../../skills/skillRuntimeSchemas'
import type { AgentRuntimeComposition } from '../../AgentRuntimeCompositionService'
import { buildClaudeCodeSkillContext } from './ClaudeCodeSkillContext'
import {
  buildClaudeCodeMcpServerConfigs,
  type ClaudeCodeMcpServerConfig
} from './ClaudeCodeMcpServerConfig'
import { buildProductAgentToolRuntimeName } from '../../../productTools/productAgentToolRuntimeNames'
import type { ToolApproval } from '../../../schemas/toolSchemas'

export type ClaudeCodeCompositionSettings = {
  cwd: string | null
  env: Record<string, string>
  permissionMode: AgentPermissionMode
  effort?: AgentEffort | null
  allowedTools: string[]
  disallowedTools: string[]
  mcpSources: McpRuntimeSourceSnapshot[]
  mcpServers: ClaudeCodeMcpServerConfig[]
  skills: AgentSkillRuntimeEntry[]
  skillToolIds: string[]
  runtimeMcpToolNames?: string[]
  runtimeMcpApprovalByName?: Readonly<Record<string, ToolApproval>>
  skillContext?: string | null
}

export type ClaudeCodeSettingsBuilderOptions = {
  defaultEnv?: Record<string, string>
}

export function buildClaudeCodeSettingsFromComposition(
  composition: AgentRuntimeComposition,
  options: ClaudeCodeSettingsBuilderOptions = {}
): ClaudeCodeCompositionSettings {
  return {
    cwd: composition.workspacePath,
    env: {
      ...(options.defaultEnv ?? {}),
      ...composition.environment
    },
    permissionMode: composition.permissionMode,
    effort: composition.effort,
    allowedTools: uniqueToolIds(composition.tools.enabled),
    disallowedTools: uniqueToolIds(composition.tools.disabled),
    mcpSources: composition.mcp.sources.map((source) => ({ ...source })),
    mcpServers: buildClaudeCodeMcpServerConfigs({
      servers: composition.mcp.servers,
      runtimeSources: composition.mcp.sources
    }),
    skills: composition.skills.skills.map((skill) => cloneAgentSkillRuntimeEntry(skill)),
    skillToolIds: [...composition.skills.toolIds],
    runtimeMcpToolNames: Object.keys(buildRuntimeMcpApprovalByName(composition)),
    runtimeMcpApprovalByName: buildRuntimeMcpApprovalByName(composition),
    skillContext: buildClaudeCodeSkillContext(composition.skills.skills)
  }
}

function uniqueToolIds(tools: readonly Pick<Tool, 'id'>[]): string[] {
  const seen = new Set<string>()
  const ids: string[] = []

  for (const tool of tools) {
    if (seen.has(tool.id)) continue
    seen.add(tool.id)
    ids.push(tool.id)
  }

  return ids
}

function buildRuntimeMcpApprovalByName(composition: AgentRuntimeComposition): Record<string, ToolApproval> {
  const approvals: Record<string, ToolApproval> = {}

  for (const tool of composition.tools.enabled) {
    if (tool.origin !== 'product' || !tool.productId) continue
    const runtimeName = buildProductAgentToolRuntimeName(tool.productId, tool.name)
    approvals[runtimeName] = tool.approval
  }

  for (const toolName of composition.taskManagement?.toolNames ?? []) {
    approvals[toolName] = 'auto'
  }

  return approvals
}
