import { Button } from 'antd'
import { hostScreenDirty } from './drawerScreenDirty'

import { ConfirmProvider, useConfirm } from '@platform/ui/components/confirm'
import { LoadingState } from '@platform/ui/components/loading'
import { ErrorBoundary } from '@platform/ui/components/error-boundary'
import { ConfigDrawerPanel } from './ConfigDrawerPanel'
import type { BusinessFocus } from '../../settings/intelligence-sources/BusinessSettingsView'
import type { ProcessingSection } from './ProcessingSettingsPanel'
import type { BriefingSection } from './DailyBriefingSettingsPanel'
import type { NotificationSection } from '../../settings/intelligence-notification/NotificationDrawerScreen'
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
import { dashboardRealSourcePolicy, type DashboardFearGreedState } from './dashboardFearGreedModel'
import type { DashboardFundingRateHistoryState } from './dashboardFundingRateHistoryModel'
import type { DashboardPositioningViewState } from './dashboardOpenInterestModel'
import { projectPositioningCells } from './dashboardPositioningSourceState'
import { useDashboardFeedStatus } from './useDashboardFeedStatus'
import { cellLabel, cellSourceChoices, dashboardCellId, decideCellRead, isCellEnabled, resolveDashboardReadGates, selectedDollarSourceId, useDashboardCellEnabled, type CellEnabledIo, type CellReadDecision, type SourceStatusMap } from './dashboardCellEnabled'
import { resolveCapitalCellAvailability } from './dashboardCapitalCells'
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
import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import { PolicyPathDrawer } from './PolicyPathDrawer'

import { PolicyPathSlot } from './PolicyPathSlot'
import { resolvePolicyPathRender } from './dashboardPolicyPathBlock'
import { cellIdForSource } from '../../settings/intelligence-sources/dashboardSourceModules'
import { runSourceNowOnce } from '../../settings/intelligence-sources/sourceWrites'
import { SentimentPanel } from '../../features/industry/market-sentiment/SentimentPanel'
import { usePolicyPathReading } from './usePolicyPathReading'
import { useDataChangeRevision } from './useDataChangeRevision'

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
  cellState: typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['cellState']
  dailyBriefing: typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['dailyBriefing']
}

type Props = { text: CryptoDashboardText; locale?: 'zh-CN' | 'en-US'; briefingEnabled?: boolean; onOpenBriefing?: () => void; client: Pick<MacroEconomicCalendarClient, 'queryMonth'>; fearGreedClient: Pick<IntelligenceFearGreedClient, 'querySnapshot'>; fundingRateClient: { query: (input: { asOf: string }) => Promise<unknown> }; openInterestClient: { query: (input: { asOf: string; window: OpenInterestWindow }) => Promise<OpenInterestHistoryResult> }; divergenceClient?: { query: (input: { asOf: string }) => Promise<MarketDivergenceResult> }; capitalConditionsClient?: Pick<IntelligenceCapitalConditionsClient, 'querySnapshot'>; now: () => Date; onConfigureSources: () => void
  /**
   * 「管理这个来源」的去处。**可以带屏内位置**：资金面/持仓这些卡片知道自己是哪一格，
   * 不带就跟以前一样落在采集与数据的第一屏。
   */
  onManageSource: (focus?: BusinessFocus) => void
  onOpenCalendar: () => void }

