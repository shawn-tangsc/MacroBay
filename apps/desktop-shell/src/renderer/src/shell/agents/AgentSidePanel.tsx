import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input } from 'antd'
import { Bot, MessageSquarePlus, Search, Trash2 } from 'lucide-react'

import type { AgentChannelRuntimeSnapshot } from '@platform/ai/agent-platform/channels/channelRuntimeSnapshot'
import type { AgentSessionRuntimeStateBySessionId } from '@platform/ai/agent-platform/runtime/runtimeTypes'
import type { AgentSessionPanelPosition } from '@platform/settings/schema/appSettings'
import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import { Tabs } from '@platform/ui/components/tabs'

import AgentRoster from './components/AgentRoster'
import Sessions from './components/Sessions'
import { deleteSessions, selectAgentById, selectSession } from './agentStateActions'
import { deleteSessionsViaApi, selectAgentViaApi, selectSessionViaApi } from './agentSessionDataApi'
import { getSessionChannelTypeBySessionId } from './agentChannelVisuals'
import { filterSessionsForAgent, getAgentPrimarySessionId } from './agentSessionViewModel'
import { useConfirm } from '@platform/ui/components/confirm'
import { DisabledHint } from '@platform/ui/components/disabled-hint'
import { Tooltip } from '@platform/ui/components/tooltip'

import { useAgentText } from './agentTextProvider'
import { resolveAgentTextKey, resolveAgentTooltipText, type AgentTooltipKey } from './agentTooltipText'
import { startDefaultSession } from './startDefaultSession'

type AgentSidePanelTab = 'agents' | 'sessions'

/** 页签与整组的读屏名：句子在 `agentText.sidePanel` 里，键只回答「哪一句」。 */
const TAB_AGENTS_KEY = 'agent.sidePanel.tabAgents'
const TAB_SESSIONS_KEY = 'agent.sidePanel.tabSessions'
const TAB_GROUP_KEY = 'agent.sidePanel.tabGroup'

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
  /** 每次自增表示「把读者送到智能体列表」：会话指向的智能体被删掉时用。 */
  focusAgentListTick?: number
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
  onStateChange,
  focusAgentListTick = 0
}: AgentSidePanelProps): React.ReactElement {
  const t = useAgentText()
  const confirm = useConfirm()
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
  const panelRef = useRef<HTMLElement | null>(null)

  // 「回到列表」：切到智能体页，把焦点交给第一个智能体，读屏才知道列表在哪。
  useEffect(() => {
    if (focusAgentListTick === 0) return
    setActiveTab('agents')
    panelRef.current?.querySelector<HTMLButtonElement>('.agent-roster-main')?.focus()
  }, [focusAgentListTick])
  const [keyword, setKeyword] = useState('')
  const activeAgentId = state.activeAgentId ?? state.agents[0]?.id ?? null
  const agentSessions = useMemo(
    () => filterSessionsForAgent(state.sessions, activeAgentId),
    [activeAgentId, state.sessions]
  )
  // 默认列表只含读者自己的会话；自动会话单独一块。归一方向与平台一致：只有显式 `automation`
  // 才算自动，脏值留在读者列表里（宁可自动混进来，也不许把读者的历史藏掉）。
  const readerSessions = useMemo(
    () => agentSessions.filter((session) => session.origin !== 'automation'),
    [agentSessions]
  )
  const automationSessions = useMemo(
    () => agentSessions.filter((session) => session.origin === 'automation'),
    [agentSessions]
  )
  const filteredSessions = useMemo(() => {
    const value = keyword.trim().toLowerCase()
    if (!value) return readerSessions
    return readerSessions.filter((session) => {
      const agent = state.agents.find((item) => item.id === session.agentId)
      return `${session.name} ${session.description ?? ''} ${agent?.name ?? ''}`.toLowerCase().includes(value)
    })
  }, [readerSessions, keyword, state.agents])
  const sessionCountByAgentId = useMemo(() => {
    return state.sessions.reduce<Record<string, number>>((counts, session) => {
      if (!session.agentId) return counts
      // 智能体行上的「N 个会话」只数读者自己的：自动会话不该让读者以为自己聊过这么多。
      if (session.origin === 'automation') return counts
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
    <aside ref={panelRef} className="agent-side-panel agent-side-panel--tabbed">
      <Tabs
        ariaLabelKey={TAB_GROUP_KEY}
        items={[
          { value: 'agents', labelKey: TAB_AGENTS_KEY },
          { value: 'sessions', labelKey: TAB_SESSIONS_KEY }
        ]}
        onChange={(value) => setActiveTab(value === 'agents' ? 'agents' : 'sessions')}
        panels={{
          // 动作条属于面板（`ui-conventions.md`）：面板第一行是该页签自己的动作，下面是可滚动内容。
          agents: (
            <div className="agent-side-panel-panel">
              <div className="agent-side-panel-action">
                <Tooltip labelKey={tooltipKeys.createAgent} resolveText={resolveText}>
                  <Button className="agent-side-panel-add-button" icon={<Bot size={15} />} onClick={onCreateAgent}>
                    {t.navbar.createAgent}
                  </Button>
                </Tooltip>
              </div>
              <div className="agent-side-panel-content">
              <AgentRoster
                agents={state.agents}
                activeAgentId={activeAgentId}
                sessionCountByAgentId={sessionCountByAgentId}
                onSelectAgent={selectAgent}
                onEditAgent={onEditAgent}
              />
              </div>
            </div>
          ),
          sessions: (
            <div className="agent-side-panel-panel">
              <div className="agent-side-panel-action">
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
                      aria-label={t.sidePanel.deleteFiltered}
                      disabled={filteredSessions.length === 0}
                      onClick={() => {
                        const ids = filteredSessions.map((session) => session.id)
                        confirm({
                          title: t.sidePanel.deleteFiltered,
                          description: t.sidePanel.confirmDeleteFilteredSessions(ids.length),
                          confirmLabel: t.sidePanel.deleteFiltered,
                          cancelLabel: t.common.cancel,
                          tone: 'danger',
                          onConfirm: () => {
                            void deleteSessionsViaApi(window.platform, ids).catch(() => {
                              onStateChange((current) => deleteSessions(current, ids))
                            })
                          }
                        })
                      }}
                    />
                  </DisabledHint>
              </div>
              <div className="agent-side-panel-content">
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
                  // 搜索只作用于读者自己的列表；自动块不受关键词影响（本批不覆盖搜索，见原型「没覆盖」）。
                  automationSessions={automationSessions}
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
              </div>
            </div>
          )
        }}
        resolveText={(key) =>
          key === TAB_AGENTS_KEY ? t.sidePanel.agentsTab : key === TAB_SESSIONS_KEY ? t.sidePanel.sessionsTab : t.sidePanel.navigationTabs
        }
        value={activeTab}
      />

    </aside>
  )
}
