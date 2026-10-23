import type { ModelDefinition, ModelProvider, SafeModelProvider } from '../../../providers/modelProviderTypes'
import { resolveProviderChatBase } from '../../../providers/providerChatEndpoints'
import { isProviderConnectionReady } from '../../../providers/providerStore'
import type {
  AgentRuntimeCompatibilityResult,
  AgentRuntimeCompatibilityStatus,
  AgentRuntimeId,
  AgentRuntimeProbeSnapshot,
  AgentRuntimeProbeStatus,
  AgentRuntimeRoute
} from './agentRuntimeCompatibilityTypes'

export type AgentRuntimeCompatibleProvider = ModelProvider | SafeModelProvider

export type ResolveAgentRuntimeCompatibilityInput = {
  provider: AgentRuntimeCompatibleProvider
  model: ModelDefinition
  runtimeId: AgentRuntimeId
  directProbe?: AgentRuntimeProbeSnapshot
  gatewayProbe?: AgentRuntimeProbeSnapshot
  gatewayEnabled?: boolean
  requireReadyProvider?: boolean
}

export function resolveAgentRuntimeCompatibility(
  input: ResolveAgentRuntimeCompatibilityInput
): AgentRuntimeCompatibilityResult {
  const base = {
    providerId: input.provider.id,
    modelId: input.model.id,
    runtimeId: input.runtimeId
  }

  if (input.runtimeId === 'openai-agents') {
    return resolveOpenAiAgentsCompatibility(input, base)
  }

  return resolveClaudeCodeCompatibility(input, base)
}

/** 该供应商是否暴露了 Anthropic Messages 端点（Claude Code 直接路由的前提）。 */
export function isClaudeCodeAnthropicEndpointProvider(provider: AgentRuntimeCompatibleProvider): boolean {
  return Boolean(resolveProviderChatBase(provider, 'messages'))
}

/** 默认端点就是 Messages（原生 Anthropic 形态）⇒ 可直接连 SDK，不用先跑探测。 */
export function isClaudeCodeNativeDirectProvider(provider: AgentRuntimeCompatibleProvider): boolean {
  return provider.endpoints[0]?.protocol === 'messages'
}

export function isChatModel(model: ModelDefinition): boolean {
  return Boolean(model.capabilities.chat && !model.capabilities.embedding)
}

/**
 * PLAT-82：厂商**声明**支持 Anthropic Messages（Claude Code 的强证据）。
 *
 * 声明是事实源：同步链只写 `messagesSupport` / `declarationSource`，检测不再写任何持久结论。
 * `probeStatus === 'passed'` 是迁移前真实探测留下的结论，只作历史兜底。
 */
export function hasDeclaredClaudeCodeSupport(model: ModelDefinition): boolean {
  if (model.messagesSupport === 'yes') return true
  // 明确声明不支持就不能被历史探测结论反转。
  if (model.messagesSupport === 'no') return false
  return model.probeStatus === 'passed'
}

export function hasClaudeCodeRuntimeCapability(model: ModelDefinition): boolean {
  if (model.capabilities.agentRuntimes?.claudeCode === true) return true
  // 兼容旧标记：列表里的「智能体」计数就是这么算的，
  // 两处口径必须一致，否则会出现"列表 59 个、下拉 1 个"。
  if (model.capabilities.agent === true) return true
  // 先看厂商声明（`declarationSource === 'provider_list'` + `messagesSupport`）：
  // 声明 `no` 也照样生效，不再被 legacy `probeStatus` 反转。
  if (model.messagesSupport === 'yes') return true
  if (model.messagesSupport === 'no') return false
  if (model.declarationSource === 'provider_list') return false
  // 再看迁移前的探测结论（新检测不再写 `probeStatus`）。
  return model.probeStatus === 'passed'
}

export function hasOpenAiAgentsRuntimeCapability(model: ModelDefinition): boolean {
  return model.capabilities.agentRuntimes?.openaiAgents === true
}

