import { cloneElement, useCallback, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Segmented } from 'antd'
import type { MarketAnalysisReadableLocale } from '../../../contracts/marketAnalysisReadableText'
import type { productText } from '../../shared/i18n/productText'
import type { AnalysisWorkspaceBinding } from '../../../contracts/analysisWorkspaceContracts'
import type { MarketAnalysisTimelineEntry } from '../../shared/ipc/marketAnalysisTimelineClient'
import { MarketAnalysisAgentWorkspace } from './MarketAnalysisAgentWorkspace'
import { MarketCalendarCard } from './MarketCalendarCard'
import { useCalendarCardData, type CalendarCardReactionReader } from './useCalendarCardData'
import { AnalysisDetailDrawer } from './AnalysisDetailDrawer'
import { AnalysisTimelineDrawer } from './AnalysisTimelineDrawer'
import { MarketAnalysisSettingsDialog } from './MarketAnalysisSettingsDialog'
import { LatestAnalysisConclusionCard } from './LatestAnalysisConclusionCard'
import type { AnalysisSelectionState } from './useMarketAnalysisTimeline'
import { useMarketAnalysisTimeline } from './useMarketAnalysisTimeline'
import { useSampleNow } from './SampleModeProvider'
import type { CrossAssetEventLine } from '../../features/industry/cross-asset/crossAssetEventLines'
import { chartEventSelection, openEventDetailThenRecord, type SelectedCalendarEvent } from './selectedCalendarEvent'
import './marketAnalysisWorkspace.css'

/**
 * What the layout injects into the dashboard child.
 *
 * The child is composed by the page entry (which owns the product text registry) and rendered here
 * (which owns the timeline, the calendar card and the Agent column), so the seam between them is
 * named rather than left as an anonymous object.
 */
export type MarketAnalysisDashboardInjection = Readonly<{
  conclusionSlot?: (node: HTMLDivElement | null) => void
  /** The calendar's event-title vocabulary, read once by the page entry and rendered by the panel. */
  calendarEventTitles?: Record<string, string>
  /** The 0xRouter month's events, read once here because the page owns the locale and the client. */
  readMarketEvents?: (month: string, asOf: string) => Promise<readonly unknown[] | null>
  /** A chart event line the reader picked: the page opens its detail and records it. */
  onSelectChartEvent?: (line: CrossAssetEventLine, month: string) => void
}>

/**
 * Owns the market analysis workspace surface.
 *
 * The timeline data lives here so the latest-conclusion card, the timeline list
 * and the node detail drawer share one fetch and one selection. The card sits at
 * the top of the main dashboard; the drawer is rendered in the dashboard pane so
 * it can slide over the dashboard without covering the Agent column.
 *
 * The card is not a sibling of the dashboard header: it is portalled into the
 * named mount point the dashboard renders under its macro release strip, so the
 * dashboard keeps owning its own layout and knows nothing about timeline state.
 *
 * Timeline copy and workspace copy stay separate on purpose: both registries
 * define keys such as `empty`, `loading` and `title`, and merging them would let
 * one surface silently display the other surface's text.
 */
