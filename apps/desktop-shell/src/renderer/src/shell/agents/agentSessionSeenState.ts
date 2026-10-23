import type { AgentSessionRuntimeStatus } from './agentSessionViewModel'

export type AgentSessionSeenState = Record<string, string>
export type AgentSessionBadgeStatus = Exclude<AgentSessionRuntimeStatus, 'done'> | 'done'

export function createSessionSeenState(): AgentSessionSeenState {
  return {}
}

export function markSessionSeen(
  state: AgentSessionSeenState,
  sessionId: string,
  seenAtIso: string
): AgentSessionSeenState {
  return {
    ...state,
    [sessionId]: seenAtIso
  }
}

export function pruneSessionSeenState(
  state: AgentSessionSeenState,
  sessionIds: readonly string[]
): AgentSessionSeenState {
  const allowed = new Set(sessionIds)
  const next = Object.fromEntries(Object.entries(state).filter(([sessionId]) => allowed.has(sessionId)))
  return hasSameEntries(state, next) ? state : next
}

export function reconcileSessionSeenState(
  state: AgentSessionSeenState,
  input: {
    sessionIds: readonly string[]
    activeSessionId: string | null
    latestAssistantUpdatedAtBySessionId: Readonly<Record<string, string | undefined>>
  }
): AgentSessionSeenState {
  let next = pruneSessionSeenState(state, input.sessionIds)
  if (!input.activeSessionId) return next

  const latestAssistantUpdatedAt = input.latestAssistantUpdatedAtBySessionId[input.activeSessionId]
  if (!latestAssistantUpdatedAt || next[input.activeSessionId] === latestAssistantUpdatedAt) return next

  next = {
    ...next,
    [input.activeSessionId]: latestAssistantUpdatedAt
  }

  return hasSameEntries(state, next) ? state : next
}

export function getSessionBadgeStatus(
  state: AgentSessionSeenState,
  input: {
    sessionId: string
    runtimeStatus: AgentSessionRuntimeStatus
    latestAssistantUpdatedAt?: string
    isActive: boolean
  }
): AgentSessionRuntimeStatus {
  if (input.isActive) return 'idle'
  if (input.runtimeStatus === 'pending' || input.runtimeStatus === 'error' || input.runtimeStatus === 'paused') {
    return input.runtimeStatus
  }
  if (input.runtimeStatus !== 'done') return 'idle'
  if (!input.latestAssistantUpdatedAt) return 'idle'

  const seenAt = state[input.sessionId]
  if (!seenAt) return 'done'

  return Date.parse(input.latestAssistantUpdatedAt) > Date.parse(seenAt) ? 'done' : 'idle'
}

function hasSameEntries(a: AgentSessionSeenState, b: AgentSessionSeenState): boolean {
  const aEntries = Object.entries(a)
  if (aEntries.length !== Object.keys(b).length) return false
  return aEntries.every(([key, value]) => b[key] === value)
}