function resolveClaudeCodeCompatibility(
  input: ResolveAgentRuntimeCompatibilityInput,
  base: Pick<AgentRuntimeCompatibilityResult, 'providerId' | 'modelId' | 'runtimeId'>
): AgentRuntimeCompatibilityResult {
  if (!isChatModel(input.model)) {
    return buildResult(base, {
      selectable: false,
      route: 'none',
      status: 'model-not-enabled',
      summary: 'Only chat models can be used with Claude Code agents.'
    })
  }

  if (input.requireReadyProvider && !isProviderConnectionReady(input.provider)) {
    const status: AgentRuntimeCompatibilityStatus = input.provider.enabled ? 'missing-api-key' : 'provider-disabled'
    return buildResult(base, {
      selectable: false,
      route: 'none',
      status,
      summary:
        status === 'provider-disabled'
          ? 'Provider is disabled.'
          : 'Provider is missing an API key or base URL.'
    })
  }

  if (!hasClaudeCodeRuntimeCapability(input.model)) {
    return buildResult(base, {
      selectable: false,
      route: 'none',
      status: 'model-not-enabled',
      summary: 'Model is not enabled for Claude Code agent runtime.'
    })
  }

  const hasAnthropicEndpoint = isClaudeCodeAnthropicEndpointProvider(input.provider)
  const gatewayEnabled = input.gatewayEnabled === true

  const nativeDirect = isClaudeCodeNativeDirectProvider(input.provider)
  const probeDirectReady = hasAnthropicEndpoint && input.directProbe?.status === 'ready'
  /**
   * A vendor declaration plus a configured Messages endpoint is enough to route directly unless
   * the probe produced *conclusive* contrary evidence. A 429 / timeout / network error says
   * nothing about whether the Messages endpoint works, so it must not force the gateway.
   */
  const declaredDirectReady =
    hasAnthropicEndpoint &&
    hasDeclaredClaudeCodeSupport(input.model) &&
    !isConclusiveDirectFailure(input.directProbe?.status)

  const directSdkReady = nativeDirect || probeDirectReady || declaredDirectReady

  if (!directSdkReady && !gatewayEnabled) {
    return buildResult(base, {
      selectable: false,
      route: hasAnthropicEndpoint ? 'gateway' : 'none',
      status: hasAnthropicEndpoint ? 'gateway-required' : 'missing-endpoint',
      summary: hasAnthropicEndpoint
        ? 'This provider exposes an Anthropic-shaped endpoint, but Claude Code Agent runtime must use the local agent gateway route.'
        : 'Claude Code agents require a native Anthropic provider or an enabled agent gateway.'
    })
  }

  const probeDecision = resolveProbeRouteDecision(input, directSdkReady, gatewayEnabled)
  if (probeDecision) {
    return buildResult(base, probeDecision)
  }

  if (directSdkReady) {
    return buildResult(base, {
      selectable: true,
      route: 'direct',
      status: 'ready',
      summary: 'Model is configured for direct Claude Code runtime.'
    })
  }

  return buildResult(base, {
    selectable: false,
    route: 'none',
    status: 'gateway-required',
    summary: 'Ordinary chat may work, but Claude Code requires the agent gateway route.'
  })
}

function resolveOpenAiAgentsCompatibility(
  input: ResolveAgentRuntimeCompatibilityInput,
  base: Pick<AgentRuntimeCompatibilityResult, 'providerId' | 'modelId' | 'runtimeId'>
): AgentRuntimeCompatibilityResult {
  if (!isChatModel(input.model)) {
    return buildResult(base, {
      selectable: false,
      route: 'none',
      status: 'model-not-enabled',
      summary: 'Only chat models can be used with OpenAI Agents runtime.'
    })
  }

  if (input.requireReadyProvider && !isProviderConnectionReady(input.provider)) {
    const status: AgentRuntimeCompatibilityStatus = input.provider.enabled ? 'missing-api-key' : 'provider-disabled'
    return buildResult(base, {
      selectable: false,
      route: 'none',
      status,
      summary:
        status === 'provider-disabled'
          ? 'Provider is disabled.'
          : 'Provider is missing an API key or base URL.'
    })
  }

  if (!hasOpenAiAgentsRuntimeCapability(input.model)) {
    return buildResult(base, {
      selectable: false,
      route: 'none',
      status: 'model-not-enabled',
      summary: 'Model is not enabled for OpenAI Agents runtime.'
    })
  }

  return buildResult(base, {
    selectable: false,
    route: 'none',
    status: 'unknown',
    summary: 'OpenAI Agents runtime support is reserved and not available yet.'
  })
}

