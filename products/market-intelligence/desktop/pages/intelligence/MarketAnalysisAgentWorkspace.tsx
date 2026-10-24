import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ReactNode } from 'react'
import { Button } from 'antd'
import { Bot } from 'lucide-react'
import { AgentChatSurface } from '@renderer/shell/agents/AgentChatSurface'
import type { productText } from '../../shared/i18n/productText'
import type { AnalysisWorkspaceBinding } from '../../../contracts/analysisWorkspaceContracts'
import type { MarketAnalysisTimelineEntry } from '../../shared/ipc/marketAnalysisTimelineClient'
import type { AnalysisSelectionState, UseMarketAnalysisTimelineResult } from './useMarketAnalysisTimeline'
import { useMarketAnalysisTimeline } from './useMarketAnalysisTimeline'
import { NewsSentimentFeature } from '../../features/industry/news-sentiment'
import type { MarketAnalysisTimelineText } from './MarketAnalysisTimeline'
import { analysisWorkspaceLayoutPolicy as layout } from './analysisWorkspaceLayoutPolicy'
import { MarketAnalysisSessionMenu } from './MarketAnalysisSessionMenu'
import { createMarketAnalysisContextRenderers } from './MarketAnalysisContextCard'
import { useMarketAnalysisChat } from './useMarketAnalysisChat'
import { AgentFloatingControl, type AgentFloatingControlText } from './AgentFloatingControl'
import { analysisWorkspacePolicy } from '../../../contracts/analysisWorkspaceContracts'
import { MARKET_ANALYSIS_IPC_METHODS } from '../../../contracts/marketAnalysisIpcContracts'
import type { MacroCalendarEventContextResult } from '../../../service/intelligence/public-query/macroCalendarEventContextQuery'
import { formatCalendarEventFactContext } from './calendarEventFactContext'

type Props = {
  text: typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']
  /** Owned by the dashboard layout so the card, list and drawer share one source. */
  timeline?: UseMarketAnalysisTimelineResult
  selectionState?: AnalysisSelectionState
  binding?: AnalysisWorkspaceBinding
  onBindingChange?: (binding: AnalysisWorkspaceBinding | undefined) => void
  openEntry?: MarketAnalysisTimelineEntry
  onOpenChange?: (entry: MarketAnalysisTimelineEntry | undefined) => void
  timelineText?: MarketAnalysisTimelineText
  /** The calendar card that takes the conversation's place in the column. */
  card?: ReactNode
  /** The calendar event the reader selected, as the line the card itself rendered. */
  selectedContextLabel?: string
  /** Its key and month, needed to read the facts the system holds for it. */
  selectedEventKey?: string
  selectedEventMonth?: string
  onClearSelectedContext?: () => void
  floatingText: AgentFloatingControlText
}

/**
 * Agent column: conversation on top, timeline list underneath, with the
 * conversation/timeline divider in between. The node detail drawer is rendered
 * by the dashboard pane instead, so it can slide over the dashboard.
 *
 * When no timeline result is injected the column owns one itself, which keeps
 * the embedded workspace usable on its own.
 */
