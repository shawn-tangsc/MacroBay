import type { AgentEffort, AgentPermissionMode } from '../../../schemas/agentSchemas'
import type { McpRuntimeSourceSnapshot } from '../../../mcp/McpRuntimeService'
import { cloneAgentSkillRuntimeEntry, type AgentSkillRuntimeEntry } from '../../../skills/skillRuntimeSchemas'
import type { ClaudeCodeMcpServerConfig } from './ClaudeCodeMcpServerConfig'
import type { ClaudeCodeCompositionSettings } from './ClaudeCodeSettingsBuilder'
import { buildClaudeCodeSkillContext } from './ClaudeCodeSkillContext'
import { buildClaudeCodeToolPolicyFromSettings, type ClaudeCodeToolPolicy } from './ClaudeCodeToolPolicy'
import {
  applyClaudeCodeOutputLimitEnv,
  resolveClaudeCodeOutputLimit,
  type ClaudeCodeOutputLimit
} from './ClaudeCodeOutputLimit'

/** Provider environments push third-party relays to `max`; an explicit agent choice must win. */
const EFFORT_ENV_KEY = 'CLAUDE_CODE_EFFORT_LEVEL'

export type ClaudeCodeJsonResponseFormat = {
  type: 'json'
  schema?: Record<string, unknown>
}

export type ClaudeCodeSdkOutputFormat = {
  type: 'json_schema'
  schema: Record<string, unknown>
}

export type ClaudeCodeSdkQueryOptions = {
  model: string
  cwd: string
  env: Record<string, string>
  permissionMode: AgentPermissionMode
  effort?: Exclude<AgentEffort, 'off'>
  thinking?: { type: 'disabled' }
  allowedTools: string[]
  disallowedTools: string[]
  abortController?: AbortController
  resume?: string
  stderr?: (data: string) => void
  outputFormat?: ClaudeCodeSdkOutputFormat
}

export type ClaudeCodeRuntimeMetadata = {
  mcpSources: McpRuntimeSourceSnapshot[]
  mcpServers: ClaudeCodeMcpServerConfig[]
  skills: AgentSkillRuntimeEntry[]
  skillToolIds: string[]
  runtimeMcpToolNames?: string[]
  skillContext?: string | null
  /** 本回合的单轮输出上限及其来源；`undefined` = 调用方构造的旧元数据。 */
  outputLimit?: ClaudeCodeOutputLimit
  toolPolicy: ClaudeCodeToolPolicy
}

export type ClaudeCodeQueryOptionsInput = {
  modelId: string
  settings: ClaudeCodeCompositionSettings
  providerEnv?: Record<string, string>
  abortController?: AbortController
  responseFormat?: ClaudeCodeJsonResponseFormat
  stderr?: (data: string) => void
  stderrCollector?: (data: string) => void
  resume?: string
  effectiveResume?: string
  /** 模型能力声明为不支持推理时强制关闭思考；`undefined` = 未声明，保持原行为。 */
  modelSupportsReasoning?: boolean
  /** 模型声明的 `maxCompletionTokens`；缺省 = 没有能力值，用安全默认。 */
  modelMaxOutputTokens?: number | null
}

export type ClaudeCodeQueryOptions = {
  sdkOptions: ClaudeCodeSdkQueryOptions
  runtimeMetadata: ClaudeCodeRuntimeMetadata
}

