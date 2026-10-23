export type AgentModelGatewayState = 'disabled' | 'starting' | 'running' | 'stopped' | 'error'

export type AgentModelGatewaySnapshot = {
  enabled: boolean
  state: AgentModelGatewayState
  port: number
  baseUrl?: string
  message?: string
  updatedAt: string
}

export type AgentModelGatewayProviderConfig = {
  providerId: string
  modelId: string
  apiType: 'anthropic-messages' | 'openai-chat-completions' | 'openai-responses'
  upstreamBaseUrl: string
  hasUpstreamApiKey: boolean
  configVersion: string
  updatedAt: string
}

export type AgentModelGatewayOperationResult =
  | {
      ok: true
      snapshot: AgentModelGatewaySnapshot
    }
  | {
      ok: false
      snapshot: AgentModelGatewaySnapshot
      message: string
    }