export function CryptoIntelligenceDashboard({ text, locale = 'zh-CN', briefingEnabled = true, onOpenBriefing, client, fearGreedClient, fundingRateClient, openInterestClient, divergenceClient, capitalConditionsClient, now, onConfigureSources, onManageSource, onOpenCalendar, collectCapitalConditionsSources, crossAssetClient, macroMarketClient, macroRatesClient, dashboardFeedStatusClient, conclusionSlot, policySlot, calendarEventTitles, readMarketEvents, onSelectChartEvent, initialSettingsMenu, initialSourceFilter, initialBusinessPosition, initialDrawerSection, openSettingsRequest, cellEnabledIo, onOpenProcessingSettings }: Props & { collectCapitalConditionsSources?: () => Promise<void>; crossAssetClient?: ReturnType<typeof createCrossAssetObservationClient>; macroMarketClient?: MacroMarketSnapshotClient; macroRatesClient?: MacroRatesSnapshotClient; dashboardFeedStatusClient?: DashboardFeedStatusClient; conclusionSlot?: (node: HTMLDivElement | null) => void; policySlot?: HTMLDivElement | null
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
  initialSourceId?: string
  /** 「采集与数据 › 舆情」右边入口卡 → 抽屉的「内容处理」屏（页面层实现跳转）。 */
  onOpenProcessingSettings?: () => void
  /** 「采集与数据」里点源名/整行：切到「数据源」屏并定位这个源（页面层实现菜单切换）。 */
  /** 「采集与数据」那一屏的屏内定位（只作初值）：业务 / 模块卡 / 格。 */
  initialBusinessPosition?: BusinessFocus
  /** 三屏的屏内分区（只作初值）：菜单 + 那一块。只交给对得上的那一屏。 */
  initialDrawerSection?: Readonly<{ menu: ConfigDrawerMenu; section: string }>
  initialSourceFilter?: SourceFilter
  openSettingsRequest?: number
}): React.ReactElement {
  const resolveProductKey = useProductTextKey()
  const formatTime = useShellTimeFormat()
  // 格级启用：先算出「哪些格读、哪些格不读」，再决定要不要调各 client（关掉的格一次请求都不发）。
  const cellState = useDashboardCellEnabled({ io: cellEnabledIo })
  /**
   * 「采集写了库」在这一页的**唯一**订阅：命中 `dashboard` 面板才 +1，各读口按它重读自己那份读数
   * （保留旧值、不置 loading、失败沿用上一次）。卡片不订阅，也不写「我依赖哪些源」的映射——
   * 那层换算在发射端按来源注册表做。
   */
  const dataRevision = useDataChangeRevision({ panel: 'dashboard' })
  const readGates = resolveDashboardReadGates(cellState.cells)
  /** 启用表读完之前一处都不读：否则关掉的格在首帧仍会发一次请求。 */
  const readsReady = cellState.ready
  // 源级启用表先读：下面的每一次读都要按它判断，不能「读完再丢掉」。
  // 状态条那块即将删除，这里只保留它的读口给门禁用。
  const feedView = useDashboardFeedStatus({
    client: readsReady ? dashboardFeedStatusClient : undefined,
    crossAssetClient: readsReady && readGates.crossAsset ? crossAssetClient : undefined
  })
  // 失败但有上一次成功的表：继续用它判（不把七行打成「暂时读不到」），并给表格一个「上次读数」标记；
  // 只有**从未成功过**（没有 last-good）才让整表走 StateView。
  const sourceStatus: SourceStatusMap | undefined =
    feedView.feed?.state === 'available'
      ? Object.fromEntries(feedView.feed.sources.map(source => [source.sourceId, {
          enabled: source.enabled,
          hasCredential: source.hasCredential,
          requiresCredential: source.requiresCredential
        }]))
      : undefined
  const decisionsUsable = feedView.feedState !== 'loading'
  const decide = (moduleId: string, cellKey: string): CellReadDecision =>
    decideCellRead({ moduleId, cellKey, cells: cellState.cells, selections: cellState.selections, sources: sourceStatus })
  const readable = (moduleId: string, cellKey: string): boolean => decisionsUsable && decide(moduleId, cellKey).kind === 'read'
  const anyReadable = (...cells: ReadonlyArray<readonly [string, string]>): boolean =>
    cells.some(([moduleId, cellKey]) => readable(moduleId, cellKey))
  const cellStateLabels = { disabled: text.cellState.notEnabled, unreadable: text.cellState.sourceUnknown }
  /**
   * 资金面两格各自的原因与动作：判定走 `decideCellRead`，标签与落点由这一层给
   * （见 `dashboardCapitalCells.ts`）。两格是两个独立闭包，读者点哪一格就落到哪一格
   * （cellId 就是这一格的键，不共用卡级回跳）。
   */
  const capitalCellAvailability = resolveCapitalCellAvailability({
    cells: cellState.cells,
    selections: cellState.selections,
    sources: sourceStatus,
    sourceLabelOf: sourceId => resolveProductKey(`settings.intelligenceSources.sourceNames.${sourceId}`),
    openCell: cellKey => () => onManageSource({ business: 'dashboard', moduleKey: 'capital', cellId: dashboardCellId('capital', cellKey) }),
    retrySources: feedView.reload
  })
  // 情绪卡那一格被关掉：卡仍在，卡内遮罩说「来源没有启用」。
  const fearGreedCellOff = isCellEnabled(cellState.cells, dashboardCellId('fear-greed', 'index'))
    ? undefined
    : { sourceLabel: cellLabel('fear-greed', 'index') ?? '', onOpenSources: () => onManageSource({ business: 'dashboard', moduleKey: 'fear-greed', cellId: 'fear-greed:index' }) }
  // 市场状态表每一行：读不到 / 未启用就画状态行（不是删行）。
  const QUOTES_ROW_CELL_KEYS = {
    index: 'ndx', btc: 'btc', eth: 'eth', dxy: 'usd', gold: 'gold', us10y: 'ust10y', realRate: 'ust10y'
  } as const
  const rowStates = Object.fromEntries(Object.entries(QUOTES_ROW_CELL_KEYS).flatMap(([row, cellKey]) => {
    if (!decisionsUsable) return []
    const decision = decide('quotes', cellKey)
    if (decision.kind === 'read') return []
    return [[row, decision.kind === 'source-unknown' ? 'unreadable' : 'disabled']]
  }))
  /**
   * 「市场状态」标题右边那颗「启用数据」落到哪一格：**按行序第一行没配好的那一格**。
   * 落点带 cellId，读者点下去抽屉直接定位到这一格，而不是只停在看板组。
   */
  const firstDisabledQuotesCell = Object.entries(QUOTES_ROW_CELL_KEYS).find(([row]) => rowStates[row] === 'disabled')
  const calendarState = useDashboardEconomicCalendar({ client, now })
  const { state: fearGreedState, reload: reloadFearGreed } = useDashboardFearGreed({ client: fearGreedClient, disabled: !readsReady || !readable('fear-greed', 'index'), now, revision: dataRevision })
  // 费率那格读不到时的重读入口：与持仓各自一格，一格重试不影响另一格。
  const [fundingReloadKey, setFundingReloadKey] = useState(0)
  const fundingRateState = useDashboardFundingRateHistory({ client: fundingRateClient, disabled: !readsReady || !readGates.positioning, now, reloadKey: fundingReloadKey, revision: dataRevision })
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
  const positioningState = useDashboardOpenInterest({ client: openInterestClient, disabled: !anyReadable(['positioning', 'oi'], ['positioning', 'funding']), now, window: positioningWindow, revision: dataRevision })
  // 两格各自的源可用性：判定按「未配置 → 未启用 → 读不到」的顺序，来自源注册表与格级启用表，
  // 页面不自己判。两格同源，但启用是逐格的——只关一格时另一格照旧显示。
  const positioningCells = readsReady
    ? projectPositioningCells({
        configured: cellSourceChoices('positioning', 'oi').length > 0 && cellSourceChoices('positioning', 'funding').length > 0,
        enabled: {
          oi: isCellEnabled(cellState.cells, dashboardCellId('positioning', 'oi')),
          funding: isCellEnabled(cellState.cells, dashboardCellId('positioning', 'funding'))
        },
        positioning: positioningState,
        funding: fundingRateState
      })
    : undefined
  const divergence = useDashboardDivergence({ client: divergenceClient, now, revision: dataRevision })
  // 刷新 re-collects the sources before re-reading: re-reading the stored snapshot only ever
  // shows the reader the state they are already looking at.
  const [capitalReloadKey, setCapitalReloadKey] = useState(0)
  const [capitalRefreshing, setCapitalRefreshing] = useState(false)
  const [capitalRefreshFailed, setCapitalRefreshFailed] = useState(false)
  const capitalConditionsState = useCapitalConditions({ client: capitalConditionsClient, disabled: !anyReadable(['capital', 'stablecoin'], ['capital', 'etf']), now, reloadKey: capitalReloadKey, revision: dataRevision })
  // One macro read feeds two readers: the 市场状态 table inside the panel and the 来源状态 strip
  // below, so the strip cannot disagree with the figures it is describing.
  // 美元格选了源就按选的那条读；没选过（缺键）与今天一样，走默认主源。
  const dollarSourceId = selectedDollarSourceId(cellState.selections)
  const macroView = useMacroMarketSnapshot({
    client: macroMarketClient,
    disabled: !anyReadable(['quotes', 'usd'], ['quotes', 'gold']),
    ...(dollarSourceId === undefined ? {} : { dollarSourceId })
  })
  // The two rate rows read FRED's official daily closes through their own door: a daily reading cannot
  // ride the fifteen-minute macro snapshot without being repainted as if it were intraday.
  const macroRatesView = useMacroRatesSnapshot({ client: macroRatesClient, disabled: !anyReadable(['quotes', 'ust10y']) })
  // The policy row reads one assembled object: the meeting date, the official facts and the odds
  // history are joined in the main process, so this dashboard never builds a second opinion.
  const policyPathRead = usePolicyPathReading(readsReady && readGates.policyPath, dataRevision)
  const policyPath = policyPathRead.result
  // 利率路径是两源合成：会议日来自日历里的美联储官方日程，赔率来自 Polymarket。
  // 源级状态从同一张 `dashboardFeedStatus` 表读（与资金面同一个来源），不另开读口；
  // `undefined` 表示这张表还没读到，那一支不猜成「没启用」。
  const fedScheduleEnabled = feedView.feed?.state === 'available'
    ? feedView.feed.sources.find(source => source.sourceId === 'macro-calendar-fed')?.enabled
    : undefined
  const fedScheduleCellId = cellIdForSource('macro-calendar', 'macro-calendar-fed')
  const policyPathRender = resolvePolicyPathRender({
    cellEnabled: readGates.policyPath,
    scheduleEnabled: fedScheduleEnabled,
    settled: policyPathRead.settled,
    ...(policyPath === undefined ? {} : { result: policyPath })
  })
  const [policyDrawerOpen, setPolicyDrawerOpen] = useState(false)
  // The panel's copy, plus the calendar's title vocabulary when the page handed one down. Memoized
  // because the panel keys its calendar read off `eventTitles`: a fresh object every render would
  // make it re-query the calendar on every render of this dashboard.
  const crossAssetText = useMemo(
    () => ({ ...text.crossAsset, ...(calendarEventTitles ? { eventTitles: calendarEventTitles } : {}) }),
    [text.crossAsset, calendarEventTitles]
  )
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
          briefingPanel={<ConfigDrawerPanel screen="briefing"><DailyBriefingSettingsPanel
              {...(initialDrawerSection?.menu === 'briefing'
                ? { initialSection: initialDrawerSection.section as BriefingSection }
                : {})}
              onState={setDrawerScreen} /></ConfigDrawerPanel>}
          processingPanel={<ConfigDrawerPanel screen="processing"><ProcessingSettingsPanel
              {...(initialDrawerSection?.menu === 'processing'
                ? { initialSection: initialDrawerSection.section as ProcessingSection }
                : {})} /></ConfigDrawerPanel>}
          runLogPanel={<ConfigDrawerPanel screen="run-log"><RunLogDrawerPanel /></ConfigDrawerPanel>}
          notificationsPanel={<ConfigDrawerPanel screen="notifications"><NotificationSettingsPanel
              {...(initialDrawerSection?.menu === 'notifications'
                ? { initialSection: initialDrawerSection.section as NotificationSection }
                : {})} /></ConfigDrawerPanel>}
              /* 两屏都收抽屉给的定位/导航：点源名只在抽屉内换菜单，不走页面级「打开抽屉」。 */
              sourcesPanel={(nav) => <ConfigDrawerPanel screen="sources"><DashboardSourcesPanel
                pane="sources"
                {...(nav.focusSourceId === undefined ? {} : { initialSourceId: nav.focusSourceId })}
                initialFilter={initialSourceFilter}
                onDraftChange={setSourcesDraftDirty} /></ConfigDrawerPanel>}
              sourcesDataPanel={(nav) => <ConfigDrawerPanel screen="sourcesData"><DashboardSourcesPanel
                pane="business"
                {...(initialBusinessPosition === undefined ? {} : { initialBusinessPosition })}
                onOpenSourceConfig={nav.openSource}
                {...(onOpenProcessingSettings === undefined ? {} : { onOpenProcessingSettings })}
                onDraftChange={setSourcesDraftDirty} /></ConfigDrawerPanel>} />}
          </DrawerDiscardConfirm>
        </ConfirmProvider>
      </ErrorBoundary>

      {/* Named mount point: the analysis workspace portals its latest-conclusion
          card in here, directly under the macro release strip, so the card reads
          as part of this dashboard without the dashboard knowing timeline data. */}
      <div ref={conclusionSlot} data-dashboard-conclusion-slot />

      {crossAssetClient ? <CrossAssetObservationPanel
        client={crossAssetClient}
        rowStates={rowStates}
        sourceStatusStale={feedView.feedStale && feedView.feedLastSuccessAtMs !== undefined
          ? text.cellState.sourceStale.replace('{time}', formatTime(new Date(feedView.feedLastSuccessAtMs).toISOString()))
          : undefined}
        cellStateLabels={cellStateLabels}
        crossAssetReadingEnabled={anyReadable(['quotes', 'ndx'], ['quotes', 'btc'], ['quotes', 'eth'])}
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
        {...(firstDisabledQuotesCell === undefined ? {} : {
          onEnableData: () => onManageSource({ business: 'dashboard', moduleKey: 'quotes', cellId: dashboardCellId('quotes', firstDisabledQuotesCell[1]) })
        })}
        text={crossAssetText} /> : null}
      {/* 没配置源的模块**不藏**（用户 2026-11-11）：格关 / 源停 / 没配凭据 / 日历还没读到 / 读失败
          各说各的，只有真的读完才画读数。六态全在 `PolicyPathSlot`，判定在 `dashboardPolicyPathBlock.ts`；
          无论哪一支都落在同一个 `policySlot`（右栏），不再有「读到才进右栏」的分叉。 */}
      {readsReady ? <PolicyPathSlot
        text={text.policyPath}
        render={policyPathRender}
        {...(policyPath?.state === 'available' ? { reading: policyPath.reading } : {})}
        slot={policySlot}
        locale={locale}
        cellLabel={cellLabel('policy-path', 'probability') ?? ''}
        scheduleLabel={resolveProductKey('settings.intelligenceSources.sourceNames.macro-calendar-fed')}
        onOpen={() => setPolicyDrawerOpen(true)}
        onEnableCell={() => onManageSource({ business: 'dashboard', moduleKey: 'policy-path', cellId: dashboardCellId('policy-path', 'probability') })}
        onEnableSchedule={() => onManageSource({
          business: 'calendar',
          moduleKey: 'macro-calendar',
          ...(fedScheduleCellId === undefined ? {} : { cellId: fedScheduleCellId })
        })}
        onRunSchedule={() => {
          void runSourceNowOnce('macro-calendar-fed')
            .then(() => { policyPathRead.reload(); feedView.reload() })
            .catch(() => undefined)
        }}
        onRetry={policyPathRead.reload}
      /> : null}
      {policyDrawerOpen && policyPath?.state === 'available' ? <PolicyPathDrawer reading={policyPath.reading}
        text={text.policyPath} onClose={() => setPolicyDrawerOpen(false)} /> : null}
      {/* Reading order is 资金 → 风险偏好 → 杠杆: the sentiment gauge sits with the money rows, not
          beside the perpetual card, where it read as part of the funding reading. */}
      <div className="mi-crypto-dashboard__capital-positioning-row">
        {readsReady
          ? <SentimentPanel fearGreedState={fearGreedState} text={text} onRetry={reloadFearGreed}
              {...(fearGreedCellOff === undefined ? {} : { cellOff: fearGreedCellOff })} />
          : <LoadingState label={text.fearGreed.loading} minHeight={120} />}
        {/* 资金面卡自己逐格标「没配置 / 没启用」（`ef952ba`），宿主只把两格的状态传进去，
            不再用「两格都能读」决定画不画卡——那正是用户骂的整卡隐藏。 */}
        <CapitalConditionsPanel state={capitalConditionsState} text={text.capitalConditions}
          onRefresh={() => void refreshCapitalConditions()}
          refreshing={capitalRefreshing} refreshFailed={capitalRefreshFailed}
          cellAvailability={capitalCellAvailability} />
      </div>
      <div className="mi-crypto-dashboard__positioning-row">
        <PositioningPanel funding={fundingRateState} positioning={positioningState} window={positioningWindow}
          onWindowChange={setPositioningWindow} text={text.positioning}
          {...(positioningCells ? { cells: positioningCells } : {})}
          onOpenSources={() => onManageSource({ business: 'dashboard', moduleKey: 'positioning', cellId: 'positioning:oi' })}
          onReloadFunding={() => setFundingReloadKey(key => key + 1)} />
        {/* A conclusion about the card above it, not another section: the reader asks "so what do
            these two legs mean together" while looking at the chart, and a band of its own read
            as an unrelated module. */}
        <DivergencePanel state={divergence.state} text={text.divergence} onRetry={divergence.reload} />
      </div>

      {/* 持仓那一格**转述卡片算出来的判定**（`positioningState`），不自己判新鲜度：
              阈值只在 `dashboardPositioningPresentationPolicy` 里存在一次，行与卡不可能各判一套。 */}
      </div>
    </main>
  )
}