export function createClaudeCodeQueryOptionsFromSettings(input: ClaudeCodeQueryOptionsInput): ClaudeCodeQueryOptions {
  if (!input.settings.cwd) {
    throw new Error('Claude Code query options require a workspace cwd.')
  }

  const skillContext =
    input.settings.skillContext ?? (input.settings.skills.length > 0 ? buildClaudeCodeSkillContext(input.settings.skills) : undefined)
  const requestedEffort = input.settings.effort
  const reasoningDisabled = requestedEffort === 'off' || input.modelSupportsReasoning === false
  const configuredEffort: Exclude<AgentEffort, 'off'> | null =
    requestedEffort && requestedEffort !== 'off' ? requestedEffort : null
  const outputLimit = applyClaudeCodeOutputLimitEnv(
    resolveSdkEnvironment(input.settings, input.providerEnv, reasoningDisabled),
    resolveClaudeCodeOutputLimit(input.modelMaxOutputTokens)
  )

  return {
    sdkOptions: {
      model: input.modelId,
      cwd: input.settings.cwd,
      env: outputLimit.env,
      permissionMode: input.settings.permissionMode,
      ...(reasoningDisabled
        ? { thinking: { type: 'disabled' as const } }
        : configuredEffort
          ? { effort: configuredEffort }
          : {}),
      allowedTools: [...input.settings.allowedTools],
      disallowedTools: [...input.settings.disallowedTools],
      ...(input.abortController ? { abortController: input.abortController } : {}),
      ...(input.effectiveResume ?? input.resume ? { resume: input.effectiveResume ?? input.resume } : {}),
      ...buildStderrOption(input),
      ...buildOutputFormatOption(input.responseFormat)
    },
    runtimeMetadata: {
      mcpSources: input.settings.mcpSources.map((source) => ({ ...source })),
      mcpServers: input.settings.mcpServers.map((server) => cloneMcpServerConfig(server)),
      skills: input.settings.skills.map((skill) => cloneAgentSkillRuntimeEntry(skill)),
      skillToolIds: [...input.settings.skillToolIds],
      runtimeMcpToolNames: [...(input.settings.runtimeMcpToolNames ?? [])],
      ...(skillContext !== undefined ? { skillContext } : {}),
      outputLimit: { ...outputLimit.outputLimit },
      toolPolicy: buildClaudeCodeToolPolicyFromSettings(input.settings)
    }
  }
}

/**
 * Provider environments pin third-party relays to `CLAUDE_CODE_EFFORT_LEVEL=max` so models
 * without a reasoning-effort control still get the deepest default. Once the agent carries an
 * explicit effort (including `off`, which disables thinking), that choice is sent as the SDK
 * `thinking`/`effort` option, and the environment default is dropped so it cannot override it.
 * A model whose capabilities declare no reasoning gets thinking disabled the same way.
 */
function resolveSdkEnvironment(
  settings: ClaudeCodeCompositionSettings,
  providerEnv: Record<string, string> | undefined,
  reasoningDisabled: boolean
): Record<string, string> {
  const env = { ...settings.env, ...(providerEnv ?? {}) }
  if (reasoningDisabled || settings.effort) delete env[EFFORT_ENV_KEY]
  return env
}

function cloneMcpServerConfig(server: ClaudeCodeMcpServerConfig): ClaudeCodeMcpServerConfig {
  if (server.transport === 'stdio') {
    return {
      ...server,
      args: [...server.args],
      ...(server.env ? { env: { ...server.env } } : {})
    }
  }

  return {
    ...server,
    ...(server.headers ? { headers: { ...server.headers } } : {})
  }
}

function buildStderrOption(input: Pick<ClaudeCodeQueryOptionsInput, 'stderr' | 'stderrCollector'>): Pick<ClaudeCodeSdkQueryOptions, 'stderr'> {
  if (!input.stderr && !input.stderrCollector) return {}

  return {
    stderr: (data) => {
      input.stderrCollector?.(data)
      input.stderr?.(data)
    }
  }
}

function buildOutputFormatOption(
  responseFormat: ClaudeCodeJsonResponseFormat | undefined
): Pick<ClaudeCodeSdkQueryOptions, 'outputFormat'> {
  if (responseFormat?.type !== 'json' || !responseFormat.schema) return {}

  return {
    outputFormat: {
      type: 'json_schema',
      schema: responseFormat.schema
    }
  }
}