function resolveProbeRouteDecision(
  input: ResolveAgentRuntimeCompatibilityInput,
  directSdkReady: boolean,
  gatewayEnabled: boolean
): Pick<AgentRuntimeCompatibilityResult, 'selectable' | 'route' | 'status' | 'summary' | 'checkedAt'> | null {
  const { directProbe, gatewayProbe } = input
  if (!directProbe && !gatewayProbe) {
    return null
  }

  // A rate-limited / timed-out / network-failed direct probe is inconclusive, not a route
  // rejection. When the vendor declares Messages support and the gateway is off, fall through
  // to the direct-ready result instead of blocking the agent on a transient probe error.
  if (
    directProbe &&
    directSdkReady &&
    !gatewayEnabled &&
    directProbe.status !== 'ready' &&
    !isConclusiveDirectFailure(directProbe.status)
  ) {
    return null
  }

  if (directProbe?.status === 'ready' && directSdkReady) {
    return {
      selectable: true,
      route: 'direct',
      status: 'ready',
      summary: directProbe.message ?? 'Direct Claude Code runtime probe passed.',
      checkedAt: directProbe.checkedAt
    }
  }

  if (gatewayProbe?.status === 'ready') {
    return {
      selectable: true,
      route: 'gateway',
      status: 'ready',
      summary: gatewayProbe.message ?? 'Agent gateway runtime probe passed.',
      checkedAt: gatewayProbe.checkedAt
    }
  }

  if (directProbe) {
    const directFailure = mapProbeFailure(directProbe)
    if (gatewayEnabled) {
      if (gatewayProbe) {
        if (isGatewayStoppedProbe(gatewayProbe)) {
          return {
            selectable: false,
            route: 'gateway',
            status: 'gateway-stopped',
            summary: gatewayProbe.message ?? 'Agent model gateway is stopped.',
            checkedAt: gatewayProbe.checkedAt
          }
        }
        const gatewayFailure = mapProbeFailure(gatewayProbe)
        return {
          selectable: false,
          route: 'gateway',
          status: gatewayFailure.status,
          summary: `Direct Claude Code route failed (${directFailure.summary}). Gateway route also failed (${gatewayFailure.summary}).`,
          checkedAt: gatewayProbe.checkedAt ?? directProbe.checkedAt
        }
      }

      return {
        selectable: false,
        route: 'gateway',
        status: 'gateway-required',
        summary: `Direct Claude Code route failed (${directFailure.summary}). Agent gateway probe is required.`,
        checkedAt: directProbe.checkedAt
      }
    }

    if (directSdkReady) {
      return {
        selectable: false,
        route: 'none',
        status: directFailure.status,
        summary: directFailure.summary,
        checkedAt: directProbe.checkedAt
      }
    }

    return {
      selectable: false,
      route: 'gateway',
      status: 'gateway-required',
      summary: `Claude Code runtime is not ready (${directFailure.summary}). Enable the agent gateway to route this provider.`,
      checkedAt: directProbe.checkedAt
    }
  }

  if (gatewayProbe) {
    const gatewayFailure = mapProbeFailure(gatewayProbe)
    const stopped = isGatewayStoppedProbe(gatewayProbe)
    return {
      selectable: false,
      route: gatewayEnabled ? 'gateway' : 'none',
      status: stopped ? 'gateway-stopped' : gatewayFailure.status,
      summary: stopped
        ? (gatewayProbe.message ?? 'Agent model gateway is stopped.')
        : gatewayFailure.summary,
      checkedAt: gatewayProbe.checkedAt
    }
  }

  return null
}

