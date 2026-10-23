import { Button } from 'antd'
import { useMemo } from 'react'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentSessionEntity, AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import type { AgentSessionRuntimeSnapshot } from '@platform/ai/agent-platform/runtime/runtimeTypes'
import type { ChatSettings } from '@platform/settings/schema/appSettings'

import SelectionContextMenu from '../../SelectionContextMenu'
import type { AgentContextRendererRegistry } from '../agentContextRenderers'
import { buildAgentMessageAnchorItems } from '../agentMessageNavigation'
import { groupAgentSessionMessages, type AgentMessageGroup } from '@platform/ui/agent-chat'
import { useAgentText } from '../agentTextProvider'
import { buildAgentRuntimeActivityCards } from '../agentRuntimeActivityViewModel'
import { hasPersistedRuntimeParts, selectLiveActivityCards } from '../agentLiveTraceSelection'
import { resolveAgentRuntimePhaseText } from '../agentRuntimePhaseText'
import AgentMessageAnchorRail from './AgentMessageAnchorRail'
import AgentMessageNavigation from './AgentMessageNavigation'
import AgentSessionMessageGroup from './AgentSessionMessageGroup'
import AgentSessionUsageBar from './AgentSessionUsageBar'
import { useAgentSessionMessageScroll } from './useAgentSessionMessageScroll'
import { useAgentSessionMessageVirtualization } from './useAgentSessionMessageVirtualization'

type AgentSessionMessagesProps = {
  activeAgent: AgentEntity
  activeSession: AgentSessionEntity
  messages: AgentSessionMessageEntity[]
  runtimeSnapshot: AgentSessionRuntimeSnapshot
  hasOlder: boolean
  onLoadOlder: () => void
  chatSettings: ChatSettings | null
  onStateChange: (updater: (state: AgentStoreState) => AgentStoreState) => void
  onRuntimeSnapshotChange: (snapshot: AgentSessionRuntimeSnapshot) => void
  /** Full persisted history for usage totals; falls back to the rendered window. */
  usageMessages?: readonly AgentSessionMessageEntity[]
  /** Host-owned renderers for message contexts (analysis node, calendar event, ...). */
  contextRenderers?: AgentContextRendererRegistry
  /** Host copy for an empty conversation; a vertical surface owns its own wording. */
  emptyState?: React.ReactNode
}

