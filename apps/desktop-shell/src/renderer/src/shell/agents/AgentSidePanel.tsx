import { useMemo, useState } from 'react'
import { Button, Input } from 'antd'
import { Bot, MessageSquarePlus, Search, Trash2 } from 'lucide-react'

import type { AgentChannelRuntimeSnapshot } from '@platform/ai/agent-platform/channels/channelRuntimeSnapshot'
import type { AgentSessionRuntimeStateBySessionId } from '@platform/ai/agent-platform/runtime/runtimeTypes'
import type { AgentSessionPanelPosition } from '@platform/settings/schema/appSettings'
import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'

import AgentRoster from './components/AgentRoster'
import Sessions from './components/Sessions'
import { deleteSessions, selectAgentById, selectSession } from './agentStateActions'
import { deleteSessionsViaApi, selectAgentViaApi, selectSessionViaApi } from './agentSessionDataApi'
import { getSessionChannelTypeBySessionId } from './agentChannelVisuals'
import { filterSessionsForAgent, getAgentPrimarySessionId } from './agentSessionViewModel'
import { DisabledHint } from '@platform/ui/components/disabled-hint'
import { Tooltip } from '@platform/ui/components/tooltip'

import { useAgentText } from './agentTextProvider'
import { resolveAgentTextKey, resolveAgentTooltipText, type AgentTooltipKey } from './agentTooltipText'
import { startDefaultSession } from './startDefaultSession'

type AgentSidePanelTab = 'agents' | 'sessions'

type AgentSidePanelProps = {
  state: AgentStoreState
  runtimeStateBySessionId: AgentSessionRuntimeStateBySessionId
  channelRuntimeSnapshot: AgentChannelRuntimeSnapshot
  sessionPanelPosition: AgentSessionPanelPosition
  onUpdateSessionPanelPosition: (position: AgentSessionPanelPosition) => void
  onCreateAgent: () => void
  onEditAgent: (agentId: string) => void
  defaultAgentModelId?: string
  onStateChange: (updater: (state: AgentStoreState) => AgentStoreState) => void
}

