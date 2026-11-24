import type { MarketCalendarMonthRead } from './readMarketCalendarMonth'
import { cloneElement, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { IconButton } from '@platform/ui/components/icon-button'
import type { MarketAnalysisReadableLocale } from '../../../contracts/marketAnalysisReadableText'
import type { productText } from '../../shared/i18n/productText'
import type { AnalysisWorkspaceBinding } from '../../../contracts/analysisWorkspaceContracts'
import type { MarketAnalysisTimelineEntry } from '../../shared/ipc/marketAnalysisTimelineClient'
import { MarketAnalysisAgentWorkspace } from './MarketAnalysisAgentWorkspace'
import { MarketCalendarCard } from './MarketCalendarCard'
import { useCalendarCardData, type CalendarCardReactionReader } from './useCalendarCardData'
import { AnalysisDetailDrawer } from './AnalysisDetailDrawer'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { AnalysisTimelineDrawer } from './AnalysisTimelineDrawer'
import { MarketAnalysisSettingsDialog } from './MarketAnalysisSettingsDialog'
import { LatestAnalysisConclusionCard } from './LatestAnalysisConclusionCard'
import type { AnalysisSelectionState } from './useMarketAnalysisTimeline'
import { useMarketAnalysisTimeline } from './useMarketAnalysisTimeline'
import { useSampleNow } from './SampleModeProvider'
import { drawerWidthFor } from './analysisDrawerDrag'
import { useAnalysisDrawerDrag } from './useAnalysisDrawerDrag'
import { useAnalysisDrawerWheel } from './useAnalysisDrawerWheel'
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
/**
 * 单栏阈值：与 `marketAnalysisWorkspace.css` 里那条容器查询（`@container mi-analysis-dashboard
 * (max-width: 1303px)`）**同值**。容器就是布局根自己（`container: mi-analysis-dashboard`），
 * 所以这里量根元素的 inline-size 就等于量那条查询的量；用例盯着两边一致。
 */
export const MARKET_ANALYSIS_COMPACT_MAX_WIDTH = 1303

/**
 * 左抽屉（AI 分析与舆情）的形态：**一处配置，翻边只改这里**。
 *
 * 用户 2026-11-24 的触发方式还在改（「往左滚 / 按住往左拖」「从右边往左边弹」），落边随时可能翻。
 * 所以「靠哪一边」只在这一个字段里写死，样式按 `data-edge` 挂左/右两套；翻边改这一处，
 * 340 的宽度与 900 的并排阈值同理——不在样式里散落。
 */
export const MARKET_ANALYSIS_DRAWER = {
  edge: 'right' as 'left' | 'right',
  /** 并排档的**最小**宽：实际是 `max(50%, 420px)`（用户真机：固定 340 太窄）。 */
  width: 420,
  /** ≥ 这个容器宽：并排（看板让位 340）；更窄：整幅遮盖（等于切视图）。 */
  sideMinWidth: 900
} as const

export type MarketAnalysisDrawerTier = 'side' | 'full'

export type MarketAnalysisDashboardInjection = Readonly<{
  conclusionSlot?: (node: HTMLDivElement | null) => void
  /**
   * 「接下来要看的」那一块：**同一个元素**，由这里用自己那份 `cardData` 构造，
   * 交给 dashboard 再传进抽屉——抽屉右列顶部渲染它，事件列表在它下面。
   * 不复制写法、也不让抽屉再读一遍日历。
   */
  calendarBlock?: ReactNode
  /**
   * The runs bar, rendered by the dashboard as the footer of its scroll column: it belongs under
   * the readers' cards, not floating over them. Handed down as a node because its data (the
   * timeline) lives here while its place in the layout belongs to the dashboard.
   */
  /**
   * The rail slot the page portals its policy card into: the card reads the page's state but lives
   * at the top of the rail, next to the calendar the same numbers are about.
   */
  policySlot?: HTMLDivElement | null
  /** The calendar's event-title vocabulary, read once by the page entry and rendered by the panel. */
  calendarEventTitles?: Record<string, string>
  /** The 0xRouter month's events, read once here because the page owns the locale and the client. */
  readCalendarMonth?: (month: string, asOf: string) => Promise<MarketCalendarMonthRead | null>
  /** A chart event line the reader picked: the page opens its detail and records it. */
  onSelectChartEvent?: (line: CrossAssetEventLine, month: string) => void
  /**
   * 看板自己那一层开了模态抽屉没有（设置 / 关键指标 / 政策详情）。
   *
   * 这几层由看板自己开，布局看不见它们——而圆钮 z=1100 压在那几层（1000）上面，就是「第二层入口」。
   * 所以由**开抽屉的人**把状态报上来，布局再并进 `suppressed`；不在布局里猜 DOM 里有没有 `.ant-drawer`。
   */
  onModalLayerChange?: (open: boolean) => void
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
export function MarketAnalysisDashboardLayout({ children, text, locale, onOpenSettings, onOpenAnalysisSettings, onOpenCalendar = () => undefined, calendarEventTitles, readCalendarMonth, renderEventDetailDrawer, readCalendarReaction }: { children: ReactNode; text: typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']; locale?: MarketAnalysisReadableLocale; onOpenCalendar?: (month: string, eventKey?: string) => void; onOpenAnalysisSettings?: () => void
  /** 舆情那颗设置入口：打开配置抽屉、落在「采集与数据」的**舆情组**（未传时舆情仍用本地弹框）。 */
  onOpenSettings?: (focus: Readonly<{ business: 'sentiment' }>) => void
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
  readCalendarMonth?: (month: string, asOf: string) => Promise<MarketCalendarMonthRead | null>
  /**
   * The page's own event-detail surface, injected rather than imported: the cross-asset feature must
   * never learn the calendar's text contract, and the page is the one layer that may know both.
   */
  renderEventDetailDrawer?: (selection: SelectedCalendarEvent, onClose: () => void) => ReactNode
  /**
   * 「±30 分」反应的读取器，由页面注入（它才拥有跨资产那条查询与它的客户端）。不注入就没有那一行。
   */
  readCalendarReaction?: CalendarCardReactionReader }): React.ReactElement {
  // 会话入口（圆钮）挂在**布局根**上，不进 agent 栏：窄档那一栏是隐藏的，挂在里面等于没有入口
  // （用户 2026-11-24 的「看板里看不见那颗钮」就是这个）。agent 栏把面板 portal 到这里。
  const [floatingHost, setFloatingHost] = useState<HTMLDivElement | null>(null)
  // 窄档判定跟 CSS 容器查询同一把尺子：布局根就是这个容器，量它自己的 inline-size。
  const [layoutNode, setLayoutNode] = useState<HTMLDivElement | null>(null)
  const [layoutWidth, setLayoutWidth] = useState(0)
  // 首帧就量一次：ResizeObserver 是异步的，等它回调时已经按宽档画过一帧（圆钮的坐标那一刻是浮窗那套），
  // 窄屏上会闪一下再跳回右下。布局阶段同步量，绘制前就落定。
  useLayoutEffect(() => {
    if (layoutNode === null) return
    setLayoutWidth(layoutNode.getBoundingClientRect().width)
  }, [layoutNode])
  useEffect(() => {
    if (layoutNode === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      setLayoutWidth(entries[0]?.contentRect.width ?? 0)
    })
    observer.observe(layoutNode)
    return () => observer.disconnect()
  }, [layoutNode])
  const compact = layoutWidth > 0 && layoutWidth <= MARKET_ANALYSIS_COMPACT_MAX_WIDTH
  /** 并排档（看板让位 340，仍可读）还是整幅档（遮盖，等于切视图）。 */
  const drawerTier: MarketAnalysisDrawerTier = layoutWidth >= MARKET_ANALYSIS_DRAWER.sideMinWidth ? 'side' : 'full'
  // 视图切换的键：与界面原来的「市场看板 / 数字货币解读 Agent」逐字一致，只是不再从已解析的句子回填。
  const resolveWorkspaceText = useProductTextKey()
  const [binding, setBinding] = useState<AnalysisWorkspaceBinding>()
  const [selectionState, setSelectionState] = useState<AnalysisSelectionState>('none')
  const [openEntryId, setOpenEntryId] = useState<string>()
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [analysisSettingsOpen, setAnalysisSettingsOpen] = useState(false)
  // 底部聊天框（只有对话 + 输入 + 一条「选中事件」）开着没有。
  const [chatSheetOpen, setChatSheetOpen] = useState(false)
  // 左抽屉（最新 AI 结论 + 重点舆情）开着没有。两个面互斥：开一个关另一个。
  const [analysisDrawerOpen, setAnalysisDrawerOpen] = useState(false)
  /** 看板自己那一层有没有模态抽屉开着（它开它自己知道，布局不猜 DOM）。 */
  const [dashboardModalOpen, setDashboardModalOpen] = useState(false)
  // 舆情块由 workspace 构造（它拥有选中舆情那份状态），portal 进抽屉里的挂点——不是复制一份。
  const [newsHost, setNewsHost] = useState<HTMLDivElement | null>(null)
  const grip = useRef<HTMLButtonElement>(null)
  const [returnGripFocus, setReturnGripFocus] = useState(false)
  const closeAnalysisDrawer = useCallback(() => {
    setAnalysisDrawerOpen(false)
    setReturnGripFocus(true)
  }, [])
  // Esc 关抽屉。开着时键盘焦点在抽屉里，Esc 是它唯一能退出的路（并排档没有遮罩可点）。
  useEffect(() => {
    if (!analysisDrawerOpen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeAnalysisDrawer() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [analysisDrawerOpen, closeAnalysisDrawer])
  /**
   * 整幅档＝切到这一屏：左侧 52px 图标栏在布局根**外面**（外壳 grid 第一列），既盖不到、
   * 也不吃 `__panes` 上的 `inert`。这是本组件唯一一处伸进外壳的 DOM（侧栏不归产品渲染，
   * 没有可注入的挂点），只认 `.global-sidebar` 一个类名；并排档不关（看板与导航都要能用）。
   */
  useEffect(() => {
    if (!compact || !analysisDrawerOpen || drawerTier !== 'full') return
    const rail = document.querySelector<HTMLElement>('.global-sidebar')
    if (rail === null) return
    rail.setAttribute('inert', '')
    return () => { rail.removeAttribute('inert') }
  }, [compact, analysisDrawerOpen, drawerTier])
  // 关掉后焦点回把手：把手关着时在 DOM 里，Tab 回来就落得上。
  useEffect(() => {
    if (analysisDrawerOpen || !returnGripFocus) return
    grip.current?.focus()
    setReturnGripFocus(false)
  }, [analysisDrawerOpen, returnGripFocus])
  /**
   * 拖出抽屉：右缘 0–24px 全高起拖（刨掉圆钮 56×56），左移 ≥ 4px 跟手；
   * 界面其余地方要左移 > 8px 且 ≥ 1.5 × 竖直位移。判据在 `analysisDrawerDrag.ts`。
   *
   * 圆钮是 `position: fixed`（right 16 / bottom 88），所以命中矩形按视口算——它不在舞台里。
   */
  const drawerDrag = useAnalysisDrawerDrag({
    edge: MARKET_ANALYSIS_DRAWER.edge,
    enabled: compact,
    // 并排档按 340 算跟手与吸附线；整幅档是页宽（114 / 250 两条线就是这么来的）。
    // 与样式同源：并排档 max(50%, 420)，整幅档页宽。
    width: drawerWidthFor({ tier: drawerTier, stageWidth: layoutNode?.getBoundingClientRect().width ?? 0 }),
    open: analysisDrawerOpen,
    // 两个面互斥：聊天框开着时右缘拖也不动（先关它再拖，别抢）。
    blocked: chatSheetOpen,
    stage: () => layoutNode?.getBoundingClientRect(),
    // 窄档底部胶囊（外径 40、距底 12、水平居中）：起拖条要刨掉它那块。
    button: () => ({
      left: window.innerWidth / 2 - 20,
      right: window.innerWidth / 2 + 20,
      top: window.innerHeight - 52,
      bottom: window.innerHeight - 12
    }),
    onOpenChange: setAnalysisDrawerOpen
  })
  const drawerDragging = drawerDrag.state === 'dragging'
  const drawerSettling = drawerDrag.state === 'settling'
  // 触摸板两指横向滑：往左滑弹出右侧抽屉，开着时反向滑收起（判据在 `wheelGesture`）。
  useAnalysisDrawerWheel({
    enabled: compact,
    open: analysisDrawerOpen,
    blocked: chatSheetOpen,
    dragging: drawerDragging,
    root: () => layoutNode ?? undefined,
    onOpenChange: setAnalysisDrawerOpen
  })
  const [conclusionHost, setConclusionHost] = useState<HTMLDivElement | null>(null)
  const [policyHost, setPolicyHost] = useState<HTMLDivElement | null>(null)
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
  const policySlot = useCallback((node: HTMLDivElement | null) => setPolicyHost(node), [])
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

  const calendarCardNode = <MarketCalendarCard
          projection={cardData.projection}
          state={cardData.state}
          sourcesState={cardData.sourcesState}
          stale={cardData.stale}
          text={{
            ...text.calendarCard,
            // The card carries its own short category labels: the calendar page's longer ones do
            // not fit the 84px rail and were clipped at the card edge in English.
            categories: text.calendarCard.categories,
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
        />

  /**
   * 「最新 AI 结论」那张卡：**同一个节点**。
   *
   * 宽档 portal 进 agent 栏顶部（`policySlot`）；窄档搬进左抽屉（v3 的「AI 分析」那一块，
   * 带着「查看完整结论」进时间线）。两处只有一处渲染——搬位置，不是复制一份。
   */
  const conclusionCardNode = <LatestAnalysisConclusionCard
          text={detailText}
          // 读不到时用 productText 里既有那口径句（与抽屉同一句），不另写一版。
          workspaceText={{
            ...workspaceText,
            conclusionUnreadable: resolveWorkspaceText('pages.intelligence.portal.data.drawerUnavailable'),
            // 重试按钮的字与失败码的人话都复用时间轴那一份：两处各写一句，改一处就会分叉。
            retryAnalysis: timelineText.retryAnalysis,
            failureReasons: timelineText.failureReasons
          }}
          timeline={timeline}
          onOpenDetail={entry => { setOpenEntry(entry); timeline.ensureDetail(entry) }}
          onOpenTimeline={() => setTimelineOpen(true)}
          /* 与时间轴同一形状：宿主给了入口就用宿主的（`index.tsx` 传的是打开配置抽屉「AI 分析」屏），
             只有单挂组件、没有宿主时才退回本地弹窗。 */
          onOpenAnalysisSettings={onOpenAnalysisSettings ?? (() => setAnalysisSettingsOpen(true))}
          openTimelineLabel={text.analysisDrawer.open}
          enableAnalysisLabel={text.analysisTimeline.enableAnalysis}
          analysisOffHint={text.analysisTimeline.analysisOffHint}
        />

  // 另有模态层开着时圆钮不渲染：它的 z（1100）比那些层（1000/1150/1200）高，压上去就是第二层入口。
  // 抽屉开着时同样不渲染——它在右缘，圆钮正好压在抽屉的右下角，会变成压在同一块面上的第二颗入口
  // （整幅档是模态；并排档两者重叠，也不留两颗）。
  // `dashboardModalOpen` 是看板报上来的（设置 / 关键指标 / 政策详情），布局不猜。
  const agentSuppressed = timelineOpen || analysisSettingsOpen || openEntry !== undefined || eventDetail !== undefined
    || (compact && (analysisDrawerOpen || drawerDragging)) || dashboardModalOpen
  return <div
    className="mi-analysis-dashboard-layout"
    data-compact={compact || undefined}
    onPointerDown={drawerDrag.onPointerDown}
    ref={setLayoutNode}
    /* 拖动期间：禁止选中文字、`touch-action: pan-y`（纵向仍可滚，横向归抽屉），
       也不让图的框选/双击吃到这一下。松手即撤，别把整页的手势都改掉。 */
    style={drawerDragging ? { userSelect: 'none', touchAction: 'pan-y' } : undefined}>
    {/* 遮蔽整层用 `inert`：键盘 Tab 走不进去、点不动（遮罩只管指针与视觉，那是另一件事）。
        底部聊天框是全宽模态；左抽屉只有整幅档才是模态，并排档看板必须仍可读。 */}
    <div className="mi-analysis-dashboard-layout__panes"
      data-drawer={compact && analysisDrawerOpen ? drawerTier : undefined}
      data-edge={MARKET_ANALYSIS_DRAWER.edge}
      inert={compact && (chatSheetOpen || (analysisDrawerOpen && drawerTier === 'full'))}>
      <div className="mi-analysis-dashboard-layout__dashboard">
        {conclusionHost && !compact ? createPortal(conclusionCardNode, conclusionHost) : null}
        {/* The dashboard owns its layout; it renders the mount point and this
            layout only supplies the ref, so `children` gets the injected prop. The calendar's
            event-title vocabulary and the chart's click travel the same way: the page reads the
            list once, the panel renders it and hands the picked line back up. */}
        {cloneElement(children as React.ReactElement<MarketAnalysisDashboardInjection>, {
          calendarBlock: calendarCardNode,
          conclusionSlot,
          policySlot: policyHost,
          onSelectChartEvent: selectChartEvent,
          onModalLayerChange: setDashboardModalOpen,
          ...(calendarEventTitles ? { calendarEventTitles } : {}),
          ...(readCalendarMonth ? { readCalendarMonth } : {})
        })}
        {onOpenAnalysisSettings === undefined
          ? <MarketAnalysisSettingsDialog
            onClose={() => setAnalysisSettingsOpen(false)}
            open={analysisSettingsOpen}
            text={text.analysisTimeline}
          />
          : null}
        <AnalysisTimelineDrawer
          onOpenSettings={onOpenAnalysisSettings ?? (() => setAnalysisSettingsOpen(true))}
          onClose={() => setTimelineOpen(false)}
          onOpenChange={setOpenEntry}
          open={timelineOpen}
          openEntry={openEntry}
          text={text.analysisTimeline}
          timeline={timeline}
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
        {...(onOpenSettings === undefined ? {} : { onOpenSettings })}
        language={locale ?? 'zh-CN'}
        floatingText={{ open: text.calendarCard.expandAgent, close: text.calendarCard.closeAgent, title: text.calendarCard.agentTitle, clear: text.calendarCard.clearConversation }}
        floatingHost={floatingHost}
        compact={compact}
        suppressed={agentSuppressed}
        newsHost={compact ? newsHost : undefined}
        {...(compact ? { sheetOpen: chatSheetOpen } : {})}
        onSheetOpenChange={open => {
          setChatSheetOpen(open)
          // 两个面互斥：开聊天就关左抽屉（不卸载——草稿与舆情滚动位置都留着）。
          if (open) setAnalysisDrawerOpen(false)
        }}
        railHeader={<div ref={policySlot} data-dashboard-policy-slot />}
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
    {/* 窄档的两个面（用户 2026-11-24 拍板 v3）：左抽屉＝最新 AI 结论 + 重点舆情；底部聊天框
        （在 `__agent-control` 里）＝对话 + 输入 + 一条「选中事件」。互斥，开一个关另一个。
        靠哪一边只认 `MARKET_ANALYSIS_DRAWER.edge`：样式按 `data-edge` 挂左/右两套。 */}
    {compact ? <>
      {/* 左缘把手：视觉 4px、命中 22×128，竖直居中。整幅档没有热区，只能点它。 */}
      <button aria-label={text.analysisWorkspace.openAnalysisDrawer} className="mi-agent-drawer__grip"
        data-edge={MARKET_ANALYSIS_DRAWER.edge}
        onClick={() => { setChatSheetOpen(false); setAnalysisDrawerOpen(true) }}
        ref={grip}
        type="button"><i /></button>
      {/* 整幅档的遮罩：只负责变暗。**它没有关闭动作**——抽屉 `width:100%` 且 z 更高，
          压在它上面，点它永远点不到；两档统一只有 X 与 Esc 两条关闭路。
          并排档没有遮罩：看板要能读。 */}
      {analysisDrawerOpen && drawerTier === 'full'
        ? <div aria-hidden="true" className="mi-agent-drawer__scrim" data-analysis-drawer-scrim />
        : null}
      <aside aria-labelledby="mi-analysis-drawer-title" aria-modal={drawerTier === 'full'}
        className="mi-agent-drawer" data-edge={MARKET_ANALYSIS_DRAWER.edge}
        data-open={analysisDrawerOpen}
        data-drag={drawerDragging || drawerSettling ? 'true' : undefined}
        data-settling={drawerSettling ? 'true' : undefined}
        data-tier={drawerTier}
        data-analysis-drawer
        role="dialog"
        style={drawerDrag.offset ? { transform: `translateX(${(MARKET_ANALYSIS_DRAWER.edge === 'right' ? -1 : 1) * drawerDrag.offset}px)` } : undefined}>
        <header className="mi-agent-drawer__head">
          <h2 id="mi-analysis-drawer-title">{text.analysisWorkspace.analysisDrawerTitle}</h2>
          <IconButton ariaLabelKey="pages.intelligence.portal.calendarCard.closeAgent" icon={X} onSelect={closeAnalysisDrawer} resolveText={resolveWorkspaceText} size="md" />
        </header>
        <div className="mi-agent-drawer__body">
          {conclusionCardNode}
          {/* 重点舆情：块由 workspace 构造（它拥有选中舆情那份状态），portal 到这里——不是复制一份。 */}
          <div className="mi-agent-drawer__news" data-analysis-news-host ref={setNewsHost} />
        </div>
      </aside>
    </> : null}
    {/* 会话入口的落点：整页常驻，窄档也在（agent 栏本身在窄档是隐藏的）。 */}
    <div className="mi-analysis-dashboard-layout__agent-control" data-agent-control-host ref={setFloatingHost} />
  </div>
}
