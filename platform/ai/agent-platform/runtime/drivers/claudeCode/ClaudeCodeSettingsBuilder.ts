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
import { normalizeSessionAllowedTools, isSessionBarePreApprovedToolName } from '../../../tools/sessionAllowedTools'
import {
  ANTHROPIC_SERVER_WEB_TOOL_NAMES,
  isAnthropicServerWebToolName
} from '../../../../providers/providerServerTools'
import {
  isPlatformWebSearchSessionToolName,
  platformWebSearchRuntimeName
} from '../../../tools/platformWebTools'

export type ClaudeCodeCompositionSettings = {
  cwd: string | null
  env: Record<string, string>
  permissionMode: AgentPermissionMode
  effort?: AgentEffort | null
  allowedTools: string[]
  /**
   * 已批准、但**不**写进 SDK `allowedTools` 的工具（MCP WebSearch、会话放行的 prompt 工具等）。
   *
   * SDK 的 bare `allowedTools` 会在 canUseTool 之前自动放行整个工具；对这些名字只把
   * 决定权交给运行时 tool policy（canUseTool / PreToolUse），不再让 SDK 预授权。
   */
  policyAllowedTools?: string[]
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
  /**
   * 当前 provider 能否承载 Anthropic server-side web tools（WebSearch/WebFetch）。
   *
   * `false` = 明确不支持：从 allowedTools 剔除，并加入 disallowedTools —— 只删 allowed 不够，
   * `allowedTools` 只是免审批列表，工具仍会出现在模型上下文里（会被调用后 prompt/400）。
   * `undefined` = 调用方无法判断（例如单测/嵌入方）：保持改动前的行为。
   */
  serverWebToolsSupported?: boolean
}

export function buildClaudeCodeSettingsFromComposition(
  composition: AgentRuntimeComposition,
  options: ClaudeCodeSettingsBuilderOptions = {}
): ClaudeCodeCompositionSettings {
  const requestedAllowedTools = uniqueStrings([
    ...resolveBaseAllowedTools(composition),
    ...resolveSessionAllowedTools(composition).map(toRuntimeSessionToolName)
  ])
  const requestedDisallowedTools = uniqueToolIds(composition.tools.disabled)
  const serverWebToolsUnsupported = options.serverWebToolsSupported === false
  const supportedAllowedTools = serverWebToolsUnsupported
    ? requestedAllowedTools.filter((toolName) => !isAnthropicServerWebToolName(toolName))
    : requestedAllowedTools
  const { allowedTools, policyAllowedTools } = splitPreApprovedTools(supportedAllowedTools)

  return {
    cwd: composition.workspacePath,
    env: {
      ...(options.defaultEnv ?? {}),
      ...composition.environment
    },
    permissionMode: composition.permissionMode,
    effort: composition.effort,
    allowedTools,
    policyAllowedTools,
    disallowedTools: serverWebToolsUnsupported
      ? uniqueStrings([...requestedDisallowedTools, ...ANTHROPIC_SERVER_WEB_TOOL_NAMES])
      : requestedDisallowedTools,
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

/**
 * 基线的预授权集合。默认就是所有 enabled 工具（历史行为）；当 agent 打开
 * `requireSessionToolAllowlist` 时，prompt 类 builtin 不再预授权，交给会话白名单决定。
 * MCP / Skill 工具不受影响。
 */
function resolveBaseAllowedTools(composition: AgentRuntimeComposition): string[] {
  const enabled = uniqueToolIds(composition.tools.enabled)
  if (composition.requireSessionToolAllowlist !== true) return enabled

  const builtinApprovalById = new Map(
    composition.tools.all
      .filter((tool) => tool.origin === 'builtin')
      .map((tool) => [tool.id, tool.approval] as const)
  )
  return enabled.filter((toolId) => {
    const approval = builtinApprovalById.get(toolId)
    // 不在 all 里的 id（skill/MCP 注册表工具）保持预授权，开关只对 builtin 生效。
    return approval === undefined || approval !== 'prompt'
  })
}

/**
 * 会话白名单只允许 builtin 工具，且永远让位于 agent 的 deny 列表：
 * 一个会话可以额外放行 WebSearch，但不能把 agent 明确禁用的工具重新打开。
 */
function resolveSessionAllowedTools(composition: AgentRuntimeComposition): string[] {
  const disabled = new Set(composition.tools.disabled.map((tool) => tool.id))
  return normalizeSessionAllowedTools(composition.sessionAllowedTools).filter((toolName) => !disabled.has(toolName))
}

/** 平台只读 web 工具的会话名在 SDK 里必须换成 MCP 运行时名。 */
function toRuntimeSessionToolName(name: string): string {
  return isPlatformWebSearchSessionToolName(name) ? platformWebSearchRuntimeName : name
}

/**
 * 把"已批准的工具"拆成两路：
 *  - `allowedTools`：只有只读且自动批准的 builtin 可以 bare 形式交给 SDK 预授权；
 *  - `policyAllowedTools`：其余已批准的工具只进运行时策略，canUseTool/PreToolUse 仍会被调用。
 *
 * 这样既保留只读 auto 工具的零往返放行，又不会让审批/能力门控工具被
 * SDK bare allowlist 直接放行（`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`）。
 */
function splitPreApprovedTools(toolNames: readonly string[]): {
  allowedTools: string[]
  policyAllowedTools: string[]
} {
  const allowedTools: string[] = []
  const policyAllowedTools: string[] = []

  for (const toolName of toolNames) {
    if (isSessionBarePreApprovedToolName(toolName)) {
      allowedTools.push(toolName)
    } else {
      policyAllowedTools.push(toolName)
    }
  }

  return { allowedTools, policyAllowedTools }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
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
