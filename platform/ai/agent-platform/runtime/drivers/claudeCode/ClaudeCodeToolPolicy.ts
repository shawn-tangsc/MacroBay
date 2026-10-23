import type { AgentPermissionMode } from '../../../schemas/agentSchemas'
import type { ToolApproval } from '../../../schemas/toolSchemas'
import type { McpRuntimeSourceSnapshot } from '../../../mcp/McpRuntimeService'
import type { ClaudeCodeCompositionSettings } from './ClaudeCodeSettingsBuilder'

export type ClaudeCodeToolApprovalDecision =
  | {
      kind: 'allow'
      toolName: string
    }
  | {
      kind: 'prompt'
      toolName: string
    }
  | {
      kind: 'deny'
      toolName: string
      reason: 'tool-disabled'
    }

export type ClaudeCodeToolInvocationApprovalRequest = {
  toolCallId: string
  toolName: string
}

export type ClaudeCodeToolPolicy = {
  permissionMode: AgentPermissionMode
  allowedTools: string[]
  disallowedTools: string[]
  mcpSources: McpRuntimeSourceSnapshot[]
  skillToolIds: string[]
  runtimeMcpToolNames?: string[]
  runtimeMcpApprovalByName?: Readonly<Record<string, ToolApproval>>
  canUseTool: (toolName: string) => ClaudeCodeToolApprovalDecision
  preToolUse: (input: { toolName: string; input?: unknown }) => ClaudeCodeToolApprovalDecision
  toApprovalRequest: (
    decision: Extract<ClaudeCodeToolApprovalDecision, { kind: 'prompt' }>,
    toolCallId?: string
  ) => ClaudeCodeToolInvocationApprovalRequest
}

export function buildClaudeCodeToolPolicyFromSettings(settings: ClaudeCodeCompositionSettings): ClaudeCodeToolPolicy {
  const allowedTools = dedupe(settings.allowedTools)
  const disallowedTools = dedupe(settings.disallowedTools)
  const skillToolIds = dedupe(settings.skillToolIds)
  const runtimeMcpToolNames = dedupe(settings.runtimeMcpToolNames ?? [])
  const runtimeMcpApprovalByName = settings.runtimeMcpApprovalByName ?? {}
  const allowedToolSet = new Set(allowedTools)
  const disallowedToolSet = new Set(disallowedTools)
  const skillToolSet = new Set(skillToolIds)
  const runtimeMcpToolSet = new Set(runtimeMcpToolNames)

  const resolveToolDecision = (toolName: string): ClaudeCodeToolApprovalDecision => {
    if (disallowedToolSet.has(toolName)) {
      return {
        kind: 'deny',
        toolName,
        reason: 'tool-disabled'
      }
    }
    if (runtimeMcpToolSet.has(toolName)) {
      const approval = runtimeMcpApprovalByName[toolName] ?? 'prompt'
      return approval === 'auto'
        ? {
            kind: 'allow',
            toolName
          }
        : {
            kind: 'prompt',
            toolName
          }
    }
    if (allowedToolSet.has(toolName) || skillToolSet.has(toolName)) {
      return {
        kind: 'allow',
        toolName
      }
    }
    return {
      kind: 'prompt',
      toolName
    }
  }

  return {
    permissionMode: settings.permissionMode,
    allowedTools,
    disallowedTools,
    mcpSources: settings.mcpSources.map((source) => ({ ...source })),
    skillToolIds,
    runtimeMcpToolNames,
    runtimeMcpApprovalByName,
    canUseTool: (toolName) => resolveToolDecision(toolName),
    preToolUse: ({ toolName }) => resolveToolDecision(toolName),
    toApprovalRequest: (decision, toolCallId) => ({
      toolName: decision.toolName,
      toolCallId: toolCallId ?? buildApprovalToolCallId(decision.toolName)
    })
  }
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function buildApprovalToolCallId(toolName: string): string {
  const normalized = toolName
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

  return `tool-call-${normalized || 'tool'}`
}
