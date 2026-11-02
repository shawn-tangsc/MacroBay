import type { AgentChannelRuntimeSnapshot } from '@platform/ai/agent-platform/channels/channelRuntimeSnapshot'
import type { AgentSessionRuntimeStateBySessionId } from '@platform/ai/agent-platform/runtime/runtimeTypes'
import { useEffect, useMemo, useState } from 'react'

import type { AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import type { AgentSessionPanelPosition } from '@platform/settings/schema/appSettings'

import { createSessionSeenState, getSessionBadgeStatus, reconcileSessionSeenState } from '../agentSessionSeenState'
import {
  buildSessionRuntimeStatusById,
  getLatestAssistantMessageUpdatedAt,
  groupAgentSessions
} from '../agentSessionViewModel'
import { useAgentText } from '../agentTextProvider'
import { buildSessionChannelRuntimeBadgeBySessionId } from '../agentChannelRuntimeViewModel'
import SessionItem from './SessionItem'

type SessionsProps = {
  sessions: AgentSessionEntity[]
  activeSessionId: string | null
  pinnedSessionIds: Set<string>
  messagesBySessionId: Record<string, AgentSessionMessageEntity[]>
  runtimeStateBySessionId: AgentSessionRuntimeStateBySessionId
  channelTypeBySessionId: Record<string, string | undefined>
  channelRuntimeSnapshot: AgentChannelRuntimeSnapshot
  sessionPanelPosition: AgentSessionPanelPosition
  onUpdateSessionPanelPosition: (position: AgentSessionPanelPosition) => void
  onSelectSession: (sessionId: string) => void
  onStateChange: (updater: (state: AgentStoreState) => AgentStoreState) => void
}

export default function Sessions({
  sessions,
  activeSessionId,
  pinnedSessionIds,
  messagesBySessionId,
  runtimeStateBySessionId,
  channelTypeBySessionId,
  channelRuntimeSnapshot,
  sessionPanelPosition,
  onUpdateSessionPanelPosition,
  onSelectSession,
  onStateChange
}: SessionsProps): React.ReactElement {
  const t = useAgentText()
  const [seenState, setSeenState] = useState(createSessionSeenState)
  const groups = groupAgentSessions(sessions, pinnedSessionIds, t.common)
  const statusBySessionId = buildSessionRuntimeStatusById(sessions, runtimeStateBySessionId)
  const channelRuntimeBySessionId = useMemo(
    () => buildSessionChannelRuntimeBadgeBySessionId(channelRuntimeSnapshot, t.sessionItem.channelRuntime),
    [channelRuntimeSnapshot, t.sessionItem.channelRuntime]
  )

  const sessionIds = useMemo(() => sessions.map((session) => session.id), [sessions])
  const latestAssistantUpdatedAtBySessionId = useMemo(
    () =>
      Object.fromEntries(
        sessions.map((session) => [session.id, getLatestAssistantMessageUpdatedAt(messagesBySessionId[session.id] ?? [])])
      ),
    [messagesBySessionId, sessions]
  )

  useEffect(() => {
    setSeenState((current) =>
      reconcileSessionSeenState(current, {
        sessionIds,
        activeSessionId,
        latestAssistantUpdatedAtBySessionId
      })
    )
  }, [activeSessionId, latestAssistantUpdatedAtBySessionId, sessionIds])

  return (
    <section className="agent-sessions">
      <div className="agent-session-list">
        {sessions.length === 0 ? <p className="agent-empty-copy">{t.sidePanel.emptySessions}</p> : null}
        {groups.map((group) => (
          <div key={group.key} className="agent-session-group">
            <div className="agent-session-group-title">
              <span>{group.title}</span>
              <small>{group.sessions.length}</small>
            </div>
            {group.sessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                active={session.id === activeSessionId}
                pinned={pinnedSessionIds.has(session.id)}
                runtimeStatus={getSessionBadgeStatus(seenState, {
                  sessionId: session.id,
                  runtimeStatus: statusBySessionId[session.id] ?? 'idle',
                  latestAssistantUpdatedAt: latestAssistantUpdatedAtBySessionId[session.id],
                  isActive: session.id === activeSessionId
                })}
                channelType={channelTypeBySessionId[session.id]}
                channelRuntime={channelRuntimeBySessionId[session.id]}
                sessionPanelPosition={sessionPanelPosition}
                onUpdateSessionPanelPosition={onUpdateSessionPanelPosition}
                onPress={() => {
                  onSelectSession(session.id)
                }}
                onStateChange={onStateChange}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
