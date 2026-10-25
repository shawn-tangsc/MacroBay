import {
  getActiveAgent,
  getActiveSession,
  type AgentStoreState
} from '@platform/ai/agent-platform/store/agentStore'
import type { AgentChannelRuntimeSnapshot } from '@platform/ai/agent-platform/channels/channelRuntimeSnapshot'
import type { AgentRuntimeCompatibilityResult } from '@platform/ai/agent-platform/runtime/compatibility/agentRuntimeCompatibilityTypes'
import type { AgentSessionRuntimeSnapshot } from '@platform/ai/agent-platform/runtime/runtimeTypes'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import type { ChatSettings } from '@platform/settings/schema/appSettings'
import { Bot, Link2Off, Loader2 } from 'lucide-react'
import { Button } from 'antd'
import { useEffect, useState, type ReactNode } from 'react'

import type { AgentModelGatewayUiSnapshot } from './agentModelGatewayStatus'

import AgentChatNavbar from './components/AgentChatNavbar'
import AgentSessionInputbar from './components/AgentSessionInputbar'
import AgentSessionMessages from './components/AgentSessionMessages'
import AgentTodoListPanel from './components/AgentTodoListPanel'
import AgentStatusScreen from './components/status/AgentStatusScreen'
import {
  appendAgentSessionMessagePage,
  buildAgentSessionMessageWindow,
  type AgentSessionMessageWindow
} from './agentSessionMessageWindow'
import { listSessionMessagesViaApi } from './agentSessionDataApi'
import { buildSessionRuntimeStatusById } from './agentSessionViewModel'
import { useAgentText } from './agentTextProvider'
import { resolveAgentPageStatus } from './agentPageStatus'
import { sortAgentSessionMessages } from '@platform/ui/agent-chat'

const AGENT_MESSAGE_PAGE_SIZE = 50

type AgentChatProps = {
  state: AgentStoreState
  runtimeSnapshot: AgentSessionRuntimeSnapshot
  channelRuntimeSnapshot: AgentChannelRuntimeSnapshot
  providers: SafeModelProvider[]
  pinnedModelIds: string[]
  chatSettings: ChatSettings
  gatewaySnapshot?: AgentModelGatewayUiSnapshot | null
  compatibilityByModelKey?: ReadonlyMap<string, AgentRuntimeCompatibilityResult>
  /** 模型服务页「默认智能体模型」：会话没有显式模型时用于状态判断。 */
  defaultAgentModelId?: string
  loadingModelService?: boolean
  gatewayStatusCard?: ReactNode
  onStateChange: (updater: (state: AgentStoreState) => AgentStoreState) => void
  onRuntimeSnapshotChange: (snapshot: AgentSessionRuntimeSnapshot) => void
  onChannelRuntimeSnapshotChange: (snapshot: AgentChannelRuntimeSnapshot) => void
  onEditAgent: (agentId: string) => void
}

