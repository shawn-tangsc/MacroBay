import type { AgentChatRuntimeResult } from './agentChatRuntime'
import type { ToolApprovalDecision } from './policy'
import type {
  AgentRuntimeAssistantTextUpdateChunk,
  AgentRuntimeSessionChunk,
  AgentRuntimeToolApprovalRequestChunk,
  AgentRuntimeToolApprovalResolvedChunk,
  AgentSessionRuntimeSnapshot,
  AgentSessionRuntimeTerminalStatus,
  ToolApprovalRequestInput
} from './runtimeTypes'

/**
 * A reasoning model can stream thousands of deltas per turn. Every snapshot serializes the whole
 * retained list, so an unbounded list turns one thinking phase into quadratic IPC work. Keep a
 * bounded tail; approvals are never dropped because they need a user decision.
 */
export const MAX_RUNTIME_CHUNKS_PER_SESSION = 400

/**
 * The chunk budget and the chunk constructors, kept out of the runtime service itself.
 *
 * Every function here is pure: it takes the chunks a session already holds and answers what the
 * next snapshot contains. The service owns the session entry, the driver and the clock; this file
 * owns what a chunk list means. Splitting them is what let the service stay under its size limit
 * without changing which chunks are kept — the pruning rule and the "never drop an approval" rule
 * now sit next to each other, where a change to one can be checked against the other.
 */
export function boundRuntimeChunks(chunks: AgentRuntimeSessionChunk[]): AgentRuntimeSessionChunk[] {
  if (chunks.length <= MAX_RUNTIME_CHUNKS_PER_SESSION) return chunks
  let excess = chunks.length - MAX_RUNTIME_CHUNKS_PER_SESSION
  const kept: AgentRuntimeSessionChunk[] = []
  for (const chunk of chunks) {
    if (excess > 0 && !isApprovalChunk(chunk) && !isApprovalResolvedChunk(chunk)) {
      excess -= 1
      continue
    }
    kept.push(chunk)
  }
  return kept
}

export function isApprovalChunk(chunk: AgentRuntimeSessionChunk): chunk is Extract<AgentRuntimeSessionChunk, { type: 'tool-approval-request' }> {
  return chunk.type === 'tool-approval-request'
}

export function isApprovalResolvedChunk(
  chunk: AgentRuntimeSessionChunk
): chunk is AgentRuntimeToolApprovalResolvedChunk {
  return chunk.type === 'tool-approval-resolved'
}

export function isAssistantTextUpdateChunk(
  chunk: AgentRuntimeSessionChunk
): chunk is AgentRuntimeAssistantTextUpdateChunk {
  return chunk.type === 'assistant-text-update'
}

export function normalizeTerminalStatus(status: AgentChatRuntimeResult['assistantMessage']['status']): AgentSessionRuntimeTerminalStatus {
  if (status === 'paused') return 'paused'
  if (status === 'error') return 'error'
  return 'success'
}

export function createToolApprovalRequestChunk(
  input: ToolApprovalRequestInput
): AgentRuntimeToolApprovalRequestChunk {
  return {
    type: 'tool-approval-request',
    approvalId: input.approvalId ?? createApprovalId(),
    sessionId: input.sessionId,
    toolCallId: input.toolCallId,
    providerMetadata: {
      claudeAgent: {
        transport: 'claude-agent',
        toolName: input.toolName
      }
    }
  }
}

export function createToolApprovalResolvedChunk(
  pending: Pick<AgentSessionRuntimeSnapshot['toolApprovals'][number], 'approvalId' | 'sessionId' | 'toolCallId' | 'toolName'>,
  decision: ToolApprovalDecision
): AgentRuntimeToolApprovalResolvedChunk {
  return {
    type: 'tool-approval-resolved',
    approvalId: pending.approvalId,
    sessionId: pending.sessionId,
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    decision: decision.behavior,
    ...(decision.behavior === 'allow' && Object.prototype.hasOwnProperty.call(decision, 'updatedInput')
      ? { updatedInput: decision.updatedInput }
      : {}),
    ...(decision.behavior === 'deny' ? { message: decision.message } : {})
  }
}

export function createApprovalId(): string {
  return `tool-approval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
