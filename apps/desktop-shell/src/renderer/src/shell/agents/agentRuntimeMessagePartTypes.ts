import type { AgentContextMessagePart } from '@platform/ai/agent-platform/schemas/sessionSchemas'

import type { AgentRuntimeActivityStatus } from './agentRuntimeActivityViewModel'
import type { AgentRuntimeResultPreviewCard } from './agentRuntimeResultPreview'

export type AgentRuntimeMessagePartText = {
  key: string
  kind: 'text'
  text: string
}

export type AgentRuntimeMessagePartContext = {
  key: string
  kind: 'context'
  part: AgentContextMessagePart
}

export type AgentRuntimeMessagePartRuntime = {
  key: string
  kind: 'runtime'
  runtimeKind: 'reasoning' | 'tool-call' | 'tool-result' | 'control'
  title: string
  subtitle: string
  status: AgentRuntimeActivityStatus
  detail: string | null
  /** The request payload behind a tool row, folded separately from the result. */
  requestDetail?: string | null
  details?: AgentRuntimeMessagePartDetail[]
  resultCards?: AgentRuntimeResultPreviewCard[]
}

export type AgentRuntimeMessagePartCommand = {
  key: string
  kind: 'command'
  command: string
  title: string
  summary: string
  rows: Array<{ label: string; value: string }>
}

export type AgentRuntimeMessagePartBlock =
  | AgentRuntimeMessagePartText
  | AgentRuntimeMessagePartContext
  | AgentRuntimeMessagePartRuntime
  | AgentRuntimeMessagePartCommand

export type AgentRuntimeMessagePartDetail = {
  label: string
  text: string
  items?: AgentRuntimeMessagePartDetailItem[]
}

export type AgentRuntimeMessagePartDetailItem = {
  kind: 'text' | 'media' | 'resource' | 'json'
  title: string
  meta?: string
  text?: string
  previewUrl?: string
  openTarget?: string
  openTargetKind?: 'external' | 'path'
}
