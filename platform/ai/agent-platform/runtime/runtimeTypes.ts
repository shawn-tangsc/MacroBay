import type { AgentType } from '../schemas/agentSchemas'
import type { ScheduledTaskEntity } from '../schemas/taskSchemas'
import type { AgentChatRuntimeRequest, AgentChatRuntimeResult } from './agentChatRuntime'
import type { AgentRuntimeComposition } from './AgentRuntimeCompositionService'
import type { PendingToolApproval, ToolApprovalDecision } from './policy'

export const agentSessionRuntimeTerminalStatuses = ['success', 'paused', 'error'] as const
export type AgentSessionRuntimeTerminalStatus = (typeof agentSessionRuntimeTerminalStatuses)[number]

export const agentSessionRuntimeTurnStates = ['idle', 'queued', 'running', 'stopping'] as const
export type AgentSessionRuntimeTurnState = (typeof agentSessionRuntimeTurnStates)[number]

export const agentSessionRuntimeTurnPhases = [
  'idle',
  'queued',
  'resolving-context',
  'opening-stream',
  'streaming',
  'pausing',
  'finishing'
] as const
export type AgentSessionRuntimeTurnPhase = (typeof agentSessionRuntimeTurnPhases)[number]

export const agentSessionRuntimeWarmStates = ['cold', 'warming', 'warm', 'error'] as const
export type AgentSessionRuntimeWarmState = (typeof agentSessionRuntimeWarmStates)[number]

export const agentRuntimeStopReasonKinds = ['interrupt', 'user-stop', 'runtime-stop'] as const
export type AgentRuntimeStopReasonKind = (typeof agentRuntimeStopReasonKinds)[number]

export type AgentRuntimeStopReason = {
  kind: AgentRuntimeStopReasonKind
  message?: string
}

export type AgentRuntimeResumeTokenSource = 'runtime' | 'persisted'

export type AgentSessionRuntimeState = {
  sessionId: string
  agentId: string | null
  agentType: AgentType | null
  inflightRequestCount: number
  queuedTurnCount: number
  turnState: AgentSessionRuntimeTurnState
  turnPhase: AgentSessionRuntimeTurnPhase
  warmState: AgentSessionRuntimeWarmState
  traceId: string | null
  lastRunId: string | null
  lastResumeToken: string | null
  lastResumeTokenSource: AgentRuntimeResumeTokenSource | null
  lastTerminalStatus: AgentSessionRuntimeTerminalStatus | null
  lastStopReason: AgentRuntimeStopReason | null
  lastWarmAt: string | null
  lastWarmResultMessage: string | null
  updatedAt: string
}

export type AgentSessionRuntimeStateBySessionId = Record<string, AgentSessionRuntimeState>

export type AgentSessionToolApproval = Omit<PendingToolApproval, 'result'>

export type AgentSessionToolApprovalDecisionRecord = AgentSessionToolApproval & {
  decision: ToolApprovalDecision['behavior']
  updatedInput?: unknown
  message?: string
  resolvedAt: string
  resolutionSource: 'user' | 'session-stop' | 'runtime-dispose'
}

export type AgentRuntimeToolApprovalRequestChunk = {
  type: 'tool-approval-request'
  approvalId: string
  sessionId: string
  toolCallId: string
  providerMetadata: {
    claudeAgent: {
      transport: 'claude-agent'
      toolName: string
    }
  }
}

export type AgentRuntimeToolApprovalResolvedChunk = {
  type: 'tool-approval-resolved'
  approvalId: string
  sessionId: string
  toolCallId: string
  toolName: string
  decision: ToolApprovalDecision['behavior']
  updatedInput?: unknown
  message?: string
}

export type AgentRuntimeAssistantTextUpdateChunk = {
  type: 'assistant-text-update'
  sessionId: string
  runId: string
  text: string
  textDelta: string
  mode: 'append' | 'replace'
}

export type AgentRuntimeReasoningStartChunk = {
  type: 'reasoning-start'
  sessionId: string
  runId: string
  partId: string
}

export type AgentRuntimeReasoningDeltaChunk = {
  type: 'reasoning-delta'
  sessionId: string
  runId: string
  partId: string
  delta: string
}

export type AgentRuntimeReasoningEndChunk = {
  type: 'reasoning-end'
  sessionId: string
  runId: string
  partId: string
}

export type AgentRuntimeControlChunk = {
  type: 'runtime-control'
  sessionId: string
  runId: string
  source: 'claude-agent-sdk'
  subtype: string
  message?: string
}

export type AgentRuntimeToolInputStartChunk = {
  type: 'tool-input-start'
  sessionId: string
  toolCallId: string
  toolName: string
}

export type AgentRuntimeToolInputDeltaChunk = {
  type: 'tool-input-delta'
  sessionId: string
  toolCallId: string
  inputTextDelta: string
}

export type AgentRuntimeToolInputAvailableChunk = {
  type: 'tool-input-available'
  sessionId: string
  toolCallId: string
  toolName: string
  input: unknown
}

export type AgentRuntimeToolOutputAvailableChunk = {
  type: 'tool-output-available'
  sessionId: string
  toolCallId: string
  output: unknown
}

export type AgentRuntimeToolOutputErrorChunk = {
  type: 'tool-output-error'
  sessionId: string
  toolCallId: string
  errorText: string
}

export type AgentRuntimeToolOutputDeniedChunk = {
  type: 'tool-output-denied'
  sessionId: string
  toolCallId: string
  message: string
}

export type AgentRuntimeProductToolCallStartChunk = {
  type: 'product-tool-call-start'
  sessionId: string
  toolCallId: string
  productId: string
  toolName: string
  asOf?: string
}

