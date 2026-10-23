import type { AgentType } from '../schemas/agentSchemas'
import type { ModelDefinition, ModelProvider, SafeModelProvider } from '../../providers/modelProviderTypes'
import {
  isAgentRuntimeProviderCompatible,
  isClaudeCodeAnthropicEndpointProvider,
  isChatModel,
  hasClaudeCodeRuntimeCapability,
  hasOpenAiAgentsRuntimeCapability,
  resolveAgentRuntimeCompatibility
} from '../runtime/compatibility'
import type { AgentRuntimeId, AgentRuntimeProbeSnapshot } from '../runtime/compatibility/agentRuntimeCompatibilityTypes'

export type AgentModelCompatibilityOptions = {
  requireReadyProvider?: boolean
  directProbe?: AgentRuntimeProbeSnapshot
  gatewayProbe?: AgentRuntimeProbeSnapshot
  gatewayEnabled?: boolean
}

export type AgentModelCompatibleProvider = ModelProvider | SafeModelProvider

export function isAgentCompatibleProvider(
  provider: AgentModelCompatibleProvider,
  agentType: AgentType | string | undefined = 'claude-code',
  options: AgentModelCompatibilityOptions = {}
): boolean {
  return isAgentRuntimeProviderCompatible(provider, agentType, options.requireReadyProvider === true)
}

export function isAgentCompatibleModel(
  provider: AgentModelCompatibleProvider,
  model: ModelDefinition,
  agentType: AgentType | string | undefined = 'claude-code',
  options: AgentModelCompatibilityOptions = {}
): boolean {
  if (!isAgentCompatibleProvider(provider, agentType, options)) return false
  if (!isChatModel(model)) return false

  const runtimeId = toRuntimeId(agentType)
  if (runtimeId === 'openai-agents') {
    return hasOpenAiAgentsRuntimeCapability(model)
  }

  return hasClaudeCodeRuntimeCapability(model)
}

export function isClaudeCodeCompatibleModel(provider: AgentModelCompatibleProvider, model: ModelDefinition): boolean {
  void provider
  if (!isChatModel(model)) return false
  return hasClaudeCodeRuntimeCapability(model)
}

export function resolveAgentModelCompatibility(
  provider: AgentModelCompatibleProvider,
  model: ModelDefinition,
  agentType: AgentType | string | undefined = 'claude-code',
  options: AgentModelCompatibilityOptions = {}
) {
  return resolveAgentRuntimeCompatibility({
    provider,
    model,
    runtimeId: toRuntimeId(agentType),
    requireReadyProvider: options.requireReadyProvider,
    directProbe: options.directProbe,
    gatewayProbe: options.gatewayProbe,
    gatewayEnabled: options.gatewayEnabled
  })
}

export { isClaudeCodeAnthropicEndpointProvider }

function toRuntimeId(agentType: AgentType | string | undefined): AgentRuntimeId {
  if (agentType === 'openai-agents') return 'openai-agents'
  return 'claude-code'
}
