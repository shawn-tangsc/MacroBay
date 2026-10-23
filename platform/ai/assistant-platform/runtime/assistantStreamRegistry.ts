import { createIdleTopicStreamSnapshot, resolveTopicStreamStatus } from './assistantStreamState'
import type {
  AssistantStreamChunkPayload,
  AssistantTopicStreamSnapshot
} from '../schemas/streamSchemas'

type TopicStreamState = {
  snapshot: AssistantTopicStreamSnapshot
  bufferedChunks: AssistantStreamChunkPayload[]
  abortControllers: Map<string, AbortController>
  activeExecutions: Array<{ executionId: string; anchorMessageId?: string }>
  hasError: boolean
  aborted: boolean
}

export type AssistantStreamAbortResult = {
  aborted: boolean
  anchorMessageIds: string[]
}

export class AssistantStreamRegistry {
  private topics = new Map<string, TopicStreamState>()

  ensure(topicId: string): TopicStreamState {
    const existing = this.topics.get(topicId)
    if (existing) return existing
    const created: TopicStreamState = {
      snapshot: createIdleTopicStreamSnapshot(topicId),
      bufferedChunks: [],
      abortControllers: new Map(),
      activeExecutions: [],
      hasError: false,
      aborted: false
    }
    this.topics.set(topicId, created)
    return created
  }

  getSnapshot(topicId: string): AssistantTopicStreamSnapshot {
    return this.ensure(topicId).snapshot
  }

  attach(topicId: string): {
    snapshot: AssistantTopicStreamSnapshot
    bufferedChunks: AssistantStreamChunkPayload[]
  } {
    const state = this.ensure(topicId)
    return {
      snapshot: state.snapshot,
      bufferedChunks: [...state.bufferedChunks]
    }
  }

  startExecution(topicId: string, executionId: string, anchorMessageId?: string): AbortController {
    const state = this.ensure(topicId)
    const controller = new AbortController()
    state.abortControllers.set(executionId, controller)
    state.activeExecutions.push({ executionId, anchorMessageId })
    state.aborted = false
    state.hasError = false
    this.refreshSnapshot(state)
    return controller
  }

  finishExecution(topicId: string, executionId: string, input?: { error?: boolean; aborted?: boolean }): void {
    const state = this.topics.get(topicId)
    if (!state) return
    state.abortControllers.delete(executionId)
    state.activeExecutions = state.activeExecutions.filter((item) => item.executionId !== executionId)
    if (input?.error) state.hasError = true
    if (input?.aborted) state.aborted = true
    this.refreshSnapshot(state)
    if (state.activeExecutions.length === 0) {
      state.bufferedChunks = []
    }
  }

  pushChunk(topicId: string, payload: AssistantStreamChunkPayload): boolean {
    const state = this.topics.get(topicId)
    if (!state || !payload.executionId || !state.abortControllers.has(payload.executionId)) return false
    state.bufferedChunks.push(payload)
    this.refreshSnapshot(state)
    return true
  }

  isExecutionActive(topicId: string, executionId: string): boolean {
    return this.topics.get(topicId)?.abortControllers.has(executionId) ?? false
  }

  abortTopic(topicId: string): AssistantStreamAbortResult {
    const state = this.topics.get(topicId)
    if (!state) return { aborted: false, anchorMessageIds: [] }
    const anchorMessageIds = state.activeExecutions.flatMap((execution) =>
      execution.anchorMessageId ? [execution.anchorMessageId] : []
    )
    let aborted = false
    for (const controller of state.abortControllers.values()) {
      controller.abort()
      aborted = true
    }
    state.abortControllers.clear()
    state.activeExecutions = []
    state.aborted = true
    this.refreshSnapshot(state)
    return { aborted, anchorMessageIds }
  }

  clearTopic(topicId: string): void {
    this.topics.delete(topicId)
  }

  private refreshSnapshot(state: TopicStreamState): void {
    state.snapshot = {
      ...state.snapshot,
      status: resolveTopicStreamStatus({
        activeExecutions: state.activeExecutions,
        awaitingApprovalAnchors: [],
        hasError: state.hasError,
        aborted: state.aborted
      }),
      activeExecutions: [...state.activeExecutions],
      awaitingApprovalAnchors: [],
      updatedAt: new Date().toISOString()
    }
  }
}