export default function AgentSessionMessages({
  activeAgent,
  activeSession,
  messages,
  runtimeSnapshot,
  hasOlder,
  onLoadOlder,
  chatSettings,
  onStateChange,
  onRuntimeSnapshotChange,
  usageMessages,
  contextRenderers,
  emptyState
}: AgentSessionMessagesProps): React.ReactElement {
  const t = useAgentText()
  const groups = useMemo(() => groupAgentSessionMessages(messages), [messages])
  const runtimeActivityCards = useMemo(
    () =>
      buildAgentRuntimeActivityCards({
        sessionId: activeSession.id,
        chunksBySessionId: runtimeSnapshot.chunksBySessionId,
        toolApprovals: runtimeSnapshot.toolApprovals,
        toolApprovalHistory: runtimeSnapshot.toolApprovalHistory,
        text: t.runtimeActivity
      }),
    [activeSession.id, runtimeSnapshot.chunksBySessionId, runtimeSnapshot.toolApprovalHistory, runtimeSnapshot.toolApprovals, t.runtimeActivity]
  )
  const {
    shouldVirtualize,
    scrollContainerRef,
    shouldStickToBottomRef,
    messageElementRefs,
    groupElementRefs,
    activeAnchorMessageId,
    setActiveAnchorMessageId,
    isAtBottom,
    setIsAtBottom,
    measuredGroupHeights,
    virtualItems,
    virtualWindow,
    visibleGroups,
    capturePrependSnapshot
  } = useAgentSessionMessageVirtualization({
    messages,
    groups,
    hasOlder,
    chatSettings
  })
  const anchorItems = useMemo(
    () =>
      buildAgentMessageAnchorItems(messages, {
        assistantName: activeAgent.name,
        userName: t.messages.userName,
        nonTextContent: t.messages.nonTextContent
      }),
    [activeAgent.name, messages, t.messages.nonTextContent, t.messages.userName]
  )
  const { navigateToRelativeMessage, scrollToBoundary, scrollToMessage } = useAgentSessionMessageScroll({
    messages,
    groups,
    virtualItems,
    measuredGroupHeights,
    activeAnchorMessageId,
    setActiveAnchorMessageId,
    setIsAtBottom,
    scrollContainerRef,
    messageElementRefs,
    shouldStickToBottomRef
  })

  const liveAssistantGroup = [...groups].reverse().find((group) => group.role === 'assistant')
  const turnRunning =
    runtimeSnapshot.sessions[activeSession.id]?.turnState === 'running' ||
    runtimeSnapshot.sessions[activeSession.id]?.turnState === 'queued'
  const livePhaseText = resolveAgentRuntimePhaseText({
    phase: runtimeSnapshot.sessions[activeSession.id]?.turnPhase ?? null,
    cards: runtimeActivityCards,
    text: t.runtimeText
  })
  const turnTrace = liveAssistantGroup
    ? buildTurnTrace(liveAssistantGroup, turnRunning)
    : null

  if (messages.length === 0 && runtimeActivityCards.length === 0) {
    if (emptyState) return <>{emptyState}</>
    return (
      <div className="agent-message-empty">
        <strong>{t.messages.emptyTitle}</strong>
        <span>{t.messages.emptyDescription}</span>
      </div>
    )
  }

  return (
    <div className="agent-message-region-shell">
      <div ref={scrollContainerRef} className="agent-message-scroll-region">
        <SelectionContextMenu
          copyLabel={t.messages.copy}
          quoteLabel={t.messages.quote}
          onQuote={(selectedText) => void window.platform.app.quoteToMainWindow(selectedText)}>
          <div
            className={[
              chatSettings?.messageStyle === 'bubble' ? 'agent-message-list bubble' : 'agent-message-list',
              chatSettings?.narrowMode ? 'narrow' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ '--agent-message-font-size': `${chatSettings?.fontSize ?? 14}px` } as React.CSSProperties}>
            {hasOlder ? (
              <div className="agent-message-history-action">
                <Button
                  size="small"
                  onClick={() => {
                    capturePrependSnapshot()
                    onLoadOlder()
                  }}>
                  {t.messages.loadOlder}
                </Button>
              </div>
            ) : null}
            {shouldVirtualize && virtualWindow.paddingTop > 0 ? (
              <div aria-hidden="true" style={{ height: `${virtualWindow.paddingTop}px` }} />
            ) : null}
            {visibleGroups.map((group) => (
              <AgentSessionMessageGroup
                key={group.id}
                group={group}
                activeAgent={activeAgent}
                activeSessionId={activeSession.id}
                activeSessionWorkspacePath={activeSession.workspace.path}
                chatSettings={chatSettings}
                text={{
                  messages: t.messages,
                  runtimeActivity: t.runtimeActivity,
                  runtimeText: t.runtimeText,
                  input: t.input
                }}
                onStateChange={onStateChange}
                pendingStatusText={
                  group.id === liveAssistantGroup?.id ? livePhaseText ?? undefined : undefined
                }
                {...(contextRenderers ? { contextRenderers } : {})}
                onGroupElementRef={(groupId, element) => {
                  groupElementRefs.current[groupId] = element
                }}
                onMessageElementRef={(messageId, element) => {
                  messageElementRefs.current[messageId] = element
                }}
                runtimeActivity={
                  turnTrace && group.id === liveAssistantGroup?.id
                    ? {
                        cards: selectLiveActivityCards(
                          runtimeActivityCards,
                          // Only the message this turn is writing matters; earlier turns in the
                          // same group already own their own persisted trace.
                          hasPersistedRuntimeParts(group.messages.slice(-1))
                        ),
                        onRuntimeSnapshotChange,
                        elapsedMs: turnTrace.elapsedMs,
                        running: turnRunning,
                        failure: turnTrace.failure
                      }
                    : undefined
                }
              />
            ))}
            {shouldVirtualize && virtualWindow.paddingBottom > 0 ? (
              <div aria-hidden="true" style={{ height: `${virtualWindow.paddingBottom}px` }} />
            ) : null}
          </div>
        </SelectionContextMenu>
        <AgentSessionUsageBar
          messages={usageMessages ?? messages}
          narrow={chatSettings?.narrowMode === true}
        />
      </div>
      {chatSettings?.messageNavigation === 'buttons' ? (
        <AgentMessageNavigation
          onTop={() => scrollToBoundary('top')}
          onPrevious={() => navigateToRelativeMessage('previous')}
          onNext={() => navigateToRelativeMessage('next')}
          onBottom={() => scrollToBoundary('bottom')}
        />
      ) : null}
      {chatSettings?.messageNavigation === 'anchor' ? (
        <AgentMessageAnchorRail
          items={anchorItems}
          activeMessageId={activeAnchorMessageId}
          bottomActive={isAtBottom}
          ariaLabel={t.messages.anchorRailAria}
          onBottom={() => scrollToBoundary('bottom')}
          onSelectMessage={(messageId) => {
            scrollToMessage(messageId)
          }}
        />
      ) : null}
    </div>
  )
}


function buildTurnTrace(
  group: AgentMessageGroup,
  running: boolean
): {
  elapsedMs?: number
  failure: { message: string; code?: string | null } | null
} {
  const timestamps = group.messages.flatMap((message) => {
    const created = Date.parse(message.createdAt)
    const updated = Date.parse(message.updatedAt)
    return [created, updated].filter((value) => Number.isFinite(value))
  })
  const startedAt = timestamps.length > 0 ? Math.min(...timestamps) : NaN
  const finishedAt = timestamps.length > 0 ? Math.max(...timestamps) : NaN
  const elapsedMs =
    Number.isFinite(startedAt) && Number.isFinite(finishedAt)
      ? Math.max(0, finishedAt - startedAt)
      : undefined
  const last = group.messages.at(-1)
  const failure =
    !running && last?.status === 'error'
      ? { message: last.searchableText, code: extractFailureCode(last.searchableText) }
      : null
  return { elapsedMs, failure }
}

function extractFailureCode(message: string): string | null {
  const http = message.match(/\b(\d{3})\b/)
  if (http) return http[1] ?? null
  const named = message.match(/\b([A-Z][A-Z0-9_]{2,})\b/)
  return named?.[1] ?? null
}
