import { Button } from 'antd'
import { hostScreenDirty } from './drawerScreenDirty'

import { ConfirmProvider, useConfirm } from '@platform/ui/components/confirm'
import { ErrorBoundary } from '@platform/ui/components/error-boundary'
import { ConfigDrawerPanel } from './ConfigDrawerPanel'
import { openModelSettings, openPreferencesSettings } from '../../shared/navigation/productShellNavigation'
import { ConfigSettingsDrawer } from '../../settings/config-drawer/ConfigSettingsDrawer'
import type { ConfigDrawerMenu } from '../../settings/config-drawer/drawerPreviewRows'
import { DashboardSourcesPanel } from './DashboardSourcesPanel'
import type { SourceFilter } from '../../settings/intelligence-sources/SettingsSourceTree'
import { NotificationSettingsPanel } from '../../settings/intelligence-notification/NotificationSettingsPanel'
import { AnalysisSettingsPanel } from './AnalysisSettingsPanel'
import { DailyBriefingSettingsPanel, type BriefingScreenState } from './DailyBriefingSettingsPanel'
import { ProcessingSettingsPanel } from './ProcessingSettingsPanel'
import { RunLogDrawerPanel } from './RunLogDrawerPanel'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { Info } from 'lucide-react'

import { type MacroEconomicCalendarClient } from '../../features/macro/economic-calendar'
import type { IntelligenceFearGreedClient } from '../../features/industry/fear-greed'
import { DivergencePanel } from '../../features/industry/divergence/DivergencePanel'
import { PositioningPanel } from '../../features/industry/positioning/PositioningPanel'
import { useDashboardDivergence } from './useDashboardDivergence'
import { useDashboardOpenInterest } from './useDashboardOpenInterest'
import type { MarketDivergenceResult } from '../../../contracts/marketDivergence'
import type { OpenInterestHistoryResult, OpenInterestWindow } from '../../../contracts/openInterestHistory'
import { CapitalConditionsPanel, useCapitalConditions, type IntelligenceCapitalConditionsClient } from '../../features/industry/capital-conditions'

import { type DashboardEconomicCalendarState } from './dashboardEconomicCalendarModel'
import { dashboardRealSourcePolicy, FearGreedGaugePresentationPolicy, type DashboardFearGreedState } from './dashboardFearGreedModel'
import type { DashboardFundingRateHistoryState } from './dashboardFundingRateHistoryModel'
import { projectDashboardFeedRows } from './dashboardFeedStatusModel'
import { projectPositioningSourceRow, type DashboardPositioningViewState } from './dashboardOpenInterestModel'
import { FeedStatusStrip } from './DashboardFeedStatusStrip'
import { useDashboardFeedStatus } from './useDashboardFeedStatus'
import { filterFeedRowsByCells, resolveDashboardReadGates, selectedDollarSourceId, useDashboardCellEnabled, type CellEnabledIo } from './dashboardCellEnabled'
import { useDashboardEconomicCalendar } from './useDashboardEconomicCalendar'
import { useDashboardFearGreed } from './useDashboardFearGreed'
import { useDashboardFundingRateHistory } from './useDashboardFundingRateHistory'

