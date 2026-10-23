import type {
  AssistantStreamExecution,
  AssistantStreamStatus,
  AssistantTopicStreamSnapshot
} from '../schemas/streamSchemas'

export type TopicStreamTurnFlags = {
  isStreamLive: boolean
  isTurnActive: boolean
  isAwaitingApproval: boolean
  isTerminal: boolean
}

export function createIdleTopicStreamSnapshot(topicId: string, now = new Date()): AssistantTopicStreamSnapshot {
  return {
    topicId,
    status: 'done',
    activeExecutions: [],
    awaitingApprovalAnchors: [],
    updatedAt: now.toISOString()
  }
}

export function resolveTopicStreamStatus(input: {
  activeExecutions: readonly AssistantStreamExecution[]
  awaitingApprovalAnchors: readonly AssistantStreamExecution[]
  hasError: boolean
  aborted: boolean
}): AssistantStreamStatus {
  if (input.activeExecutions.length > 0) return 'streaming'
  if (input.awaitingApprovalAnchors.length > 0) return 'awaiting-approval'
  if (input.hasError) return 'error'
  if (input.aborted) return 'aborted'
  return 'done'
}

export function isTopicStreamTerminal(status: AssistantStreamStatus): boolean {
  return status === 'done' || status === 'aborted' || status === 'error'
}

export function classifyTopicStreamTurn(
  snapshot: Pick<
    AssistantTopicStreamSnapshot,
    'status' | 'activeExecutions' | 'awaitingApprovalAnchors'
  >
): TopicStreamTurnFlags {
  const isAwaitingApproval =
    snapshot.status === 'awaiting-approval' || snapshot.awaitingApprovalAnchors.length > 0
  const isStreamLive = snapshot.status === 'pending' || snapshot.status === 'streaming'
  const isTurnActive = isStreamLive || isAwaitingApproval
  return {
    isStreamLive,
    isTurnActive,
    isAwaitingApproval,
    isTerminal: isTopicStreamTerminal(snapshot.status) && !isTurnActive
  }
}