export function MarketAnalysisAgentWorkspace({ text, timeline: injectedTimeline, selectionState: injectedState, binding: injectedBinding, onBindingChange, card, floatingText, selectedContextLabel, selectedEventKey, selectedEventMonth, onClearSelectedContext }: Props): React.ReactElement {
  const t = text.analysisWorkspace
  const contextRenderers = useMemo(
    () => createMarketAnalysisContextRenderers({ analysis: t.contextAnalysis, event: t.selectedEvent }),
    [t.contextAnalysis, t.selectedEvent]
  )
  const [ownBinding, setOwnBinding] = useState<AnalysisWorkspaceBinding>()
  const [ownSelectionState, setOwnSelectionState] = useState<AnalysisSelectionState>('none')
  const ownTimeline = useMarketAnalysisTimeline({
    text: { loading: text.analysisTimeline.loading, unavailable: text.analysisTimeline.unavailable, attemptFailed: text.analysisTimeline.attemptFailed, failureReasons: text.analysisTimeline.failureReasons, initialAnalysisFailed: text.analysisTimeline.initialAnalysisFailed },
    onSelect: setOwnBinding,
    onSelectionStateChange: setOwnSelectionState,
    // Dormant when the layout already owns the timeline; this fallback only
    // serves standalone use of the workspace.
    enabled: !injectedTimeline
  })
  const timeline = injectedTimeline ?? ownTimeline
  const selectionState = injectedState ?? ownSelectionState
  const binding = injectedBinding ?? ownBinding
  const setBinding = onBindingChange ?? setOwnBinding
  const selectionBlocked = selectionState === 'loading' || selectionState === 'unavailable'
  const [chatPercent, setChatPercent] = useState<number>(layout.initialChatPercent)
  const container = useRef<HTMLElement>(null)
  const [chatOpen, setChatOpen] = useState(false)
  // A selected calendar event travels with the question as an identity reference, the same way a
  // bound analysis node does, so the agent knows exactly which event is being asked about.
  // The matching timeline entry supplies the readable card title; never show the raw run ids.
  const selectedAnalysisTitle = binding
    ? timeline?.state.entries.find(entry => entry.analysisRunId === binding.analysisRunId)?.safeTitle
      ?? (timeline?.state.selected?.analysisRunId === binding.analysisRunId ? timeline.state.selected.safeTitle : undefined)
    : undefined
  const chat = useMarketAnalysisChat(binding, t.newConversation, selectedContextLabel ? {
    label: selectedContextLabel,
    reference: `[${text.calendarCard.eventContext.heading}: ${selectedContextLabel}]`,
    ...(selectedEventKey && selectedEventMonth ? { payload: { eventKey: selectedEventKey, month: selectedEventMonth } } : {}),
    // Read on demand, so the facts travel with the question rather than being fetched while idle.
    ...(selectedEventKey && selectedEventMonth ? { facts: async () => {
      const data = await window.platform.products.invoke(analysisWorkspacePolicy.productId, MARKET_ANALYSIS_IPC_METHODS.calendarEventContext, {
        eventKey: selectedEventKey, month: selectedEventMonth, asOf: new Date().toISOString()
      }) as MacroCalendarEventContextResult
      return formatCalendarEventFactContext(data, text.calendarCard.eventContext)
    } } : {})
  } : undefined, selectedAnalysisTitle ?? t.contextAnalysis)
  const resize = (percent: number) => setChatPercent(Math.max(layout.minChatPercent, Math.min(layout.maxChatPercent, percent)))

  // The conversation lives in the floating control now; the card takes its grid row.
  // The surface is the agent page's own message list and composer, so the panel and the full
  // agent page cannot drift apart; the panel only supplies the conversation identity and the
  // locked context it appends to each question.
  useEffect(() => {
    if (!chatOpen || selectionBlocked || chat.sessionId || !chat.agent) return
    void chat.ensureSession().catch(() => undefined)
  }, [chatOpen, selectionBlocked, chat.sessionId, chat.agent, chat.ensureSession])

  const chatPanel = <section className="mi-analysis-chat" aria-label={t.chat}>
        <header>
          <Bot size={16} aria-hidden="true" />
          <h2>{t.title}</h2>
          <small>{chat.agent?.modelName ?? t.loading}</small>
          <MarketAnalysisSessionMenu
            sessions={chat.sessions}
            currentSessionId={chat.sessionId}
            text={{
              newChat: t.newChatAction,
              history: t.sessionHistory,
              delete: t.deleteSession,
              deleteConfirm: t.deleteSessionConfirm,
              cancel: t.cancel,
              empty: t.noSessions
            }}
            onNewConversation={() => void chat.startNewConversation()}
            onSelectConversation={chat.selectConversation}
            onDeleteConversation={sessionId => void chat.deleteConversation(sessionId)}
          />
        </header>
        <div className="mi-analysis-chat__binding">
          {selectedContextLabel
            ? <span title={selectedContextLabel}>{t.selectedEvent}·{selectedContextLabel}</span>
            : selectionBlocked ? <span>{selectionState === 'loading' ? text.analysisTimeline.loading : text.analysisTimeline.unavailable}</span> : binding ? <span>{t.selectedAnalysis}</span> : <span>{t.noSelection}</span>}
          {selectedContextLabel && onClearSelectedContext
            ? <Button size="small" type="text" onClick={onClearSelectedContext}>{t.clearSelection}</Button>
            : binding || selectionState === 'unavailable' ? <Button size="small" type="text" onClick={() => setBinding(undefined)}>{t.clearSelection}</Button> : null}
        </div>
        {chat.sessionId && chat.agent
          ? <AgentChatSurface
              agentId={chat.agent.id}
              sessionId={chat.sessionId}
              composeText={chat.composeOutgoingText}
              contextRenderers={contextRenderers}
              disabled={selectionBlocked}
              emptyState={<p className="mi-analysis-chat__empty">{t.empty}</p>}
            />
          : <p className="mi-analysis-chat__pending" role="status">{chat.failed ? t.failed : selectionBlocked ? (selectionState === 'loading' ? text.analysisTimeline.loading : text.analysisTimeline.unavailable) : t.loading}</p>}
      </section>

  return <aside ref={container} className="mi-analysis-agent-workspace" aria-label={t.title} style={{ '--mi-chat-percent': `${chatPercent}%` } as CSSProperties}>
    {card}

    <div className="mi-analysis-agent-workspace__divider" role="separator" tabIndex={0} aria-label={t.resize} aria-orientation="horizontal" aria-valuemin={layout.minChatPercent} aria-valuemax={layout.maxChatPercent} aria-valuenow={chatPercent}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); resize(chatPercent + (event.key === 'ArrowDown' ? layout.keyboardStepPercent : -layout.keyboardStepPercent)) } }}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const rect = container.current?.getBoundingClientRect(); if (rect?.height) resize((event.clientY - rect.top) / rect.height * layout.percentScale) }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
    />
    <NewsSentimentFeature text={text.newsSentiment} />
    <AgentFloatingControl onOpenChange={setChatOpen} text={floatingText}>{chatPanel}</AgentFloatingControl>
  </aside>
}