import './cryptoDashboard.css'
import { CrossAssetObservationPanel } from '../../features/industry/cross-asset/CrossAssetObservationPanel'
import type { CrossAssetEventLine } from '../../features/industry/cross-asset/crossAssetEventLines'
import { useMacroMarketSnapshot } from '../../features/industry/cross-asset/useMacroMarketSnapshot'
import { useMacroRatesSnapshot } from '../../features/industry/cross-asset/useMacroRatesSnapshot'
import type { createCrossAssetObservationClient } from '../../shared/ipc/crossAssetObservationClient'
import type { DashboardFeedStatusClient } from '../../shared/ipc/dashboardFeedStatusClient'
import type { MacroMarketSnapshotClient } from '../../shared/ipc/macroMarketSnapshotClient'
import type { MacroRatesSnapshotClient } from '../../shared/ipc/macroRatesSnapshotClient'
import { productText } from '../../shared/i18n/productText'
import { LoadingState } from '@platform/ui/components/loading'
import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { StateView, STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import { PolicyPathDrawer } from './PolicyPathDrawer'
import { createPortal } from 'react-dom'

import { PolicyPathCard } from './PolicyPathCard'
import { policyPathMonth } from './policyPathMonth'
import { usePolicyPathReading } from './usePolicyPathReading'

/**
 * 把平台 `useConfirm` 变成抽屉要的 `confirmDiscard`：必须在 provider 之内取，所以单独一层。
 * 弹窗本身（居中在抽屉之上、「继续编辑」默认聚焦、Esc=继续编辑、「丢掉改动」静止即红）由平台
 * `Confirm` 负责，这里只转交文案与动作。
 */
function DrawerDiscardConfirm({ children }: Readonly<{
  children: (confirmDiscard: NonNullable<React.ComponentProps<typeof ConfigSettingsDrawer>['confirmDiscard']>) => ReactNode
}>): React.ReactElement {
  const confirm = useConfirm()
  return <>{children((input) => confirm({
    title: input.title,
    description: input.body,
    confirmLabel: input.confirmLabel,
    cancelLabel: input.cancelLabel,
    tone: 'danger',
    onConfirm: input.onDiscard
  }))}</>
}

type CryptoDashboardText = {
  workspaceLabel: string
  title: string
  description: string
  configureSources: string
  /** TODO(0.4.3-settings-drawer): 静态配置抽屉的入口标签；数据接入后连同入口一起删。 */
  configureSettings: string
  crossAsset: typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['crossAsset']
  macroReleaseDynamics: {
    calendarAction: string
    sourceName: string
    sourceStates: Record<DashboardEconomicCalendarState['state'], string>
    manageSettings: string
  }
  fearGreed: { title: string; loading: string; empty: string; score: string; observedAt: string; sourceName: string; sourceStates: Record<DashboardFearGreedState['state'], string>; manageSettings: string; buckets: Record<'extreme-fear' | 'fear' | 'neutral' | 'greed' | 'extreme-greed', string> }
  positioning: typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['positioning']
  divergence: typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['divergence']
  capitalConditions: typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['capitalConditions']
  policyPath: typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['policyPath']
  sentiment: { title: string; fearGreed: string; observedAt: string; gaugeMarkers: { fear: string; neutral: string; greed: string } }
  feedStatus: typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['feedStatus']
  context: { sourceStatus: { title: string } }
  dailyBriefing: typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['dailyBriefing']
}

type Props = { text: CryptoDashboardText; locale?: 'zh-CN' | 'en-US'; briefingEnabled?: boolean; onOpenBriefing?: () => void; client: Pick<MacroEconomicCalendarClient, 'queryMonth'>; fearGreedClient: Pick<IntelligenceFearGreedClient, 'querySnapshot'>; fundingRateClient: { query: (input: { asOf: string }) => Promise<unknown> }; openInterestClient: { query: (input: { asOf: string; window: OpenInterestWindow }) => Promise<OpenInterestHistoryResult> }; divergenceClient?: { query: (input: { asOf: string }) => Promise<MarketDivergenceResult> }; capitalConditionsClient?: Pick<IntelligenceCapitalConditionsClient, 'querySnapshot'>; now: () => Date; onConfigureSources: () => void; onManageSource: () => void; onOpenCalendar: () => void }

export function CryptoIntelligenceDashboard({ text, locale = 'zh-CN', briefingEnabled = true, onOpenBriefing, client, fearGreedClient, fundingRateClient, openInterestClient, divergenceClient, capitalConditionsClient, now, onConfigureSources, onManageSource, onOpenCalendar, collectCapitalConditionsSources, crossAssetClient, macroMarketClient, macroRatesClient, dashboardFeedStatusClient, conclusionSlot, policySlot, calendarEventTitles, readMarketEvents, onSelectChartEvent, initialSettingsMenu, initialSourceFilter, openSettingsRequest, cellEnabledIo }: Props & { collectCapitalConditionsSources?: () => Promise<void>; crossAssetClient?: ReturnType<typeof createCrossAssetObservationClient>; macroMarketClient?: MacroMarketSnapshotClient; macroRatesClient?: MacroRatesSnapshotClient; dashboardFeedStatusClient?: DashboardFeedStatusClient; conclusionSlot?: (node: HTMLDivElement | null) => void; policySlot?: HTMLDivElement | null
  /**
   * The calendar's event-title vocabulary, read from the product registry by the page entry and
   * carried here so the cross-asset panel can name the lines it draws. Never copied inline: one
   * list, one owner.
   */
  calendarEventTitles?: Record<string, string>
  /** The 0xRouter month's events, injected by the page: the chart's lines read both calendars. */
  readMarketEvents?: (month: string, asOf: string) => Promise<readonly unknown[] | null>
  /** A chart event line the reader picked: the page opens its detail and records it. */
  onSelectChartEvent?: (line: CrossAssetEventLine, month: string) => void
  /**
   * 格级启用的读口（宿主注入；真实来源是主进程那份 `intelligence-cell-enabled.json`）。
   * 不传 = 全都启用：看板在设置那条链路接上之前行为一字不变。
   */
  cellEnabledIo?: CellEnabledIo
  /**
   * 页面层请求打开配置抽屉的那一屏（日报页、日历、门户的入口在别的视图里，够不到这个抽屉）。
   *
   * 只转达意图：`openSettingsRequest` 每变一次就按 `initialSettingsMenu` 打开一次；
   * 抽屉本身仍住在这一层——四个面板的 hook 都在这里，不为了入口把它搬家。
   */
  initialSettingsMenu?: ConfigDrawerMenu
  /** 「来源与采集」那一屏挂载时的初值过滤器；不传就是看板默认（只作初值，不进受控状态）。 */
  initialSourceFilter?: SourceFilter
  openSettingsRequest?: number
}): React.ReactElement {
  const resolveProductKey = useProductTextKey()
  // 格级启用：先算出「哪些格读、哪些格不读」，再决定要不要调各 client（关掉的格一次请求都不发）。
  const cellState = useDashboardCellEnabled({ io: cellEnabledIo })
  const readGates = resolveDashboardReadGates(cellState.cells)
  /** 启用表读完之前一处都不读：否则关掉的格在首帧仍会发一次请求。 */
  const readsReady = cellState.ready
  const calendarState = useDashboardEconomicCalendar({ client, now })
  const { state: fearGreedState, reload: reloadFearGreed } = useDashboardFearGreed({ client: fearGreedClient, disabled: !readsReady || !readGates.fearGreed, now })
  const fundingRateState = useDashboardFundingRateHistory({ client: fundingRateClient, disabled: !readsReady || !readGates.positioning, now })
  // Positioning is read per window rather than reshaped in the browser: the fold and
  // the liquidation lookback belong to the query, so switching windows is one more read.
  const [positioningWindow, setPositioningWindow] = useState<OpenInterestWindow>('7d')
  // TODO(0.4.3-settings-drawer): 数据接入后删除——静态版配置抽屉的临时开关。
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false)
  // 页面层的入口（日报页 / 日历 / 门户）通过计数请求打开某��屏：计数一变就打开一次。
  const lastOpenRequest = useRef(openSettingsRequest ?? 0)
  useEffect(() => {
    if (openSettingsRequest === undefined || openSettingsRequest === lastOpenRequest.current) return
    lastOpenRequest.current = openSettingsRequest
    setSettingsDrawerOpen(true)
  }, [openSettingsRequest])
  // 「AI 分析」那一屏：屏自己读、自己存，把「有没有改动 / 保存中 / 失败句 / 保存动作」报上来；
  // 底部那条保存栏由抽屉壳给（壳只认这四样，不读数据）。
  // 有底部保存栏的屏都按同一份契约上报（脏 / 保存中 / 失败句 / 保存动作）。同一时刻只有一屏挂载，
  // 所以两者写同一份宿主状态：切屏时离开的那一屏先报 dirty=false，进入的那一屏再报自己。
  const [drawerScreen, setDrawerScreen] = useState<BriefingScreenState>({ dirty: false, saving: false, save: () => undefined })
  // 来源屏的草稿（多半是凭据框）：只参与**关闭确认**，不喂保存栏——凭据不该被一次「保存」代劳。
  const [sourcesDraftDirty, setSourcesDraftDirty] = useState(false)
  // 抽屉关窗前的检查：只有日报那一屏报脏（分析屏的「取消」已经能放弃改动，先不接）。
  const positioningState = useDashboardOpenInterest({ client: openInterestClient, disabled: !readsReady || !readGates.positioning, now, window: positioningWindow })
  const divergence = useDashboardDivergence({ client: divergenceClient, now })
  // 刷新 re-collects the sources before re-reading: re-reading the stored snapshot only ever
  // shows the reader the state they are already looking at.
  const [capitalReloadKey, setCapitalReloadKey] = useState(0)
  const [capitalRefreshing, setCapitalRefreshing] = useState(false)
  const [capitalRefreshFailed, setCapitalRefreshFailed] = useState(false)
  const capitalConditionsState = useCapitalConditions({ client: capitalConditionsClient, disabled: !readsReady || !readGates.capital, now, reloadKey: capitalReloadKey })
  // One macro read feeds two readers: the 市场状态 table inside the panel and the 来源状态 strip
  // below, so the strip cannot disagree with the figures it is describing.
  // 美元格选了源就按选的那条读；没选过（缺键）与今天一样，走默认主源。
  const dollarSourceId = selectedDollarSourceId(cellState.selections)
  const macroView = useMacroMarketSnapshot({
    client: macroMarketClient,
    disabled: !readsReady || !readGates.macroMarket,
    ...(dollarSourceId === undefined ? {} : { dollarSourceId })
  })
  // The two rate rows read FRED's official daily closes through their own door: a daily reading cannot
  // ride the fifteen-minute macro snapshot without being repainted as if it were intraday.
  const macroRatesView = useMacroRatesSnapshot({ client: macroRatesClient, disabled: !readsReady || !readGates.macroRates })
  // The 来源状态 strip's per-feed lines: the reader's switches and last outcomes, plus the cross-asset
  // snapshot that says which index leg is answering. Read at its own slow cadence, and read-only.
  const feedView = useDashboardFeedStatus({ client: readsReady ? dashboardFeedStatusClient : undefined, crossAssetClient: readsReady && readGates.crossAsset ? crossAssetClient : undefined })
  // The policy row reads one assembled object: the meeting date, the official facts and the odds
  // history are joined in the main process, so this dashboard never builds a second opinion.
  const policyPath = usePolicyPathReading(readsReady && readGates.policyPath)
  const [policyDrawerOpen, setPolicyDrawerOpen] = useState(false)
  // The panel's copy, plus the calendar's title vocabulary when the page handed one down. Memoized
  // because the panel keys its calendar read off `eventTitles`: a fresh object every render would
  // make it re-query the calendar on every render of this dashboard.
  const crossAssetText = useMemo(
    () => ({ ...text.crossAsset, ...(calendarEventTitles ? { eventTitles: calendarEventTitles } : {}) }),
    [text.crossAsset, calendarEventTitles]
  )
  const feedRows = projectDashboardFeedRows({
    macroClient: Boolean(macroMarketClient), macroState: macroView.state, ratesState: macroRatesView.state,
    ...(macroView.snapshot ? { macro: macroView.snapshot } : {}),
    ...(macroRatesView.snapshot ? { rates: macroRatesView.snapshot } : {}),
    // 启用表读完之前也按「还在读」画：这一格还没资格说「读不到」。
    indexLoading: !readsReady || (Boolean(crossAssetClient) && feedView.indexState === 'loading'),
    ...(feedView.index ? { index: feedView.index } : {}),
    ...(feedView.feed ? { feed: feedView.feed } : {})
  })
  const nowMs = now().getTime()
  const refreshCapitalConditions = async (): Promise<void> => {
    // A host without a collection layer still has a real retry: re-reading the stored snapshot.
    if (!collectCapitalConditionsSources) {
      setCapitalReloadKey(key => key + 1)
      return
    }
    setCapitalRefreshing(true)
    setCapitalRefreshFailed(false)
    try {
      await collectCapitalConditionsSources()
      // The collection runs as a background job, so this reads whatever the collector was able
      // to store by now; the panel keeps its refresh control for another attempt.
      setCapitalReloadKey(key => key + 1)
    } catch {
      setCapitalRefreshFailed(true)
    } finally {
      setCapitalRefreshing(false)
    }
  }

  return (
    <main className="intelligence-page mi-crypto-dashboard" aria-label={text.title}>
      {/* The scroll region owns the padding and the container query; the page root stays a flex
          column so the runs bar below it never scrolls with the cards. */}
      <div className="mi-crypto-dashboard__scroll">
      <header className="mi-crypto-dashboard__header">
        <div className="mi-crypto-dashboard__heading">
          <p className="mi-crypto-dashboard__label">{text.workspaceLabel}</p>
          {/* 标题与它自己的 ⓘ 是一组，图标紧跟标题文字（行内 gap 4px、不换行）：不推到行尾、也不
              单独占一行。读法那句（阅读顺序 + partial 口径）收进浮层，正文只留标题——
              它说的是「怎么读这张表」，不是读者这一刻要知道的状态。 */}
          <div className="mi-crypto-dashboard__title-row">
            <h1>{text.title}</h1>
            <Popover labelKey="pages.intelligence.portal.dashboard.description" resolveText={resolveProductKey}
              trigger={triggerProps => (
                <IconButton {...triggerProps} ariaLabelKey="pages.intelligence.portal.dashboard.descriptionLabel"
                  icon={Info} resolveText={resolveProductKey} size="sm" variant="plain" />
              )} />
          </div>
        </div>
        <div className="mi-crypto-dashboard__tools">
          {/* 两处页头命令按钮：换 antd `Button` 默认档，className 原样保留——尺寸/字重仍由
              `cryptoDashboard.css` 那几条决定（选择器已加 `.ant-btn` 提高特异性），视觉档位不变。
              原来还有第三颗「返回 Agent」，用户 2026-11-09 定：那个说法已经不存在，按钮整个去掉。 */}
          {briefingEnabled ? <Button className="mi-crypto-dashboard__briefing" onClick={onOpenBriefing} type="default">{text.dailyBriefing.entry}</Button> : null}
          <Button className="mi-crypto-dashboard__configure" onClick={onConfigureSources} type="default">{text.configureSources}</Button>
          {/* TODO(0.4.3-settings-drawer): 数据接入后删除——静态版式的配置抽屉入口。 */}
          <Button autoInsertSpace={false} className="mi-crypto-dashboard__settings" onClick={() => setSettingsDrawerOpen(true)} type="default">{text.configureSettings}</Button>
        </div>
      </header>

      {/* TODO(0.4.3-settings-drawer): 数据接入后删除。静态版式抽屉，只画结构。
          两层边界：这一层保「抽屉外壳自己崩了不影响背后这一页」；每一屏另有一层
          `ConfigDrawerPanel`，屏幕内的崩溃只在抽屉正文里显示，不落到主列顶端。 */}
      <ErrorBoundary scope="drawer">
        {/* 局部一层 ConfirmProvider：这一块被单独渲染（页面用例、抽屉用例）时也拿得到确认框；
            应用里它嵌在 AppShell 的 provider 之内，文案与主题照样跟着走。 */}
        <ConfirmProvider>
          <DrawerDiscardConfirm>
            {(confirmDiscard) => <ConfigSettingsDrawer
              confirmDiscard={confirmDiscard}
          /* 计数变化就重新挂载：每次都落到请求的那一屏（连点同一个入口也算一次）。 */
          key={`settings-drawer-${openSettingsRequest ?? 0}`}
          initialMenu={initialSettingsMenu}
          isScreenDirty={() => hostScreenDirty(drawerScreen.dirty, sourcesDraftDirty)}
          onClose={() => setSettingsDrawerOpen(false)}
          open={settingsDrawerOpen}
          analysisPanel={<ConfigDrawerPanel screen="analysis"><AnalysisSettingsPanel onState={setDrawerScreen} /></ConfigDrawerPanel>}
          screenDirty={drawerScreen.dirty}
          onScreenSave={drawerScreen.save}
          screenSaving={drawerScreen.saving}
          {...(drawerScreen.failure === undefined ? {} : { screenSaveFailure: drawerScreen.failure })}
          briefingPanel={<ConfigDrawerPanel screen="briefing"><DailyBriefingSettingsPanel onState={setDrawerScreen} /></ConfigDrawerPanel>}
          processingPanel={<ConfigDrawerPanel screen="processing"><ProcessingSettingsPanel /></ConfigDrawerPanel>}
          runLogPanel={<ConfigDrawerPanel screen="run-log"><RunLogDrawerPanel /></ConfigDrawerPanel>}
          notificationsPanel={<ConfigDrawerPanel screen="notifications"><NotificationSettingsPanel /></ConfigDrawerPanel>}
              sourcesPanel={<ConfigDrawerPanel screen="sources"><DashboardSourcesPanel pane="sources" initialFilter={initialSourceFilter} onDraftChange={setSourcesDraftDirty} /></ConfigDrawerPanel>}
              sourcesDataPanel={<ConfigDrawerPanel screen="sourcesData"><DashboardSourcesPanel pane="business" onDraftChange={setSourcesDraftDirty} /></ConfigDrawerPanel>} />}
          </DrawerDiscardConfirm>
        </ConfirmProvider>
      </ErrorBoundary>

      {/* Named mount point: the analysis workspace portals its latest-conclusion
          card in here, directly under the macro release strip, so the card reads
          as part of this dashboard without the dashboard knowing timeline data. */}
      <div ref={conclusionSlot} data-dashboard-conclusion-slot />

      {(crossAssetClient && (readGates.crossAsset || readGates.macroMarket || readGates.macroRates)) ? <CrossAssetObservationPanel
        client={crossAssetClient}
        hideStatusRows={readGates.hiddenStatusRows}
        crossAssetReadingEnabled={readsReady && readGates.crossAsset}
        macroSnapshot={macroView.snapshot}
        macroState={macroView.state}
        rates={macroRatesView.snapshot}
        ratesState={macroRatesView.state}
        // The panel reads the same calendar this dashboard already reads, rather than reaching for a
        // second client of its own: one month query per window, one source of truth for the events.
        calendar={client}
        readMarketEvents={readMarketEvents}
        // …and it hands a picked line up rather than opening anything itself: the page owns both the
        // detail drawer and the recorded selection.
        onSelectEvent={onSelectChartEvent}
        text={crossAssetText} /> : null}
      {readsReady && readGates.policyPath && policyPath?.state === 'available' ? (() => {
        const card = <PolicyPathCard reading={policyPath.reading} text={text.policyPath}
          month={policyPathMonth(policyPath.reading.meetingDate, locale)} onOpen={() => setPolicyDrawerOpen(true)} />
        // The rail is the layout's, not this page's: portal into its slot when it exists so the card
        // sits above the calendar, and fall back to the page flow when rendered on its own.
        return policySlot ? createPortal(card, policySlot) : card
      })() : null}
      {policyDrawerOpen && policyPath?.state === 'available' ? <PolicyPathDrawer reading={policyPath.reading}
        text={text.policyPath} onClose={() => setPolicyDrawerOpen(false)} /> : null}
      {/* Reading order is 资金 → 风险偏好 → 杠杆: the sentiment gauge sits with the money rows, not
          beside the perpetual card, where it read as part of the funding reading. */}
      <div className="mi-crypto-dashboard__capital-positioning-row">
        {readsReady && readGates.fearGreed ? <SentimentPanel fearGreedState={fearGreedState} text={text} onRetry={reloadFearGreed} /> : null}
        {readsReady && readGates.capital ? <CapitalConditionsPanel state={capitalConditionsState} text={text.capitalConditions}
          onRefresh={() => void refreshCapitalConditions()}
          refreshing={capitalRefreshing} refreshFailed={capitalRefreshFailed} /> : null}
      </div>
      <div className="mi-crypto-dashboard__positioning-row">
        {readsReady && readGates.positioning ? <PositioningPanel funding={fundingRateState} positioning={positioningState} window={positioningWindow}
          onWindowChange={setPositioningWindow} text={text.positioning} /> : null}
        {/* A conclusion about the card above it, not another section: the reader asks "so what do
            these two legs mean together" while looking at the chart, and a band of its own read
            as an unrelated module. */}
        <DivergencePanel state={divergence.state} text={text.divergence} onRetry={divergence.reload} />
      </div>

      {/* 持仓那一格**转述卡片算出来的判定**（`positioningState`），不自己判新鲜度：
              阈值只在 `dashboardPositioningPresentationPolicy` 里存在一次，行与卡不可能各判一套。 */}
      <DashboardSidebar calendarState={calendarState} fearGreedState={fearGreedState} positioning={positioningState} fundingRateState={fundingRateState} feedRows={filterFeedRowsByCells(feedRows, cellState.cells)} nowMs={nowMs} text={text} onManageSource={onManageSource} onOpenCalendar={onOpenCalendar} />
      </div>
    </main>
  )
}

