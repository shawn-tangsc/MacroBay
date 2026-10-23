import type { AgentSessionMessageEntity } from '../schemas/sessionSchemas'
import { getSessionMessages, type AgentStoreState } from '../store/agentStore'
import type { AgentRuntimeResumeTokenSource, AgentSessionRuntimeTerminalStatus } from './runtimeTypes'

export type PersistedSessionRuntimeState = {
  lastResumeToken: string | null
  lastResumeTokenSource: AgentRuntimeResumeTokenSource | null
  lastTerminalStatus: AgentSessionRuntimeTerminalStatus | null
}

export function readPersistedSessionRuntimeState(
  state: AgentStoreState,
  sessionId: string
): PersistedSessionRuntimeState {
  const latestAssistantMessage = findLatestAssistantMessage(state, sessionId)
  const latestAssistantMessageWithResumeToken = findLatestAssistantMessageWithResumeToken(state, sessionId)
  if (!latestAssistantMessage) {
    return {
      lastResumeToken: null,
      lastResumeTokenSource: null,
      lastTerminalStatus: null
    }
  }

  const lastResumeToken =
    typeof latestAssistantMessageWithResumeToken?.runtimeResumeToken === 'string' &&
    latestAssistantMessageWithResumeToken.runtimeResumeToken.trim().length > 0
      ? latestAssistantMessageWithResumeToken.runtimeResumeToken
      : null

  return {
    lastResumeToken,
    lastResumeTokenSource: lastResumeToken ? 'persisted' : null,
    lastTerminalStatus: normalizePersistedTerminalStatus(latestAssistantMessage)
  }
}

function findLatestAssistantMessage(
  state: AgentStoreState,
  sessionId: string
): AgentSessionMessageEntity | null {
  return findLatestAssistantMessageMatching(state, sessionId, () => true)
}

function findLatestAssistantMessageWithResumeToken(
  state: AgentStoreState,
  sessionId: string
): AgentSessionMessageEntity | null {
  return findLatestAssistantMessageMatching(
    state,
    sessionId,
    (message) => typeof message.runtimeResumeToken === 'string' && message.runtimeResumeToken.trim().length > 0
  )
}

function findLatestAssistantMessageMatching(
  state: AgentStoreState,
  sessionId: string,
  predicate: (message: AgentSessionMessageEntity) => boolean
): AgentSessionMessageEntity | null {
  const messages = getSessionMessages(state, sessionId)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'assistant' && predicate(message)) {
      return message
    }
  }
  return null
}

function normalizePersistedTerminalStatus(
  message: AgentSessionMessageEntity
): AgentSessionRuntimeTerminalStatus | null {
  if (message.status === 'pending') return null
  if (message.status === 'paused') return 'paused'
  if (message.status === 'error') return 'error'
  return 'success'
}
