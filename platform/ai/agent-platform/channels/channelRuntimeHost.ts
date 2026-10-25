import type { AgentChannelEntity } from '../schemas/channelSchemas'

export type AgentChannelRuntimeErrorKind =
  | 'config'
  | 'dependency'
  | 'auth'
  | 'transient'
  | 'abort'

export type AgentChannelRuntimeLifecycleState =
  | 'connecting'
  | 'awaiting-credential'
  | 'awaiting-qr-scan'
  | 'ready'
  | 'reconnecting'
  | 'session-expired'
  | 'terminal-error'

export type AgentChannelRuntimeCredentialState =
  | 'not-required'
  | 'required'
  | 'captured'
  | 'expired'

export type AgentChannelRuntimeSessionState =
  | 'unknown'
  | 'active'
  | 'reconnecting'
  | 'expired'

export type AgentChannelRuntimeStatusUpdate = {
  runtimeState?: 'connected' | 'connecting' | 'error' | null
  message?: string | null
  errorKind?: AgentChannelRuntimeErrorKind | null
  retryable?: boolean | null
  lifecycleState?: AgentChannelRuntimeLifecycleState | null
  credentialState?: AgentChannelRuntimeCredentialState | null
  credentialHint?: string | null
  credentialUrl?: string | null
  credentialQrText?: string | null
  credentialExpiresAt?: number | null
  sessionState?: AgentChannelRuntimeSessionState | null
  nextConfig?: AgentChannelEntity['config']
  requestReconnect?: boolean
  lastCheckedAt?: number | null
}

export type AgentChannelIncomingAttachment = {
  kind: 'image' | 'file'
  name: string
  mimeType: string
  data: string
}

export type AgentChannelIncomingTextEvent = {
  agentId: string
  channelId: string
  chatId: string
  channelType?: AgentChannelEntity['type']
  userId?: string
  userName?: string
  text: string
  attachments?: AgentChannelIncomingAttachment[]
}

export type AgentChannelRuntimeHostContext = {
  handleIncomingText?: (input: AgentChannelIncomingTextEvent) => Promise<void>
}

export type AgentChannelRuntimeHost = {
  connect: () => Promise<void>
  close: () => Promise<void>
  subscribeToRuntimeStatus?: (
    listener: (status: AgentChannelRuntimeStatusUpdate) => void
  ) => (() => void) | void
  sendMessage?: (chatId: string, text: string) => Promise<void>
  sendTypingIndicator?: (chatId: string) => Promise<void>
  onTextPatchUpdate?: (
    chatId: string,
    patch: {
      text: string
      textDelta: string
      mode: 'append' | 'replace'
      redacted: boolean
    }
  ) => Promise<void>
  onTextUpdate?: (chatId: string, text: string) => Promise<void>
  onStreamComplete?: (chatId: string, finalText: string) => Promise<boolean>
  onStreamError?: (chatId: string, errorText: string) => Promise<void>
}

export type AgentChannelRuntimeHostFactory = (
  channel: AgentChannelEntity,
  context: AgentChannelRuntimeHostContext
) => Promise<AgentChannelRuntimeHost>
