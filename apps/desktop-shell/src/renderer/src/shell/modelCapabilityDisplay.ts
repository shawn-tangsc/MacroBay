import type { ModelCapabilities, ModelDefinition } from '@platform/ai/providers/modelProviderTypes'

export type ModelTypeCapabilityId =
  | 'chat'
  | 'tools'
  | 'vision'
  | 'reasoning'
  | 'embedding'
  | 'rerank'
  | 'imageGeneration'
  | 'videoGeneration'
  | 'speech'
  | 'transcription'
  | 'ocr'
export type AgentRuntimeCapabilityId = keyof NonNullable<ModelCapabilities['agentRuntimes']>

export type ModelTypeCapabilityLabelKey =
  | 'chat'
  | 'tools'
  | 'vision'
  | 'reasoning'
  | 'embedding'
  | 'rerank'
  | 'imageGeneration'
  | 'videoGeneration'
  | 'speech'
  | 'transcription'
  | 'ocr'
export type AgentRuntimeCapabilityLabelKey = 'claudeCodeAgent' | 'openaiAgents'

export type AgentRuntimeRouteLabelKey =
  | 'directClaudeCode'
  | 'gatewayClaudeCode'
  | 'gatewayRequired'
  | 'openaiAgentsOnly'
  | 'ordinaryChatOnly'

export type CapabilityOption<TValue extends string, TLabel extends string = string> = {
  value: TValue
  labelKey: TLabel
}

export const modelTypeCapabilityOptions: Array<CapabilityOption<ModelTypeCapabilityId, ModelTypeCapabilityLabelKey>> = [
  { value: 'chat', labelKey: 'chat' },
  { value: 'tools', labelKey: 'tools' },
  { value: 'vision', labelKey: 'vision' },
  { value: 'reasoning', labelKey: 'reasoning' },
  { value: 'embedding', labelKey: 'embedding' },
  { value: 'rerank', labelKey: 'rerank' },
  { value: 'imageGeneration', labelKey: 'imageGeneration' },
  { value: 'videoGeneration', labelKey: 'videoGeneration' },
  { value: 'speech', labelKey: 'speech' },
  { value: 'transcription', labelKey: 'transcription' },
  { value: 'ocr', labelKey: 'ocr' }
]

export const agentRuntimeCapabilityOptions: Array<CapabilityOption<AgentRuntimeCapabilityId, AgentRuntimeCapabilityLabelKey>> = [
  { value: 'claudeCode', labelKey: 'claudeCodeAgent' },
  { value: 'openaiAgents', labelKey: 'openaiAgents' }
]

export type ModelCapabilitySections = {
  modelTypes: Array<CapabilityOption<ModelTypeCapabilityId, ModelTypeCapabilityLabelKey>>
  agentProtocols: Array<CapabilityOption<AgentRuntimeCapabilityId, AgentRuntimeCapabilityLabelKey>>
}

export type EnabledAgentRuntimeTag = CapabilityOption<AgentRuntimeCapabilityId, AgentRuntimeCapabilityLabelKey>

export function createModelCapabilitySections(): ModelCapabilitySections {
  return {
    modelTypes: [...modelTypeCapabilityOptions],
    agentProtocols: [...agentRuntimeCapabilityOptions]
  }
}

export function getSelectedModelTypeCapabilities(capabilities: ModelCapabilities): ModelTypeCapabilityId[] {
  return modelTypeCapabilityOptions.filter((option) => capabilities[option.value]).map((option) => option.value)
}

export function applyModelTypeCapabilities(
  capabilities: ModelCapabilities,
  selectedModelTypes: readonly ModelTypeCapabilityId[]
): ModelCapabilities {
  const selected = new Set(selectedModelTypes)
  const next: ModelCapabilities = { chat: selected.has('chat') }
  for (const option of modelTypeCapabilityOptions) {
    if (option.value !== 'chat' && selected.has(option.value)) next[option.value] = true
  }
  if (capabilities.agentRuntimes) next.agentRuntimes = { ...capabilities.agentRuntimes }
  return next
}

export function listEnabledAgentRuntimeTags(model: ModelDefinition): EnabledAgentRuntimeTag[] {
  return agentRuntimeCapabilityOptions.filter((option) => model.capabilities.agentRuntimes?.[option.value] === true)
}

export function describeAgentRuntimeRouteLabel(input: {
  claudeCodeEnabled?: boolean
  openaiAgentsEnabled?: boolean
  route?: 'direct' | 'gateway' | 'openai-agents' | 'none'
  status?: string
}): AgentRuntimeRouteLabelKey | null {
  if (input.route === 'direct') return 'directClaudeCode'
  if (input.route === 'gateway') return 'gatewayClaudeCode'
  if (input.status === 'gateway-required') return 'gatewayRequired'
  if (input.openaiAgentsEnabled && !input.claudeCodeEnabled) return 'openaiAgentsOnly'
  if (!input.claudeCodeEnabled && !input.openaiAgentsEnabled) return 'ordinaryChatOnly'
  return null
}
