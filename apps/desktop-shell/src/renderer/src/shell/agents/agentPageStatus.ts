import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import {
  isAgentCompatibleModel,
  resolveAgentModelCompatibility
} from '@platform/ai/agent-platform/agents/agentModelCompatibility'
import { hasDeclaredClaudeCodeSupport } from '@platform/ai/agent-platform/runtime/compatibility'
import { resolveConfiguredAgentModel } from '@platform/ai/agent-platform/runtime/effectiveAgentModel'
import type { AgentRuntimeCompatibilityResult } from '@platform/ai/agent-platform/runtime/compatibility/agentRuntimeCompatibilityTypes'
import {
  resolveConfiguredModel,
  type ConfiguredModelUnavailableReason
} from '@platform/ai/model-defaults/configuredDefaultModel'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

export type { ConfiguredModelUnavailableReason }

export type AgentPageStatus =
  | { type: 'ready' }
  | { type: 'model-service-unavailable'; reason: ConfiguredModelUnavailableReason }
  | { type: 'ordinary-chat-only'; summary: string }
  | { type: 'direct-auth-failed'; summary: string }
  | { type: 'runtime-unverified'; summary: string }
  | { type: 'gateway-required'; summary: string }
  | { type: 'gateway-stopped'; summary: string }
  | { type: 'no-agents' }
  | { type: 'no-session' }
  | { type: 'orphan-session' }

export type ResolveAgentPageStatusInput = {
  agents: readonly AgentEntity[]
  activeAgent: AgentEntity | null
  activeSession: AgentSessionEntity | null
  providers?: readonly SafeModelProvider[]
  /**
   * Shared runtime evidence for the active agent model.
   * - `undefined`: caller did not provide a compatibility map; static fallback is allowed.
   * - `null`: map is present but this model has no verified evidence yet; treat as unverified.
   * - result: use the shared runtime verdict.
   */
  compatibility?: AgentRuntimeCompatibilityResult | null
  gatewayEnabled?: boolean
  /** 模型服务页「默认智能体模型」：智能体没有显式绑定模型时，状态按它判断。 */
  defaultAgentModelId?: string
}

const UNCONFIGURED_MODEL_PREFIX = 'unconfigured:'
const UNVERIFIED_SUMMARY =
  'Claude Code runtime route has not been verified yet. Run a runtime connection check before using this model.'

export function resolveAgentPageStatus(input: ResolveAgentPageStatusInput): AgentPageStatus {
  const activeAgent = input.activeAgent
    ? applyDefaultAgentModel(input.activeAgent, input.providers ?? [], input.defaultAgentModelId)
    : null
  if (activeAgent) {
    if (input.compatibility === null) {
      if (isAgentModelUnavailable(activeAgent, input.providers ?? [])) {
        return {
          type: 'model-service-unavailable',
          reason: resolveModelServiceUnavailableReason(
            activeAgent,
            input.providers ?? [],
            input.defaultAgentModelId
          )
        }
      }
      // 没有运行时证据 ≠ 可以直接放行：主进程只对「默认端点就是 Messages」的供应商
      // 走直连；relay 供应商（首个端点是 chat-completions）在网关关闭时必须报
      // gateway-required，否则 UI 放行的会话一定在主进程失败。
      const derived = resolveActiveAgentCompatibility(
        activeAgent,
        input.providers ?? [],
        input.gatewayEnabled
      )
      if (derived) {
        const blocked = mapCompatibilityToBlockedStatus(derived)
        if (blocked) return blocked
      }
      // 静态可选中（原生 Messages 供应商）不单独放行：没有运行时证据时仍保留
      // 「未验证」保护，只有厂商声明才直接放行（见下方 fallback）。
      // 厂商声明（`messagesSupport === 'yes'`）已经证明可被智能体使用：
      // 不再要求先跑一次运行时检查，否则"能选中却打不开"。
      if (hasDeclaredAgentModelSupport(activeAgent, input.providers ?? [])) {
        return { type: 'ready' }
      }
      return { type: 'runtime-unverified', summary: UNVERIFIED_SUMMARY }
    }

    const compatibility =
      input.compatibility ??
      resolveActiveAgentCompatibility(activeAgent, input.providers ?? [], input.gatewayEnabled)

    if (compatibility) {
      const blocked = mapCompatibilityToBlockedStatus(compatibility)
      if (blocked) return blocked
    } else if (isAgentModelUnavailable(activeAgent, input.providers ?? [])) {
      return {
        type: 'model-service-unavailable',
        reason: resolveModelServiceUnavailableReason(
          activeAgent,
          input.providers ?? [],
          input.defaultAgentModelId
        )
      }
    }
  }

  if (input.agents.length === 0 || !input.activeAgent) {
    return { type: 'no-agents' }
  }

  if (!input.activeSession) {
    return { type: 'no-session' }
  }

  if (input.activeSession.agentId !== input.activeAgent.id) {
    return { type: 'orphan-session' }
  }

  return { type: 'ready' }
}

