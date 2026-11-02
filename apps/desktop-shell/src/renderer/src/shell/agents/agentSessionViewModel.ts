import type { AgentSessionEntity, AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentSessionRuntimeStateBySessionId } from '@platform/ai/agent-platform/runtime/runtimeTypes'

import type { AgentText } from './agentText'

export type AgentSessionGroup = {
  key: 'pinned' | 'recent'
  title: string
  sessions: AgentSessionEntity[]
}

export type AgentSessionRuntimeStatus = 'idle' | 'pending' | 'done' | 'error' | 'paused'

/**
 * 组内顺序：**最近活跃的在最上面**。
 *
 * 用 `updatedAt` 而不是 `createdAt`——读者找的是刚聊过的那个，不是刚建的那个。
 * 并列时按 `createdAt`、再按 `id` 兜底：同一份数据渲染两次必须逐字相同，
 * 否则并列的几条会在每次重排里换位置。
 *
 * **排序只写在这一处**：页面拿到的就是排好的数组，不再自己排第二遍。两处规则一旦分叉，
 * 以后没人说得清哪一处才是对的。
 */
function byRecentActivity(a: AgentSessionEntity, b: AgentSessionEntity): number {
  const byUpdatedAt = (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
  if (byUpdatedAt !== 0) return byUpdatedAt
  const byCreatedAt = (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
  return byCreatedAt !== 0 ? byCreatedAt : b.id.localeCompare(a.id)
}

export function groupAgentSessions(
  sessions: readonly AgentSessionEntity[],
  pinnedSessionIds: ReadonlySet<string>,
  text: Pick<AgentText['common'], 'pinned' | 'recent'>
): AgentSessionGroup[] {
  const pinned = sessions.filter((session) => pinnedSessionIds.has(session.id)).sort(byRecentActivity)
  const recent = sessions.filter((session) => !pinnedSessionIds.has(session.id)).sort(byRecentActivity)
  const groups: AgentSessionGroup[] = [
    { key: 'pinned', title: text.pinned, sessions: pinned },
    { key: 'recent', title: text.recent, sessions: recent }
  ]

  return groups.filter((group) => group.sessions.length > 0)
}

export function getCreateSessionFallbackAgentId(
  sessions: readonly AgentSessionEntity[],
  activeSessionId: string | null,
  firstAgentId: string | null
): string | null {
  return sessions.find((session) => session.id === activeSessionId)?.agentId ?? sessions[0]?.agentId ?? firstAgentId
}

export function filterSessionsForAgent(
  sessions: readonly AgentSessionEntity[],
  activeAgentId: string | null
): AgentSessionEntity[] {
  if (!activeAgentId) return []
  return sessions.filter((session) => session.agentId === activeAgentId)
}

export function getCreateSessionAgentId(activeAgentId: string | null): string | null {
  return activeAgentId
}

export function getAgentPrimarySessionId(
  sessions: readonly AgentSessionEntity[],
  agentId: string,
  activeSessionId: string | null
): string | null {
  const activeSession = sessions.find((session) => session.id === activeSessionId && session.agentId === agentId)
  return activeSession?.id ?? sessions.find((session) => session.agentId === agentId)?.id ?? null
}

export function getSessionRuntimeStatus(
  runtimeState: AgentSessionRuntimeStateBySessionId[string] | undefined
): AgentSessionRuntimeStatus {
  if (
    runtimeState?.turnState === 'queued' ||
    runtimeState?.turnState === 'running' ||
    runtimeState?.turnState === 'stopping'
  ) {
    return 'pending'
  }

  if ((runtimeState?.inflightRequestCount ?? 0) > 0) {
    return 'pending'
  }

  if (runtimeState?.lastTerminalStatus === 'success') return 'done'
  if (runtimeState?.lastTerminalStatus === 'paused') return 'paused'
  if (runtimeState?.lastTerminalStatus === 'error') return 'error'
  return 'idle'
}

export function getLatestAssistantMessageUpdatedAt(
  messages: readonly AgentSessionMessageEntity[]
): string | undefined {
  return [...messages].reverse().find((message) => message.role === 'assistant')?.updatedAt
}

export function buildSessionRuntimeStatusById(
  sessions: readonly AgentSessionEntity[],
  runtimeStateBySessionId: Readonly<AgentSessionRuntimeStateBySessionId>
): Record<string, AgentSessionRuntimeStatus> {
  return Object.fromEntries(sessions.map((session) => [session.id, getSessionRuntimeStatus(runtimeStateBySessionId[session.id])]))
}
