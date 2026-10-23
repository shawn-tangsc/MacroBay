export type AgentRuntimeId = 'claude-code' | 'openai-agents'

export type AgentRuntimeRoute = 'direct' | 'gateway' | 'openai-agents' | 'none'

export type AgentRuntimeProbeStatus =
  | 'ready'
  | 'auth-failed'
  | 'forbidden'
  | 'protocol-unsupported'
  | 'timeout'
  | 'network-error'
  | 'unknown'

export type AgentRuntimeProbeSnapshot = {
  status: AgentRuntimeProbeStatus
  route: 'direct' | 'gateway'
  providerId: string
  modelId: string
  runtimeId: AgentRuntimeId
  signature: string
  checkedAt: string
  message?: string
}

export type AgentRuntimeCompatibilityStatus =
  | 'ready'
  | 'gateway-required'
  | 'provider-disabled'
  | 'missing-api-key'
  | 'missing-endpoint'
  | 'model-not-enabled'
  | 'auth-failed'
  | 'forbidden'
  | 'protocol-unsupported'
  | 'probe-timeout'
  | 'gateway-stopped'
  | 'unknown'

export type AgentRuntimeCompatibilityResult = {
  providerId: string
  modelId: string
  runtimeId: AgentRuntimeId
  selectable: boolean
  route: AgentRuntimeRoute
  status: AgentRuntimeCompatibilityStatus
  summary: string
  checkedAt?: string
}
