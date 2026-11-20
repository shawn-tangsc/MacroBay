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
