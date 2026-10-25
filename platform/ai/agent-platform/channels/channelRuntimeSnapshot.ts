import type { AgentChannelEntity } from '../schemas/channelSchemas'
import type {
  AgentChannelRuntimeCredentialState,
  AgentChannelRuntimeErrorKind,
  AgentChannelRuntimeLifecycleState,
  AgentChannelRuntimeSessionState
} from './channelRuntimeHost'

export type AgentChannelRuntimeState = 'connected' | 'connecting' | 'error' | 'inactive'

export type AgentChannelRuntimeSnapshotEntry = {
  channelId: string
  type: AgentChannelEntity['type']
  agentId: string | null
  sessionId: string | null
  isActive: boolean
  activeChatCount: number
  runtimeState: AgentChannelRuntimeState
  runtimeMessage?: string
  runtimeErrorKind?: AgentChannelRuntimeErrorKind
  runtimeRetryable?: boolean
  runtimeLifecycleState?: AgentChannelRuntimeLifecycleState
  credentialState?: AgentChannelRuntimeCredentialState
  credentialHint?: string
  credentialUrl?: string
  credentialQrText?: string
  credentialExpiresAt?: number
  sessionState?: AgentChannelRuntimeSessionState
  lastCheckedAt?: number
  updatedAt: number
}

export type AgentChannelRuntimeSnapshot = {
  channels: AgentChannelRuntimeSnapshotEntry[]
}