export function MarketAnalysisDashboardLayout({ children, text, locale, onOpenCalendar = () => undefined, calendarEventTitles, readMarketEvents, renderEventDetailDrawer, readCalendarReaction }: { children: ReactNode; text: typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']; locale?: MarketAnalysisReadableLocale; onOpenCalendar?: (month: string, eventKey?: string) => void
  /**
   * The calendar's own title vocabulary, read from the product registry by the page entry.
   *
   * It is handed down rather than copied because the calendar already owns one list of event names,
   * and a second copy is how two surfaces start naming the same release differently. The cross-asset
   * panel takes it as an optional extra and falls back to the key, so a page without it draws the
   * lines unnamed instead of inventing names.
   */
  calendarEventTitles?: Record<string, string>
  /**
   * The 0xRouter month reader, built by the page entry (which owns the locale and the client) and
   * narrowed to the month's events.
   *
   * Injected rather than imported so neither this layout nor the cross-asset feature learns the
   * provider route's paging or its language: the chart's event lines read both calendars through it.
   * The event drawer takes the same reader's full answer, sources included, from the page directly.
   */
  readMarketEvents?: (month: string, asOf: string) => Promise<readonly unknown[] | null>
  /**
   * The page's own event-detail surface, injected rather than imported: the cross-asset feature must
   * never learn the calendar's text contract, and the page is the one layer that may know both.
   */
  renderEventDetailDrawer?: (selection: SelectedCalendarEvent, onClose: () => void) => ReactNode
  /**
   * 「±30 分」反应的读取器，由页面注入（它才拥有跨资产那条查询与它的客户端）。不注入就没有那一行。
   */
  readCalendarReaction?: CalendarCardReactionReader }): React.ReactElement {
  const [view, setView] = useState('dashboard')
  const [binding, setBinding] = useState<AnalysisWorkspaceBinding>()
  const [selectionState, setSelectionState] = useState<AnalysisSelectionState>('none')
  const [openEntryId, setOpenEntryId] = useState<string>()
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [analysisSettingsOpen, setAnalysisSettingsOpen] = useState(false)
  const [conclusionHost, setConclusionHost] = useState<HTMLDivElement | null>(null)
  // Frozen at mount: a new instant per render would re-query the calendar on every render.
  // One selection at a time, shared by the timeline entries and the calendar card, so the floating
  // agent is never apart from what the reader is looking at.
  const [selectedContext, setSelectedContext] = useState<{ key: string; label: string; eventKey: string; month: string }>()
  /** The chart line the reader opened, whose detail the page draws. Independent of the record below. */
  const [eventDetail, setEventDetail] = useState<SelectedCalendarEvent>()
  const sampleNow = useSampleNow()
  const [cardAsOf] = useState(() => sampleNow().toISOString())
  const cardData = useCalendarCardData({ asOf: cardAsOf, locale: locale === 'en-US' ? 'en' : 'zh', ...(readCalendarReaction ? { readReaction: readCalendarReaction } : {}) })
  const timeline = useMarketAnalysisTimeline({
    text: {
      loading: text.analysisTimeline.loading,
      unavailable: text.analysisTimeline.unavailable,
      attemptFailed: text.analysisTimeline.attemptFailed,
      failureReasons: text.analysisTimeline.failureReasons,
      initialAnalysisFailed: text.analysisTimeline.initialAnalysisFailed
    },
    onSelect: setBinding,
    onSelectionStateChange: setSelectionState
  })
  const timelineText = text.analysisTimeline
  const workspaceText = text.analysisWorkspace
  // The detail surfaces read the direction vocabulary and the readable identifier names from
  // the workspace registry, so timeline copy and workspace copy are combined only here.
  // The structured change list follows the reader's locale; the conclusion prose is named from
  // its own Chinese vocabulary (see `analysisConclusionVocabulary.ts`).
  const detailText = { ...timelineText, ...workspaceText, ...(locale ? { readableLocale: locale } : {}) }
  const openEntry = openEntryId ? timeline.state.entries.find(entry => entry.id === openEntryId) : undefined
  const setOpenEntry = (entry: MarketAnalysisTimelineEntry | undefined) => setOpenEntryId(entry?.id)
  // The dashboard renders this ref as a named mount point directly under the
  // macro release strip; the card is portalled into it so the dashboard stays
  // free of timeline state while the card reads as part of the dashboard.
  const conclusionSlot = useCallback((node: HTMLDivElement | null) => setConclusionHost(node), [])
  /**
   * A chart line the reader picked.
   *
   * It is the same "current context" the calendar card writes, so the Agent is bound to the event
   * whichever entry selected it. The drawer opens first and unconditionally — the click means "show
   * me what that was" — while recording is additive and must never stand in the way of that.
   */
  const selectChartEvent = (line: CrossAssetEventLine, month: string): void => {
    const selection = chartEventSelection(line, month)
    if (!selection) return
    // One active context: a chart event is the last selection, so it clears the timeline node
    // (and cancels any in-flight node detail read) before recording itself.
    timeline.clearSelection()
    setOpenEntry(undefined)
    openEventDetailThenRecord(selection, setEventDetail, recorded => setSelectedContext({
      key: `calendar-event:${recorded.eventKey}`, label: recorded.label, eventKey: recorded.eventKey, month: recorded.month
    }))
  }

  return <div className="mi-analysis-dashboard-layout" data-compact-view={view}>
    <div className="mi-analysis-dashboard-layout__switch"><Segmented aria-label={workspaceText.view} value={view} onChange={setView} options={[{ value: 'dashboard', label: workspaceText.dashboard }, { value: 'agent', label: workspaceText.title }]} /></div>
    <div className="mi-analysis-dashboard-layout__panes">
      <div className="mi-analysis-dashboard-layout__dashboard">
        {conclusionHost ? createPortal(<LatestAnalysisConclusionCard
          text={detailText}
          workspaceText={workspaceText}
          timeline={timeline}
          onOpenDetail={entry => { setOpenEntry(entry); timeline.ensureDetail(entry) }}
          onOpenTimeline={() => setTimelineOpen(true)}
          onOpenAnalysisSettings={() => setAnalysisSettingsOpen(true)}
          openTimelineLabel={text.analysisDrawer.open}
          enableAnalysisLabel={text.analysisTimeline.enableAnalysis}
          analysisOffHint={text.analysisTimeline.analysisOffHint}
        />, conclusionHost) : null}
        {/* The dashboard owns its layout; it renders the mount point and this
            layout only supplies the ref, so `children` gets the injected prop. The calendar's
            event-title vocabulary and the chart's click travel the same way: the page reads the
            list once, the panel renders it and hands the picked line back up. */}
        {cloneElement(children as React.ReactElement<MarketAnalysisDashboardInjection>, {
          conclusionSlot,
          onSelectChartEvent: selectChartEvent,
          ...(calendarEventTitles ? { calendarEventTitles } : {}),
          ...(readMarketEvents ? { readMarketEvents } : {})
        })}
        <MarketAnalysisSettingsDialog
          onClose={() => setAnalysisSettingsOpen(false)}
          open={analysisSettingsOpen}
          text={text.analysisTimeline}
        />
        <AnalysisTimelineDrawer
          onClose={() => setTimelineOpen(false)}
          onOpenChange={setOpenEntry}
          open={timelineOpen}
          openEntry={openEntry}
          text={text.analysisTimeline}
          timeline={timeline}
          title={text.analysisDrawer.title}
          closeLabel={text.analysisDrawer.close}
        />
        <AnalysisDetailDrawer
          text={detailText}
          workspaceText={workspaceText}
          timeline={timeline}
          openEntry={openEntry}
          onOpenChange={setOpenEntry}
        />
        {/* The reader's event detail, drawn by the page over this same pane: left and unmasked, so
            the chart it came from stays visible underneath. */}
        {eventDetail && renderEventDetailDrawer ? renderEventDetailDrawer(eventDetail, () => setEventDetail(undefined)) : null}
      </div>
<MarketAnalysisAgentWorkspace
        language={locale ?? 'zh-CN'}
        floatingText={{ open: text.calendarCard.expandAgent, close: text.calendarCard.closeAgent, title: text.calendarCard.agentTitle, clear: text.calendarCard.clearConversation }}
        card={<MarketCalendarCard
          projection={cardData.projection}
          text={{
            ...text.calendarCard,
            categories: text.calendar.market.kinds,
            assets: text.dashboard.crossAsset.assets,
            // Calendar chrome names fields in the reader's language; only published conclusion prose
            // stays in the model's output language.
            readableNames: text.analysisWorkspace.readableNames
          }}
          onOpenCalendar={(month) => onOpenCalendar(month)}
          onOpenEventInCalendar={(eventKey, month) => onOpenCalendar(month, eventKey)}
          onSelectEvent={(eventKey, label, month) => {
            // Last selection wins: a calendar row clears the timeline node and cancels any
            // in-flight node detail read, so the panel and the next message carry one context.
            timeline.clearSelection()
            setOpenEntry(undefined)
            // A row click asks "what was that print": open the same left, unmasked drawer the chart
            // line opens. Recording the Agent context is additive and must not replace the detail.
            openEventDetailThenRecord({ eventKey, label, month }, setEventDetail, recorded => setSelectedContext({
              key: `calendar-event:${recorded.eventKey}`, label: recorded.label, eventKey: recorded.eventKey, month: recorded.month
            }))
          }}
          selectedEventKey={selectedContext?.key.startsWith('calendar-event:') ? selectedContext.key.slice('calendar-event:'.length) : undefined}
          onRefresh={cardData.reload}
        />}
        text={text}
        timeline={timeline}
        selectionState={selectionState}
        binding={binding}
        onBindingChange={next => {
          setBinding(next)
          // A timeline node and a calendar row are the same "current context": picking one clears
          // the other, which is what keeps the panel from showing two selections at once. The chart's
          // event drawer is closed for the same reason — a node is now the thing being read.
          if (next) { setSelectedContext(undefined); setEventDetail(undefined) }
        }}
        selectedContextLabel={selectedContext?.label}
        selectedEventKey={selectedContext?.eventKey}
        selectedEventMonth={selectedContext?.month}
        onClearSelectedContext={() => {
          setSelectedContext(undefined)
          setEventDetail(undefined)
          setOpenEntry(undefined)
          timeline.clearSelection()
        }}
        openEntry={openEntry}
        onOpenChange={setOpenEntry}
        timelineText={timelineText}
      />
    </div>
  </div>
}