function isConclusiveDirectFailure(status: AgentRuntimeProbeStatus | undefined): boolean {
  return status === 'auth-failed' || status === 'forbidden' || status === 'protocol-unsupported'
}

function isGatewayStoppedProbe(probe: AgentRuntimeProbeSnapshot): boolean {
  if (probe.route !== 'gateway') return false
  const message = probe.message?.toLowerCase() ?? ''
  return message.includes('stopped') || message.includes('disabled')
}

function mapProbeFailure(probe: AgentRuntimeProbeSnapshot): {
  status: AgentRuntimeCompatibilityStatus
  summary: string
} {
  switch (probe.status) {
    case 'auth-failed':
      return {
        status: 'auth-failed',
        summary: probe.message ?? 'Agent runtime authentication failed for this provider route.'
      }
    case 'forbidden':
      return {
        status: 'forbidden',
        summary: probe.message ?? 'Agent runtime access was denied for this provider route.'
      }
    case 'protocol-unsupported':
      return {
        status: 'protocol-unsupported',
        summary: probe.message ?? 'Provider endpoint did not satisfy Claude Code runtime protocol expectations.'
      }
    case 'timeout':
      return {
        status: 'probe-timeout',
        summary: probe.message ?? 'Agent runtime probe timed out.'
      }
    case 'network-error':
      return {
        status: 'unknown',
        summary: probe.message ?? 'Agent runtime probe failed due to a network error.'
      }
    case 'unknown':
    default:
      return {
        status: 'unknown',
        summary: probe.message ?? 'Agent runtime probe failed with an unknown error.'
      }
  }
}

function buildResult(
  base: Pick<AgentRuntimeCompatibilityResult, 'providerId' | 'modelId' | 'runtimeId'>,
  decision: Pick<AgentRuntimeCompatibilityResult, 'selectable' | 'route' | 'status' | 'summary' | 'checkedAt'>
): AgentRuntimeCompatibilityResult {
  return {
    ...base,
    selectable: decision.selectable,
    route: decision.route,
    status: decision.status,
    summary: decision.summary,
    ...(decision.checkedAt ? { checkedAt: decision.checkedAt } : {})
  }
}

export function agentTypeToRuntimeId(agentType: string | undefined): AgentRuntimeId | null {
  if (agentType === 'claude-code') return 'claude-code'
  if (agentType === 'openai-agents') return 'openai-agents'
  return null
}

export function isLegacyPermissiveAgentType(agentType: string | undefined): boolean {
  return agentTypeToRuntimeId(agentType) === null
}

export function resolveLegacyAgentCompatibility(
  provider: AgentRuntimeCompatibleProvider,
  model: ModelDefinition,
  requireReadyProvider: boolean
): boolean {
  if (!isChatModel(model)) return false
  if (requireReadyProvider && !isProviderConnectionReady(provider)) return false
  return true
}

export function isAgentRuntimeSelectable(
  input: ResolveAgentRuntimeCompatibilityInput,
  agentType: string | undefined = 'claude-code'
): boolean {
  if (isLegacyPermissiveAgentType(agentType)) {
    return resolveLegacyAgentCompatibility(input.provider, input.model, input.requireReadyProvider === true)
  }

  return resolveAgentRuntimeCompatibility({
    ...input,
    runtimeId: agentTypeToRuntimeId(agentType) ?? 'claude-code'
  }).selectable
}

export function isAgentRuntimeProviderCompatible(
  provider: AgentRuntimeCompatibleProvider,
  agentType: string | undefined = 'claude-code',
  requireReadyProvider = false
): boolean {
  if (isLegacyPermissiveAgentType(agentType)) {
    return !requireReadyProvider || isProviderConnectionReady(provider)
  }

  if (agentType === 'openai-agents') {
    return !requireReadyProvider || isProviderConnectionReady(provider)
  }

  if (requireReadyProvider && !isProviderConnectionReady(provider)) {
    return false
  }

  return isClaudeCodeAnthropicEndpointProvider(provider)
}