function SentimentPanel({ fearGreedState, text, onRetry }: { fearGreedState: DashboardFearGreedState; text: CryptoDashboardText; onRetry: () => void }): React.ReactElement {
  const formatTime = useShellTimeFormat()
  return <>
    <section className="mi-crypto-dashboard__sentiment" aria-labelledby="mi-sentiment-heading"><h2 id="mi-sentiment-heading">{text.sentiment.title}</h2>
      <div className="mi-crypto-dashboard__sentiment-gauge" data-sentiment-gauge>
      {/* 读到但偏旧也是读数：显示分数与它真实的观测时间，不当成「读不到」——那是把源说坏了。 */}
      {fearGreedState.state === 'available' || fearGreedState.state === 'stale' ? <>
        {/* The readout disc sits on the pivot and is painted after the needle, so the score can
            own the centre again: the needle starts underneath the disc instead of crossing it. */}
        <span className="mi-crypto-dashboard__sentiment-dial">
          <svg aria-hidden="true" viewBox={FearGreedGaugePresentationPolicy.svgViewBox}>{FearGreedGaugePresentationPolicy.arcSegments.map((segment, index) => <path key={segment.tone} className="mi-crypto-dashboard__gauge-segment" d={segment.path} data-gauge-segment={index} data-gauge-tone={segment.tone} />)}{FearGreedGaugePresentationPolicy.ticks.map((tick) => <path key={tick.score} className="mi-crypto-dashboard__gauge-tick" d={tick.path} />)}<g transform={`rotate(${FearGreedGaugePresentationPolicy.needleDegrees(fearGreedState.score)} ${FearGreedGaugePresentationPolicy.needleOrigin})`}>
            <path className="mi-crypto-dashboard__gauge-needle"
              data-gauge-bucket={FearGreedGaugePresentationPolicy.bucketTones[fearGreedState.bucket]}
              d={FearGreedGaugePresentationPolicy.needlePath} />
          </g>
          <circle className="mi-crypto-dashboard__gauge-readout"
            data-gauge-bucket={FearGreedGaugePresentationPolicy.bucketTones[fearGreedState.bucket]}
            cx={FearGreedGaugePresentationPolicy.readout.cx} cy={FearGreedGaugePresentationPolicy.readout.cy}
            r={FearGreedGaugePresentationPolicy.readout.radius} />
          </svg>
          <strong>{fearGreedState.score}</strong>
        </span>
        <span data-gauge-bucket-text={FearGreedGaugePresentationPolicy.bucketTones[fearGreedState.bucket]}>{text.fearGreed.buckets[fearGreedState.bucket]}</span><small>{text.fearGreed.observedAt} {formatTime(fearGreedState.observedAt)}</small><p>{text.sentiment.gaugeMarkers.fear} · {text.sentiment.gaugeMarkers.neutral} · {text.sentiment.gaugeMarkers.greed}</p>
      </> : fearGreedState.state === 'loading'
        ? <LoadingState label={text.fearGreed.loading} minHeight={120} />
        : fearGreedState.state === 'empty'
          ? <StateView state="empty" reasonCode="not-yet" />
          : <StateView state="error" reasonCode="unavailable"
              action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: onRetry }} />}
      </div>
    </section>
  </>
}