export default function AgentChat({
  state,
  runtimeSnapshot,
  channelRuntimeSnapshot,
  providers,
  pinnedModelIds,
  chatSettings: initialChatSettings,
  gatewaySnapshot = null,
  compatibilityByModelKey,
  defaultAgentModelId,
  loadingModelService = false,
  gatewayStatusCard,
  onStateChange,
  onRuntimeSnapshotChange,
  onChannelRuntimeSnapshotChange,
  onEditAgent
}: AgentChatProps): React.ReactElement {
  const t = useAgentText()
  const activeAgent = getActiveAgent(state)
  const activeSession = getActiveSession(state)
  const [olderMessageWindow, setOlderMessageWindow] = useState<AgentSessionMessageWindow | null>(null)
  const runtimeStatusBySessionId = buildSessionRuntimeStatusById(state.sessions, runtimeSnapshot.sessions)
  const baseMessageWindow = buildAgentSessionMessageWindow(state, activeSession?.id, {
    loadedPageCount: 1,
    pageSize: AGENT_MESSAGE_PAGE_SIZE
  })
  const messageWindow = olderMessageWindow
    ? {
        messages: mergeMessageWindows(olderMessageWindow.messages, baseMessageWindow.messages),
        hasOlder: olderMessageWindow.hasOlder,
        nextCursor: olderMessageWindow.nextCursor
      }
    : baseMessageWindow
  const messages = sortAgentSessionMessages(messageWindow.messages)
  const [chatSettings, setChatSettings] = useState<ChatSettings | null>(initialChatSettings)
  const activeCompatibility =
    activeAgent?.model && compatibilityByModelKey
      ? (compatibilityByModelKey.get(activeAgent.model) ?? null)
      : undefined
  const pageStatus = resolveAgentPageStatus({
    agents: state.agents,
    activeAgent,
    activeSession,
    providers,
    compatibility: activeCompatibility,
    gatewayEnabled: gatewaySnapshot?.enabled === true,
    defaultAgentModelId
  })
  const navbar = activeAgent && activeSession && activeSession.agentId === activeAgent.id ? (
    <AgentChatNavbar
      state={state}
      providers={providers}
      activeAgent={activeAgent}
      activeSession={activeSession}
      compatibilityByModelKey={compatibilityByModelKey}
      defaultAgentModelId={defaultAgentModelId}
      onStateChange={onStateChange}
      onChatSettingsChange={setChatSettings}
      onEditAgent={onEditAgent}
    />
  ) : null
  const blockedPaneClass = navbar ? 'agent-chat-pane empty with-navbar' : 'agent-chat-pane empty'

  useEffect(() => {
    setChatSettings(initialChatSettings)
  }, [initialChatSettings])

  useEffect(() => {
    setOlderMessageWindow(null)
  }, [activeSession?.id])

  useEffect(() => {
    setOlderMessageWindow((current) => {
      if (!current) return null
      return {
        ...current,
        messages: current.messages.filter((message) => message.sessionId === activeSession?.id)
      }
    })
  }, [activeSession?.id])

  if (loadingModelService) {
    return (
      <main className={blockedPaneClass}>
        {navbar}
        <AgentStatusScreen
          icon={Loader2}
          title={t.chat.loadingModelServiceTitle}
          description={t.chat.loadingModelServiceDescription}
        />
      </main>
    )
  }

  if (pageStatus.type === 'model-service-unavailable') {
    return (
      <main className={blockedPaneClass}>
        {navbar}
        <AgentStatusScreen
          icon={Bot}
          title={t.chat.modelServiceUnavailableTitle}
          description={t.chat.modelServiceUnavailableReasons[pageStatus.reason]}
          actions={
            <button
              type="button"
              className="secondary-button compact"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('app-shell:navigate', {
                    detail: { navKey: 'settings', settingsPanelKey: 'models' }
                  })
                )
              }}>
              {t.chat.openModelService}
            </button>
          }
        />
      </main>
    )
  }

  if (pageStatus.type === 'ordinary-chat-only') {
    return (
      <main className={blockedPaneClass}>
        {navbar}
        {gatewayStatusCard}
        <AgentStatusScreen
          icon={Bot}
          title={t.chat.ordinaryChatOnlyTitle}
          description={pageStatus.summary || t.chat.ordinaryChatOnlyDescription}
        />
      </main>
    )
  }

  if (pageStatus.type === 'direct-auth-failed') {
    return (
      <main className={blockedPaneClass}>
        {navbar}
        {gatewayStatusCard}
        <AgentStatusScreen
          icon={Bot}
          title={t.chat.directAuthFailedTitle}
          description={pageStatus.summary || t.chat.directAuthFailedDescription}
        />
      </main>
    )
  }

  if (pageStatus.type === 'runtime-unverified') {
    return (
      <main className={blockedPaneClass}>
        {navbar}
        {gatewayStatusCard}
        <AgentStatusScreen
          icon={Bot}
          title={t.chat.runtimeUnverifiedTitle}
          description={pageStatus.summary || t.chat.runtimeUnverifiedDescription}
        />
      </main>
    )
  }

  if (pageStatus.type === 'gateway-required' || pageStatus.type === 'gateway-stopped') {
    return (
      <main className={blockedPaneClass}>
        {navbar}
        <div className="agent-gateway-route-shell">{gatewayStatusCard}</div>
      </main>
    )
  }

  if (pageStatus.type === 'no-agents') {
    return (
      <main className="agent-chat-pane empty">
        <AgentStatusScreen
          icon={Bot}
          title={t.chat.noAgentTitle}
          description={t.chat.noAgentDescription}
        />
      </main>
    )
  }

  if (pageStatus.type === 'no-session') {
    return (
      <main className="agent-chat-pane empty">
        <AgentStatusScreen
          icon={Bot}
          title={t.chat.noSessionTitle}
          description={t.chat.noSessionDescription}
        />
      </main>
    )
  }

  if (pageStatus.type === 'orphan-session') {
    const orphanAgentId = activeAgent?.id
    return (
      <main className="agent-chat-pane empty">
        <AgentStatusScreen
          icon={Link2Off}
          title={t.chat.orphanTitle}
          description={t.chat.orphanDescription}
          actions={
            orphanAgentId ? <Button onClick={() => onEditAgent(orphanAgentId)}>{t.chat.openAgentConfig}</Button> : null
          }
        />
      </main>
    )
  }

  if (!activeAgent || !activeSession) {
    return (
      <main className="agent-chat-pane empty">
        <AgentStatusScreen
          icon={Bot}
          title={t.chat.noAgentTitle}
          description={t.chat.noAgentDescription}
        />
      </main>
    )
  }

  return (
    <main className="agent-chat-pane">
      {navbar}
      <div className="agent-chat-scroll">
        <AgentSessionMessages
          activeAgent={activeAgent}
          activeSession={activeSession}
          messages={messages}
          runtimeSnapshot={runtimeSnapshot}
          hasOlder={messageWindow.hasOlder}
          onLoadOlder={() => {
            if (!activeSession || !messageWindow.nextCursor) return
            void listSessionMessagesViaApi(window.platform, activeSession.id, {
              cursor: messageWindow.nextCursor,
              limit: AGENT_MESSAGE_PAGE_SIZE
            }).then((page) => {
              setOlderMessageWindow((current) => appendAgentSessionMessagePage(current ?? baseMessageWindow, page))
            })
          }}
          chatSettings={chatSettings}
          onStateChange={onStateChange}
          onRuntimeSnapshotChange={onRuntimeSnapshotChange}
          usageMessages={state.messagesBySessionId[activeSession.id] ?? messages}
        />
      </div>
      <AgentTodoListPanel agent={activeAgent} session={activeSession} messages={messages} narrow={chatSettings?.narrowMode === true} />
      <AgentSessionInputbar
        agent={activeAgent}
        session={activeSession}
        providers={providers}
        pinnedModelIds={pinnedModelIds}
        compatibilityByModelKey={compatibilityByModelKey}
        defaultAgentModelId={defaultAgentModelId}
        isStreaming={runtimeStatusBySessionId[activeSession.id] === 'pending'}
        chatSettings={chatSettings}
        onStateChange={onStateChange}
      />
    </main>
  )
}

function mergeMessageWindows(
  olderMessages: AgentSessionMessageWindow['messages'],
  latestMessages: AgentSessionMessageWindow['messages']
) {
  const seen = new Set<string>()
  const next = [...olderMessages, ...latestMessages].filter((message) => {
    if (seen.has(message.id)) return false
    seen.add(message.id)
    return true
  })
  return next
}
