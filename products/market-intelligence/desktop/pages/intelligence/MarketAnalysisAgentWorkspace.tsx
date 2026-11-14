import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ReactNode } from 'react'
import { Button } from 'antd'
import { Bot } from 'lucide-react'
import { AgentChatSurface } from '@renderer/shell/agents/AgentChatSurface'
import { LoadingState } from '@platform/ui/components/loading'
import { StateView } from '@platform/ui/components/state'
import type { productText } from '../../shared/i18n/productText'
import type { AnalysisWorkspaceBinding } from '../../../contracts/analysisWorkspaceContracts'
import type { MarketAnalysisTimelineEntry } from '../../shared/ipc/marketAnalysisTimelineClient'
import type { AnalysisSelectionState, UseMarketAnalysisTimelineResult } from './useMarketAnalysisTimeline'
import { useMarketAnalysisTimeline } from './useMarketAnalysisTimeline'
import { NewsSentimentFeature } from '../../features/industry/news-sentiment'
import { newsSentimentClient } from '../../shared/ipc/newsSentimentClient'
import type { MarketAnalysisTimelineText } from './MarketAnalysisTimeline'
import { MarketAnalysisSessionMenu } from './MarketAnalysisSessionMenu'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { createMarketAnalysisContextRenderers } from './MarketAnalysisContextCard'
import { marketAnalysisRunSessionText } from './marketAnalysisRunSessionText'
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
  language?: 'zh-CN' | 'en-US'
  /** The calendar card that takes the conversation's place in the column. */
  card?: ReactNode
  /** Rendered above the card: the dashboard's policy reading, portalled in by the page. */
  railHeader?: ReactNode
  /** The calendar event the reader selected, as the line the card itself rendered. */
  selectedContextLabel?: string
  /** Its key and month, needed to read the facts the system holds for it. */
  selectedEventKey?: string
  selectedEventMonth?: string
  onClearSelectedContext?: () => void
  /**
   * 透传给舆情 feature：打开配置抽屉并落到「采集与数据」的舆情组。
   * **必须收 focus**：feature 知道自己要的是哪一组，中间层把参数丢掉，读者就会停在第一屏。
   */
  onOpenSettings?: (focus: Readonly<{ business: 'sentiment' }>) => void
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
export function MarketAnalysisAgentWorkspace({ text, language = 'zh-CN', onOpenSettings, timeline: injectedTimeline, selectionState: injectedState, binding: injectedBinding, onBindingChange, card, railHeader, floatingText, selectedContextLabel, selectedEventKey, selectedEventMonth, onClearSelectedContext }: Props): React.ReactElement {
  const t = text.analysisWorkspace
  const resolveProductText = useProductTextKey()
  const contextRenderers = useMemo(
    () => createMarketAnalysisContextRenderers({
      analysis: t.contextAnalysis,
      event: t.selectedEvent,
      runSession: marketAnalysisRunSessionText[language],
      failureReasons: text.analysisTimeline.failureReasons
    }),
    [t.contextAnalysis, t.selectedEvent, language, text.analysisTimeline.failureReasons]
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
  const container = useRef<HTMLElement>(null)
  const panes = useRef<HTMLDivElement>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [selectedNews, setSelectedNews] = useState<{ itemId: string; title: string }>()

  useEffect(() => {
    if (selectedContextLabel) setSelectedNews(undefined)
  }, [selectedContextLabel])
  // A selected calendar event travels with the question as an identity reference, the same way a
  // bound analysis node does, so the agent knows exactly which event is being asked about.
  // The matching timeline entry supplies the readable card title; never show the raw run ids.
  const selectedAnalysisTitle = binding
    ? timeline?.state.entries.find(entry => entry.analysisRunId === binding.analysisRunId)?.safeTitle
      ?? (timeline?.state.selected?.analysisRunId === binding.analysisRunId ? timeline.state.selected.safeTitle : undefined)
    : undefined
  const calendarContext = selectedContextLabel ? {
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
  } : undefined
  const newsContext = selectedNews ? {
    label: selectedNews.title,
    reference: `[${text.newsSentiment.title}: ${selectedNews.title}]`,
    payload: { itemId: selectedNews.itemId },
    facts: async () => {
      const detail = await newsSentimentClient.getItem({ itemId: selectedNews.itemId, asOf: new Date().toISOString() })
      if (!detail) return `${text.newsSentiment.title}: ${selectedNews.title}`
      const body = detail.translatedBodyExcerpt ?? detail.bodyExcerpt ?? ''
      return [
        `${text.newsSentiment.title}: ${selectedNews.title}`,
        `${text.newsSentiment.drawer.filters.source}: ${detail.sourceName} · ${detail.publishedAt}`,
        `${text.newsSentiment.labels[detail.polarity] ?? detail.polarity} · ${detail.strength}/5 · ${detail.confidence}%`,
        body.slice(0, 3_000)
      ].join('\n')
    }
  } : undefined
  const chatContext = newsContext ?? calendarContext
  const chat = useMarketAnalysisChat(binding, t.newConversation, chatContext, selectedAnalysisTitle ?? t.contextAnalysis)

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
            historyState={chat.historyState}
            currentSessionId={chat.sessionId}
            text={{
              newChat: t.newChatAction,
              history: t.sessionHistory,
              delete: t.deleteSession,
              deleteConfirm: t.deleteSessionConfirm,
              cancel: t.cancel,
              untitledSession: t.untitledSession
            }}
            onNewConversation={() => void chat.startNewConversation()}
            onSelectConversation={chat.selectConversation}
            onDeleteConversation={sessionId => void chat.deleteConversation(sessionId)}
          />
        </header>
        <div className="mi-analysis-chat__binding">
          {/* No hint here: the row wraps (`overflow-wrap: anywhere`), so the whole title is on
              screen. A tooltip that repeats visible text only added a hover-only duplicate and a
              Tab stop with nothing to say. */}
          {selectedNews
            ? <span>{t.selectedNews}·{selectedNews.title}</span>
            : selectedContextLabel
              ? <span>{t.selectedEvent}·{selectedContextLabel}</span>
              : selectionBlocked ? <span>{selectionState === 'loading' ? text.analysisTimeline.loading : text.analysisTimeline.unavailable}</span> : binding ? <span>{t.selectedAnalysis}</span> : <span>{t.noSelection}</span>}
          {selectedNews
            ? <Button size="small" type="text" onClick={() => setSelectedNews(undefined)}>{t.clearSelection}</Button>
            : selectedContextLabel && onClearSelectedContext
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
              emptyState={<StateView
                state="empty"
                reasonCode="not-yet"
                productReason={{ key: 'pages.intelligence.portal.analysisWorkspace.empty', resolve: resolveProductText }}
              />}
            />
          : chat.failed || selectionState === 'unavailable'
            ? <p className="mi-analysis-chat__pending" role="status">{chat.failed ? t.failed : text.analysisTimeline.unavailable}</p>
            : <LoadingState label={selectionState === 'loading' ? text.analysisTimeline.loading : t.loading} fill />}
      </section>

  // 右栏现在只有一块（日历卡那行已搬走）：没有可拖的两块，`--mi-chat-percent` 与拖拽状态一并撤掉。
  return <aside ref={container} className="mi-analysis-agent-workspace" aria-label={t.title}>
    {/* The policy card keeps its own row; the calendar and the news share what is left in half. */}
    {railHeader}

    <div className="mi-analysis-agent-workspace__panes" ref={panes}>
    {/* 日历卡那一行搬走后这里只剩一块：不再有可拖的两块，也不留一条空带。
        卡与舆情之间靠 `--mi-agent-gap`（12）隔开——两块都有边框，贴 0 会成 2px 双线。 */}
    {card === undefined ? null : <div className="mi-analysis-agent-workspace__card">{card}</div>}
    <NewsSentimentFeature
      {...(onOpenSettings === undefined ? {} : { onOpenSettings })}
      language={language}
      text={text.newsSentiment}
      onSelectContext={(item) => { onClearSelectedContext?.(); setSelectedNews({ itemId: item.itemId, title: item.displayTitle ?? item.title }) }}
    />
    </div>
    <AgentFloatingControl onOpenChange={setChatOpen} text={floatingText}>{chatPanel}</AgentFloatingControl>
  </aside>
}
