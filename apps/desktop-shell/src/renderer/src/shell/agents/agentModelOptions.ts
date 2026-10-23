import type { AgentType } from '@platform/ai/agent-platform/schemas/agentSchemas'
import {
  isAgentCompatibleModel as isAgentRuntimeCompatibleModel,
  resolveAgentModelCompatibility
} from '@platform/ai/agent-platform/agents/agentModelCompatibility'
import type {
  AgentRuntimeCompatibilityResult,
  AgentRuntimeCompatibilityStatus
} from '@platform/ai/agent-platform/runtime/compatibility/agentRuntimeCompatibilityTypes'
import {
  hasClaudeCodeRuntimeCapability,
  hasDeclaredClaudeCodeSupport,
  hasOpenAiAgentsRuntimeCapability,
  isChatModel
} from '@platform/ai/agent-platform/runtime/compatibility'
import type { ModelDefinition, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

/** PLAT-70：三态 —— 已验证可用 / 未验证（可选但需标注） / 明确不可用（置灰 + 原因）。 */
export type AgentModelOptionVerification = 'verified' | 'unverified' | 'unavailable'

export type AgentModelOption = {
  value: string
  label: string
  providerId: string
  providerName: string
  model: ModelDefinition
  compatibility?: AgentRuntimeCompatibilityResult
  verification: AgentModelOptionVerification
  /** 未验证或不可用时不可选（unverified 仍可选，只是要标注「未验证」）。 */
  selectable: boolean
  /** 判定依据：不可用时是具体状态，未验证时是 `unknown`。UI 据此写原因。 */
  status: AgentRuntimeCompatibilityStatus | 'unknown'
}

export type AgentModelOptionGroup = {
  label: string
  options: AgentModelOption[]
}

export type BuildAgentModelOptionsInput = {
  providers: readonly SafeModelProvider[]
  agentType: AgentType | string | undefined
  compatibilityByModelKey?: ReadonlyMap<string, AgentRuntimeCompatibilityResult>
}

/**
 * PLAT-70：候选 = **带该 agentType 标记**的模型（chat + `agentRuntimes.<runtime> === true`）。
 *
 * 关键：**绝不因为「还没有探测证据」把模型从列表里删掉**（旧实现 `compatibility?.selectable === true`
 * 会在 map 为空/过期的瞬间把整列表清空 ⇒ 用户什么模型都选不了）。只有「明确不可用」才置灰。
 */
export function buildAgentModelOptions(
  providers: readonly SafeModelProvider[],
  agentType: AgentType | string | undefined,
  compatibilityByModelKey?: ReadonlyMap<string, AgentRuntimeCompatibilityResult>
): AgentModelOptionGroup[] {
  return providers
    // 供应商已停用 ⇒ 它的模型不该出现在智能体候选里（用户已明确关掉这家）。
    .filter((provider) => provider.enabled !== false)
    .map((provider) => ({
      label: provider.name,
      options: provider.models.flatMap((model): AgentModelOption[] => {
        const key = `${provider.id}:${model.id}`
        const compatibility = compatibilityByModelKey?.get(key)
        // 没标记、也没证据 ⇒ 不是智能体候选（普通聊天模型不混进来）。
        if (!hasAgentRuntimeTag(model, agentType) && !compatibility) return []
        const state = resolveOptionState(provider, model, agentType, compatibility)
        if (state === null) return []
        return [{
          value: key,
          label: model.name,
          providerId: provider.id,
          providerName: provider.name,
          model,
          ...(compatibility ? { compatibility } : {}),
          ...state
        }]
      })
    }))
    .filter((group) => group.options.length > 0)
}

/** 该模型是否带**当前 agentType 自己的**运行期标记（claude-code / openai-agents 各算各的）。 */
export function hasAgentRuntimeTag(
  model: ModelDefinition,
  agentType: AgentType | string | undefined = 'claude-code'
): boolean {
  if (!isChatModel(model)) return false
  if (agentType === 'openai-agents') return hasOpenAiAgentsRuntimeCapability(model)
  return hasClaudeCodeRuntimeCapability(model)
}

/** 静态判据里属于「明确不可用」的状态（其余没有证据的情况一律算未验证、仍可选）。 */
const STATIC_UNAVAILABLE_STATUSES = new Set<AgentRuntimeCompatibilityStatus>([
  'provider-disabled',
  'missing-api-key',
  'missing-endpoint'
])

/** 证据里属于「无法确认」的状态：过期/超时 ⇒ 未验证，而不是不可用。 */
const UNCONFIRMED_STATUSES = new Set<AgentRuntimeCompatibilityStatus>([
  'unknown',
  'probe-timeout',
  // A route condition is not a model capability. These models still belong in the picker;
  // the agent page explains how to reach them (direct probe or local gateway).
  'gateway-required',
  'gateway-stopped'
])

function resolveOptionState(
  provider: SafeModelProvider,
  model: ModelDefinition,
  agentType: AgentType | string | undefined,
  compatibility: AgentRuntimeCompatibilityResult | undefined
): Pick<AgentModelOption, 'verification' | 'selectable' | 'status'> | null {
  if (compatibility) {
    if (compatibility.selectable) {
      return { verification: 'verified', selectable: true, status: compatibility.status }
    }
    // 证据说"缺少 API Key"，但供应商**当前确实有 Key** ⇒ 是过期证据，降级为「未验证」而不是不可用。
    if (compatibility.status === 'missing-api-key' && provider.hasApiKey) {
      return { verification: 'unverified', selectable: true, status: 'unknown' }
    }
    if (UNCONFIRMED_STATUSES.has(compatibility.status)) {
      return { verification: 'unverified', selectable: true, status: 'unknown' }
    }
    return { verification: 'unavailable', selectable: false, status: compatibility.status }
  }

  // 厂商声明就是"可用"的证据（`messagesSupport === 'yes'`，见 PLAT-82）；
  // 没有运行时报告时也要认这条，否则会把声明可用的模型说成未验证。
  // 迁移前的真实探测结论 `probeStatus === 'passed'` 由同一处判定兜底，不在这里重写规则。
  if (hasDeclaredClaudeCodeSupport(model)) {
    return { verification: 'verified', selectable: true, status: 'unknown' }
  }

  // 没有证据：按静态判据说明「为什么不能用」，其余回落成「未验证但可选」。
  const staticResult = resolveAgentModelCompatibility(provider, model, agentType, { requireReadyProvider: true })
  if (staticResult.status === 'model-not-enabled') return null
  // 供应商确实有 Key 时，"缺少 API Key" 只可能是过期/错误的派生状态 ⇒ 降级为未验证。
  if (staticResult.status === 'missing-api-key' && provider.hasApiKey) {
    return { verification: 'unverified', selectable: true, status: 'unknown' }
  }
  if (staticResult.selectable || !STATIC_UNAVAILABLE_STATUSES.has(staticResult.status)) {
    return { verification: 'unverified', selectable: true, status: 'unknown' }
  }
  return { verification: 'unavailable', selectable: false, status: staticResult.status }
}

export function flattenAgentModelOptions(groups: readonly AgentModelOptionGroup[]): AgentModelOption[] {
  return groups.flatMap((group) => group.options)
}

export function isAgentCompatibleModel(
  provider: SafeModelProvider,
  model: ModelDefinition,
  agentType: AgentType | string | undefined = 'claude-code'
): boolean {
  return isAgentRuntimeCompatibleModel(provider, model, agentType, { requireReadyProvider: true })
}

export function describeAgentModelCompatibility(result: AgentRuntimeCompatibilityResult | undefined): string | null {
  if (!result) return null
  if (result.selectable && result.route === 'direct') return 'Direct Claude Code'
  if (result.selectable && result.route === 'gateway') return 'Ready through Agent Gateway'
  if (result.status === 'gateway-required') return 'Gateway required'
  if (result.status === 'gateway-stopped') return 'Gateway stopped'
  if (result.status === 'auth-failed') return 'Claude Code auth failed'
  if (result.status === 'protocol-unsupported') return 'Protocol unsupported'
  if (result.status === 'unknown') return 'Runtime route unverified'
  if (!result.selectable) return result.summary
  return null
}