export type AgentRuntimeProductToolCallFinishChunk = {
  type: 'product-tool-call-finish'
  sessionId: string
  toolCallId: string
  productId: string
  toolName: string
  status: 'completed' | 'failed' | 'timeout' | 'denied' | 'cancelled'
  durationMs?: number
  outputHash?: string
  errorCode?: string
}

export type AgentRuntimeSessionChunk =
  | AgentRuntimeAssistantTextUpdateChunk
  | AgentRuntimeReasoningStartChunk
  | AgentRuntimeReasoningDeltaChunk
  | AgentRuntimeReasoningEndChunk
  | AgentRuntimeControlChunk
  | AgentRuntimeToolApprovalRequestChunk
  | AgentRuntimeToolApprovalResolvedChunk
  | AgentRuntimeToolInputStartChunk
  | AgentRuntimeToolInputDeltaChunk
  | AgentRuntimeToolInputAvailableChunk
  | AgentRuntimeToolOutputAvailableChunk
  | AgentRuntimeToolOutputErrorChunk
  | AgentRuntimeToolOutputDeniedChunk
  | AgentRuntimeProductToolCallStartChunk
  | AgentRuntimeProductToolCallFinishChunk

export type AgentSessionRuntimeSnapshot = {
  sessions: AgentSessionRuntimeStateBySessionId
  toolApprovals: AgentSessionToolApproval[]
  toolApprovalHistory: AgentSessionToolApprovalDecisionRecord[]
  chunksBySessionId: Record<string, AgentRuntimeSessionChunk[]>
  updatedAt: string
}

export type AgentTaskRuntimeStatus = 'idle' | 'due' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'

export type AgentTaskRuntimeBlockReason = 'autonomy-disabled' | 'policy-limit' | 'runtime-stopped' | 'queue-full' | 'schedule-invalid'

export type AgentTaskSchedulerRuntimeTask = {
  taskId: string
  sourceTaskId: string | null
  sourceSessionId: string | null
  agentId: string
  executionKind: 'scheduled' | 'heartbeat'
  name: string
  prompt: string
  workspace: ScheduledTaskEntity['workspace']
  trigger: ScheduledTaskEntity['trigger']
  status: ScheduledTaskEntity['status']
  timeoutMinutes: number
  enabled: boolean
  isRunnable: boolean
  isDue: boolean
  exhausted: boolean
  runtimeStatus: AgentTaskRuntimeStatus
  runtimeBlockReason?: AgentTaskRuntimeBlockReason | null
  nextRunAt: string | null
  lastRunAt: string | null
  lastRunLogId: string | null
  failureStreak: number
  circuitBroken: boolean
  subscribedChannelIds: string[]
  activeChannelIds: string[]
  inactiveChannelIds: string[]
}

export type AgentTaskSchedulerSnapshot = {
  tasksById: Record<string, AgentTaskSchedulerRuntimeTask>
  dueTaskIds: string[]
  updatedAt: string
}

export type AgentRuntimeDriver = {
  sendMessage: (request: AgentChatRuntimeRequest, context?: AgentRuntimeDriverContext) => Promise<AgentChatRuntimeResult>
  prewarmSession?: (
    request: AgentRuntimePrewarmSessionRequest,
    context?: AgentRuntimeDriverContext
  ) => Promise<AgentRuntimePrewarmSessionResult>
  cancelMessage: (runId: string, reason?: AgentRuntimeStopReason) => boolean
  cancelSession: (sessionId: string, reason?: AgentRuntimeStopReason) => boolean
  requestToolApproval?: (input: ToolApprovalRequestInput) => Promise<ToolApprovalDecision>
}

export type AgentRuntimePrewarmSessionRequest = {
  agentId: string
  sessionId: string
}

export type AgentRuntimePrewarmSessionResult =
  | {
      ok: true
      status: 'warmed'
    }
  | {
      ok: false
      reason: string
      message: string
    }

export type AgentRuntimeDriverContext = {
  composition?: AgentRuntimeComposition
  traceId?: string | null
  lastResumeToken?: string | null
}

export type AgentRuntimeTraceOperation = 'send-message' | 'prewarm-session'

export type AgentRuntimeTraceSpanStart = {
  operation: AgentRuntimeTraceOperation
  traceId: string | null
  agentId: string
  agentType: AgentType
  sessionId: string
  runId: string | null
  parentResumeToken: string | null
  startedAt: string
}

export type AgentRuntimeTraceSpanEnd = {
  status: AgentSessionRuntimeTerminalStatus
  endedAt: string
  stopReason: AgentRuntimeStopReason | null
  resumeToken: string | null
}

export type AgentRuntimeTraceSpan = {
  end: (end: AgentRuntimeTraceSpanEnd) => void
}

export type AgentRuntimeTraceRecorder = {
  startSpan: (start: AgentRuntimeTraceSpanStart) => AgentRuntimeTraceSpan | null | undefined
  flush?: () => void | Promise<void>
}

export type ToolApprovalRequestInput = {
  approvalId?: string
  sessionId: string
  toolCallId: string
  toolName: string
}

export type AgentRuntimeControl = Pick<AgentRuntimeDriver, 'sendMessage' | 'cancelSession' | 'cancelMessage'> & {
  getSnapshot?: () => AgentSessionRuntimeSnapshot
  listToolApprovals?: () => AgentSessionToolApproval[]
  listToolApprovalHistory?: () => AgentSessionToolApprovalDecisionRecord[]
  resolveToolApproval?: (approvalId: string, decision: ToolApprovalDecision) => AgentSessionRuntimeSnapshot
  emitChunk?: (chunk: AgentRuntimeSessionChunk) => void
}