export default function AgentSidePanel({
  state,
  runtimeStateBySessionId,
  channelRuntimeSnapshot,
  sessionPanelPosition,
  onUpdateSessionPanelPosition,
  onCreateAgent,
  onEditAgent,
  defaultAgentModelId,
  onStateChange
}: AgentSidePanelProps): React.ReactElement {
  const t = useAgentText()
  // 只有「创建智能体」这一颗能挂提示：另外两颗在禁用时会接不到焦点，提示只剩鼠标能看。
  const tooltipKeys = { createAgent: 'navbar.createAgent' } as const satisfies Record<string, AgentTooltipKey>
  // 键名跟着**按钮的动作**走：那颗按钮删除筛选后的会话，不是「清除筛选」。
  const disabledHintKeys = {
    newSession: 'sidePanel.newSessionNeedsAgent',
    deleteFiltered: 'sidePanel.deleteFilteredNeedsSessions'
  } as const
  const resolveText = (key: AgentTooltipKey): string => resolveAgentTooltipText(t, key)
  const resolveHintText = (key: string): string => resolveAgentTextKey(t, key)
  const [activeTab, setActiveTab] = useState<AgentSidePanelTab>('sessions')
  const [keyword, setKeyword] = useState('')
  const activeAgentId = state.activeAgentId ?? state.agents[0]?.id ?? null
  const agentSessions = useMemo(
    () => filterSessionsForAgent(state.sessions, activeAgentId),
    [activeAgentId, state.sessions]
  )
  const filteredSessions = useMemo(() => {
    const value = keyword.trim().toLowerCase()
    if (!value) return agentSessions
    return agentSessions.filter((session) => {
      const agent = state.agents.find((item) => item.id === session.agentId)
      return `${session.name} ${session.description ?? ''} ${agent?.name ?? ''}`.toLowerCase().includes(value)
    })
  }, [agentSessions, keyword, state.agents])
  const sessionCountByAgentId = useMemo(() => {
    return state.sessions.reduce<Record<string, number>>((counts, session) => {
      if (!session.agentId) return counts
      counts[session.agentId] = (counts[session.agentId] ?? 0) + 1
      return counts
    }, {})
  }, [state.sessions])
  const channelTypeBySessionId = useMemo(() => getSessionChannelTypeBySessionId(state.channels), [state.channels])

  function createDefaultSession(): void {
    // 流程在 `startDefaultSession` 里，空会话页用的是同一份实现。
    startDefaultSession({
      state,
      activeAgentId,
      defaultAgentModelId,
      sessionName: t.sidePanel.defaultSessionName,
      onStateChange
    })
  }

  function selectAgent(agentId: string): void {
    const sessionId = getAgentPrimarySessionId(state.sessions, agentId, state.activeSessionId)
    setActiveTab('sessions')

    if (sessionId) {
      void selectSessionViaApi(window.platform, sessionId).catch(() => {
        onStateChange((current) => selectSession(current, sessionId))
      })
      return
    }

    void selectAgentViaApi(window.platform, agentId).catch(() => {
      onStateChange((current) => selectAgentById(current, agentId))
    })
  }

  return (
    <aside className="agent-side-panel">
      <div className="agent-side-panel-tabs" role="tablist" aria-label={t.sidePanel.navigationTabs}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'agents'}
          className={activeTab === 'agents' ? 'active' : ''}
          onClick={() => setActiveTab('agents')}>
          {t.sidePanel.agentsTab}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'sessions'}
          className={activeTab === 'sessions' ? 'active' : ''}
          onClick={() => setActiveTab('sessions')}>
          {t.sidePanel.sessionsTab}
        </button>
      </div>

      <div className="agent-side-panel-action">
        {activeTab === 'agents' ? (
          <Tooltip labelKey={tooltipKeys.createAgent} resolveText={resolveText}>
            <Button className="agent-side-panel-add-button" icon={<Bot size={15} />} onClick={onCreateAgent}>
              {t.navbar.createAgent}
            </Button>
          </Tooltip>
        ) : (
          <>
            <DisabledHint
              labelKey={disabledHintKeys.newSession}
              resolveText={resolveHintText}>
              <Button
                className="agent-side-panel-add-button"
                icon={<MessageSquarePlus size={15} />}
                disabled={!activeAgentId}
                onClick={createDefaultSession}>
                {t.sidePanel.newSession}
              </Button>
            </DisabledHint>
            <DisabledHint
              labelKey={disabledHintKeys.deleteFiltered}
              resolveText={resolveHintText}>
              <Button
                className="ant-shell-icon-button"
                type="text"
                size="small"
                icon={<Trash2 size={15} />}
                disabled={filteredSessions.length === 0}
                onClick={() => {
                  if (!window.confirm(t.sidePanel.confirmDeleteFilteredSessions(filteredSessions.length))) return
                  void deleteSessionsViaApi(
                    window.platform,
                    filteredSessions.map((session) => session.id)
                  ).catch(() => {
                    onStateChange((current) => deleteSessions(current, filteredSessions.map((session) => session.id)))
                  })
                }}
              />
            </DisabledHint>
          </>
        )}
      </div>

      <div className="agent-side-panel-content">
        {activeTab === 'agents' ? (
          <AgentRoster
            agents={state.agents}
            activeAgentId={activeAgentId}
            sessionCountByAgentId={sessionCountByAgentId}
            onSelectAgent={selectAgent}
            onEditAgent={onEditAgent}
          />
        ) : (
          <>
            <div className="agent-session-search">
              <Input
                value={keyword}
                size="small"
                prefix={<Search size={13} />}
                placeholder={t.sidePanel.searchSessions}
                allowClear
                onChange={(event) => setKeyword(event.target.value)}
              />
              <span>{t.sidePanel.sessionCount(filteredSessions.length)}</span>
            </div>

            <Sessions
              sessions={filteredSessions}
              activeSessionId={state.activeSessionId}
              pinnedSessionIds={new Set(state.sessionPins.map((pin) => pin.sessionId))}
              messagesBySessionId={state.messagesBySessionId}
              runtimeStateBySessionId={runtimeStateBySessionId}
              channelTypeBySessionId={channelTypeBySessionId}
              channelRuntimeSnapshot={channelRuntimeSnapshot}
              sessionPanelPosition={sessionPanelPosition}
              onUpdateSessionPanelPosition={onUpdateSessionPanelPosition}
              onSelectSession={(sessionId) => {
                void selectSessionViaApi(window.platform, sessionId).catch(() => {
                  onStateChange((current) => selectSession(current, sessionId))
                })
              }}
              onStateChange={onStateChange}
            />
          </>
        )}
      </div>
    </aside>
  )
}