/**
 * 来源状态. The first three rows describe the panels that own a snapshot of their own; the feeds behind
 * the 市场状态 / 跨市场 table are printed by `FeedStatusStrip` below them — 异常优先, so a fallback is
 * stated where the figure it explains is described without making a healthy board cost a line per feed.
 */
function DashboardSidebar({ calendarState, fearGreedState, positioning, fundingRateState, feedRows, nowMs, text, onManageSource, onOpenCalendar }: { calendarState: DashboardEconomicCalendarState; fearGreedState: DashboardFearGreedState; positioning: DashboardPositioningViewState; fundingRateState: DashboardFundingRateHistoryState; feedRows: ReturnType<typeof projectDashboardFeedRows>; nowMs: number; text: CryptoDashboardText; onManageSource: () => void; onOpenCalendar: () => void }): React.ReactElement {
  const tags = { synthetic: text.crossAsset.syntheticTag, proxy: text.crossAsset.proxyTag, realIndex: text.crossAsset.indexNames.real }
  const formatTime = useShellTimeFormat()
  /**
   * 三行的词根只有一个：**读到 / 偏旧 · 截至 {时刻} / 读不到**（产品 2026-11-10，决定记录 §15）。
   * 「偏旧」永远是读到但过期——不并进「读不到」；日历那行没有新鲜度规则，所以不出现偏旧。
   */
  const positioningRow = projectPositioningSourceRow(positioning, fundingRateState)
  const positioningRowText = positioningRow.kind === 'stale'
    ? text.positioning.sourceStates.stale.replace('{time}', formatTime(positioningRow.since))
    : positioningRow.kind === 'read'
      ? positioningRow.fundingPartial ? text.positioning.sourceStates.partial : text.positioning.sourceStates.available
      : positioningRow.kind === 'unreadable'
        ? text.positioning.sourceStates.unavailable
        : positioningRow.kind === 'empty' ? text.positioning.sourceStates.empty : text.positioning.sourceStates.loading
  const positionedState = positioningRow.kind === 'read' ? (positioningRow.fundingPartial ? 'partial' : 'available')
    : positioningRow.kind === 'stale' ? 'stale'
      : positioningRow.kind === 'unreadable' ? 'unavailable' : positioningRow.kind
  const fearGreedRowText = fearGreedState.state === 'stale'
    ? text.fearGreed.sourceStates.stale.replace('{time}', formatTime(fearGreedState.observedAt))
    : text.fearGreed.sourceStates[fearGreedState.state]
  return <section className="mi-crypto-dashboard__source-region"><header><h2>{text.context.sourceStatus.title}</h2></header>{dashboardRealSourcePolicy.map((source) => source.sourceId === 'economic-calendar'
    ? <div className="mi-crypto-dashboard__source-row" data-source-id={source.sourceId} data-state={calendarState.state} key={source.sourceId}><i /><span>{text.macroReleaseDynamics.sourceName}</span><small>{text.macroReleaseDynamics.sourceStates[calendarState.state]}</small><div><Button onClick={onOpenCalendar} size="small" type="text">{text.macroReleaseDynamics.calendarAction}</Button><Button onClick={() => onManageSource()} size="small" type="text">{text.macroReleaseDynamics.manageSettings}</Button></div></div>
    : source.sourceId === 'fear-greed'
      ? <div className="mi-crypto-dashboard__source-row" data-source-id={source.sourceId} data-state={fearGreedState.state} key={source.sourceId}><i /><span>{text.fearGreed.sourceName}</span><small>{fearGreedRowText}</small><div><Button onClick={() => onManageSource()} size="small" type="text">{text.fearGreed.manageSettings}</Button></div></div>
      : <div className="mi-crypto-dashboard__source-row" data-source-id={source.sourceId} data-state={positionedState} key={source.sourceId}><i /><span>{text.positioning.sourceName}</span><small>{positioningRowText}</small><div><Button onClick={() => onManageSource()} size="small" type="text">{text.positioning.manageSettings}</Button></div></div>)}
    <FeedStatusStrip rows={feedRows} text={text.feedStatus} tags={tags} nowMs={nowMs} onManageSource={onManageSource} />
  </section>
}
