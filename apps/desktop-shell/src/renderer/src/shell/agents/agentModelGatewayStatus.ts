export type AgentModelGatewayUiState = 'disabled' | 'starting' | 'running' | 'stopped' | 'error'

export type AgentModelGatewayUiSnapshot = {
  enabled: boolean
  state: AgentModelGatewayUiState
  port: number
  baseUrl?: string
  message?: string
  updatedAt: string
}

export type AgentModelGatewayStatusView = {
  state: AgentModelGatewayUiState
  tone: 'neutral' | 'success' | 'warning' | 'danger'
  canEnable: boolean
  canStart: boolean
  canStop: boolean
}

export function resolveAgentModelGatewayStatusView(
  snapshot: AgentModelGatewayUiSnapshot | null | undefined
): AgentModelGatewayStatusView {
  if (!snapshot || !snapshot.enabled) {
    return {
      state: 'disabled',
      tone: 'neutral',
      canEnable: true,
      canStart: false,
      canStop: false
    }
  }

  switch (snapshot.state) {
    case 'running':
      return {
        state: 'running',
        tone: 'success',
        canEnable: true,
        canStart: false,
        canStop: true
      }
    case 'starting':
      return {
        state: 'starting',
        tone: 'warning',
        canEnable: true,
        canStart: false,
        canStop: true
      }
    case 'error':
      return {
        state: 'error',
        tone: 'danger',
        canEnable: true,
        canStart: true,
        canStop: true
      }
    case 'stopped':
    default:
      return {
        state: 'stopped',
        tone: 'warning',
        canEnable: true,
        canStart: true,
        canStop: false
      }
  }
}

export function isAgentModelGatewaySnapshot(value: unknown): value is AgentModelGatewayUiSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<AgentModelGatewayUiSnapshot>
  return (
    typeof snapshot.enabled === 'boolean' &&
    typeof snapshot.state === 'string' &&
    typeof snapshot.port === 'number' &&
    typeof snapshot.updatedAt === 'string'
  )
}