function mapCompatibilityToBlockedStatus(
  compatibility: AgentRuntimeCompatibilityResult
): AgentPageStatus | null {
  if (compatibility.selectable) return null

  if (compatibility.status === 'gateway-required') {
    return { type: 'gateway-required', summary: compatibility.summary }
  }
  if (compatibility.status === 'gateway-stopped') {
    return { type: 'gateway-stopped', summary: compatibility.summary }
  }
  if (compatibility.status === 'auth-failed') {
    return { type: 'direct-auth-failed', summary: compatibility.summary }
  }
  if (compatibility.status === 'unknown') {
    return { type: 'runtime-unverified', summary: compatibility.summary }
  }
  if (compatibility.status === 'provider-disabled') {
    return { type: 'model-service-unavailable', reason: 'provider-disabled' }
  }
  if (compatibility.status === 'missing-api-key') {
    return { type: 'model-service-unavailable', reason: 'provider-not-ready' }
  }
  if (compatibility.status === 'model-not-enabled') {
    return { type: 'model-service-unavailable', reason: 'model-incompatible' }
  }
  if (
    compatibility.status === 'protocol-unsupported' ||
    compatibility.status === 'missing-endpoint'
  ) {
    return {
      type: 'ordinary-chat-only',
      summary:
        compatibility.summary ||
        'Ordinary chat may work, but this model is not ready for Claude Code Agent runtime.'
    }
  }

  return { type: 'model-service-unavailable', reason: 'model-incompatible' }
}

/**
 * Why the model service cannot serve the active agent. The generic "not ready" screen was
 * unhelpful when a default model existed but its provider was disabled, missing a key, or no
 * longer contained that model — say which condition failed instead.
 */
function resolveModelServiceUnavailableReason(
  agent: AgentEntity,
  providers: readonly SafeModelProvider[],
  defaultAgentModelId: string | undefined
): ConfiguredModelUnavailableReason {
  const bound = agent.model?.trim() ?? ''
  const value = bound && !bound.startsWith(UNCONFIGURED_MODEL_PREFIX) ? bound : (defaultAgentModelId ?? '')
  const resolved = resolveConfiguredModel({
    value,
    providers,
    isModelAcceptable: (provider, model) => isAgentCompatibleModel(provider, model, agent.type)
  })
  return resolved.ok ? 'model-incompatible' : resolved.reason
}

/**
 * 智能体没有显式模型时，状态判断按「默认智能体模型」进行 —— 必须和
 * `resolveEffectiveAgentModel`（主进程运行期）同一判据，否则 UI 会挡住一个其实能跑的会话。
 */
function applyDefaultAgentModel(
  agent: AgentEntity,
  providers: readonly SafeModelProvider[],
  defaultAgentModelId: string | undefined
): AgentEntity {
  const modelId = (agent.model ?? '').trim()
  if (modelId && !modelId.startsWith(UNCONFIGURED_MODEL_PREFIX)) return agent
  if (!defaultAgentModelId?.trim()) return agent

  const resolved = resolveConfiguredAgentModel({
    providers,
    configuredDefaultModelId: defaultAgentModelId,
    agentType: agent.type
  })
  if (!resolved.ok) return agent

  return { ...agent, model: resolved.model, modelName: resolved.modelName }
}

function resolveActiveAgentCompatibility(
  agent: AgentEntity,
  providers: readonly SafeModelProvider[],
  gatewayEnabled?: boolean
): AgentRuntimeCompatibilityResult | null {
  const modelId = (agent.model ?? '').trim()
  if (!modelId || modelId.startsWith(UNCONFIGURED_MODEL_PREFIX)) return null

  const separatorIndex = modelId.indexOf(':')
  if (separatorIndex <= 0) return null

  const providerId = modelId.slice(0, separatorIndex)
  const provider = providers.find((item) => item.id === providerId)
  if (!provider) return null
  const model = provider.models.find((item) => item.id === modelId.slice(separatorIndex + 1))
  if (!model) return null

  return resolveAgentModelCompatibility(provider, model, agent.type, {
    requireReadyProvider: true,
    gatewayEnabled
  })
}

function isAgentModelUnavailable(agent: AgentEntity, providers: readonly SafeModelProvider[]): boolean {
  const modelId = (agent.model ?? '').trim()
  if (!modelId || modelId.startsWith(UNCONFIGURED_MODEL_PREFIX)) return true

  const separatorIndex = modelId.indexOf(':')
  if (separatorIndex <= 0) return false

  const providerId = modelId.slice(0, separatorIndex)
  const provider = providers.find((item) => item.id === providerId)
  if (!provider) return true
  const model = provider.models.find((item) => item.id === modelId.slice(separatorIndex + 1))
  if (!model) return true

  // 只按"供应商停用 / 缺 Key / 缺端点"判不可用；「未验证」不算不可用
  //（否则没跑过连接检查的供应商会把整个智能体页面挡在"模型服务尚未就绪"）。
  const strict = isAgentCompatibleModel(provider, model, agent.type, { requireReadyProvider: true })
  if (strict) return false
  const loose = isAgentCompatibleModel(provider, model, agent.type, { requireReadyProvider: false })
  return !loose
}

function hasDeclaredAgentModelSupport(agent: AgentEntity, providers: readonly SafeModelProvider[]): boolean {
  // 智能体上的模型字段是 `model`（`providerId:modelId`），不是 modelKey —— 读错字段就一直判成"未验证"。
  const key = (agent.model ?? '').trim()
  const [providerId, ...rest] = key.split(':')
  const modelId = rest.join(':')
  if (!providerId || !modelId) return false
  const model = providers
    .find((provider) => provider.id === providerId)
    ?.models.find((entry) => entry.id === modelId)
  return model === undefined ? false : hasDeclaredClaudeCodeSupport(model)
}
