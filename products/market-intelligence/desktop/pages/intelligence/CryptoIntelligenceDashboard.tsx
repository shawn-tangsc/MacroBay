import { Button } from 'antd'

import type { BusinessFocus } from '../../settings/intelligence-sources/BusinessSettingsView'
import type { ConfigDrawerMenu } from '../../settings/config-drawer/drawerPreviewRows'
import type { SourceFilter } from '../../settings/intelligence-sources/SettingsSourceTree'
import { DailyBriefingSettingsPanel, type BriefingScreenState } from './DailyBriefingSettingsPanel'
import { ProcessingSettingsPanel } from './ProcessingSettingsPanel'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { Info } from 'lucide-react'

import type { MacroEconomicCalendarClient } from '../../features/macro/economic-calendar'
import { DivergencePanel } from '../../features/industry/divergence/DivergencePanel'
import { PositioningPanel } from '../../features/industry/positioning/PositioningPanel'
import { useDashboardDivergence } from './useDashboardDivergence'
import { useDashboardOpenInterest } from './useDashboardOpenInterest'
import type { MarketDivergenceResult } from '../../../contracts/marketDivergence'
import type { OpenInterestHistoryResult, OpenInterestWindow } from '../../../contracts/openInterestHistory'
import { CapitalConditionsPanel, useCapitalConditions, type IntelligenceCapitalConditionsClient } from '../../features/industry/capital-conditions'
import type { DashboardCapitalCellAvailability, DashboardCapitalCellOff } from '../../features/industry/capital-conditions/CapitalConditionsPanel'

import { projectPositioningCells } from './dashboardPositioningSourceState'
import { useDashboardFeedStatus } from './useDashboardFeedStatus'
import {
  cellLabel,
  cellSourceChoices,
  dashboardCellId,
  decideCellRead,
  resolveDashboardReadGates,
  selectedDollarSourceId,
  useDashboardCellEnabled,
  type CellEnabledIo,
  type CellReadDecision,
  type SourceEnabledMap
} from './dashboardCellEnabled'
import { useDashboardEconomicCalendar } from './useDashboardEconomicCalendar'
import { useDashboardFundingRateHistory } from './useDashboardFundingRateHistory'

import './cryptoDashboard.css'
import { CrossAssetObservationPanel } from '../../features/industry/cross-asset/CrossAssetObservationPanel'
import { UstYieldCurveSection } from '../../features/industry/ust-curve/UstYieldCurveSection'
import type { CrossAssetEventLine } from '../../features/industry/cross-asset/crossAssetEventLines'
import { useMacroMarketSnapshot } from '../../features/industry/cross-asset/useMacroMarketSnapshot'
import { useMacroRatesSnapshot } from '../../features/industry/cross-asset/useMacroRatesSnapshot'
import type { createCrossAssetObservationClient } from '../../shared/ipc/crossAssetObservationClient'
import type { DashboardFeedStatusClient } from '../../shared/ipc/dashboardFeedStatusClient'
import type { MacroMarketSnapshotClient } from '../../shared/ipc/macroMarketSnapshotClient'
import type { MacroRatesSnapshotClient } from '../../shared/ipc/macroRatesSnapshotClient'
import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import { PolicyPathDrawer } from './PolicyPathDrawer'
import { usePolicyDrawerOverlay } from './usePolicyDrawerOverlay'
import { createPortal } from 'react-dom'

import { MacroIndicatorDrawer, type CalendarDrawerRequest } from './MacroIndicatorDrawer'
import { useCurveReleaseEvents } from './useCurveReleaseEvents'
import { DashboardMacroRow } from './DashboardMacroRow'
import { SentimentOptionsCard } from '../../features/industry/market-sentiment/SentimentOptionsCard'
import { defensivePremiumCardText } from '../../features/industry/market-sentiment/defensivePremiumCardText'
import { useDashboardSentimentOptionsCard } from './useDashboardSentimentOptionsCard'
import { useCoalescedRevision } from './useCoalescedRevision'
import { intelligenceSentimentOptionsCardClient, type IntelligenceSentimentOptionsCardClient } from '../../shared/ipc/intelligenceSentimentOptionsCardClient'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { usePolicyPathReading } from './usePolicyPathReading'
import { useMacroIndicatorFacts } from './useMacroIndicatorFacts'
import { cellOffFor } from './dashboardCellOff'
import { QUOTES_ROW_CELL_KEYS, quoteRowPresentation } from './dashboardQuotesRows'
import { useDataChangeRevision } from './useDataChangeRevision'
import { DashboardSettingsDrawer } from './DashboardSettingsDrawer'
import type { CryptoDashboardText } from './cryptoDashboardText'

type Props = { text: CryptoDashboardText; locale?: 'zh-CN' | 'en-US'; briefingEnabled?: boolean; onOpenBriefing?: () => void; client: Pick<MacroEconomicCalendarClient, 'queryMonth'>; fundingRateClient: { query: (input: { asOf: string }) => Promise<unknown> }; openInterestClient: { query: (input: { asOf: string; window: OpenInterestWindow }) => Promise<OpenInterestHistoryResult> }; divergenceClient?: { query: (input: { asOf: string }) => Promise<MarketDivergenceResult> }; capitalConditionsClient?: Pick<IntelligenceCapitalConditionsClient, 'querySnapshot'>; sentimentOptionsClient?: Pick<IntelligenceSentimentOptionsCardClient, 'query'>; now: () => Date; onConfigureSources: () => void
  /**
   * 「管理这个来源」的去处。**可以带屏内位置**：资金面/持仓这些卡片知道自己是哪一格，
   * 不带就跟以前一样落在采集与数据的第一屏。
   */
  onManageSource: (focus?: BusinessFocus) => void
  /**
   * 看板里「打开日历」的入口（右栏那张发布日历的图标、日历卡的图标、「在日历中打开」）：
   * 旧日历页已删，现在打开的是日历抽屉。抽屉状态在本组件里，所以页面层只递一个**请求**——
   * 序号加一 = 请打开，`month`/`eventKey` 是这一次要落到的位置；不去共享内部开关。
   */
  openIndicatorDrawerRequest?: CalendarDrawerRequest
  /** 「接下来要看的」那块（layout 用同一次 cardData 构造后注入），透传给抽屉。 */
  calendarBlock?: React.ReactNode }

export function CryptoIntelligenceDashboard({ text, locale = 'zh-CN', briefingEnabled = true, onOpenBriefing, client, fundingRateClient, openInterestClient, divergenceClient, capitalConditionsClient, sentimentOptionsClient, now, onConfigureSources, onManageSource, openIndicatorDrawerRequest, calendarBlock, collectCapitalConditionsSources, crossAssetClient, macroMarketClient, macroRatesClient, dashboardFeedStatusClient, conclusionSlot, policySlot, calendarEventTitles, readCalendarMonth, onSelectChartEvent, initialSettingsMenu, initialSourceFilter, initialBusinessPosition, initialDrawerSection, openSettingsRequest, cellEnabledIo, onOpenProcessingSettings, onModalLayerChange }: Props & { collectCapitalConditionsSources?: () => Promise<void>; crossAssetClient?: ReturnType<typeof createCrossAssetObservationClient>; macroMarketClient?: MacroMarketSnapshotClient; macroRatesClient?: MacroRatesSnapshotClient; dashboardFeedStatusClient?: DashboardFeedStatusClient; conclusionSlot?: (node: HTMLDivElement | null) => void; policySlot?: HTMLDivElement | null
  /**
   * The calendar's event-title vocabulary, read from the product registry by the page entry and
   * carried here so the cross-asset panel can name the lines it draws. Never copied inline: one
   * list, one owner.
   */
  calendarEventTitles?: Record<string, string>
  /** The 0xRouter month's events, injected by the page: the chart's lines read both calendars. */
  readCalendarMonth?: (month: string, asOf: string) => Promise<import('./readMarketCalendarMonth').MarketCalendarMonthRead | null>
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
  /** 本层开的模态抽屉（设置 / 关键指标 / 政策详情）开着没有，报给布局：圆钮 z 比它们高，不报就是第二层入口。 */
  onModalLayerChange?: (open: boolean) => void
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
  /** 只有这张卡吃的合并 revision：5 秒合并、30 秒上限、隐藏不发、回前台补一次；共用源不动。 */
  const cardRevision = useCoalescedRevision(dataRevision)
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
  const sourceEnabled: SourceEnabledMap | undefined =
    feedView.feed?.state === 'available'
      ? Object.fromEntries(feedView.feed.sources.map(source => [source.sourceId, source.enabled]))
      : undefined
  const decisionsUsable = feedView.feedState !== 'loading'
  const decide = (moduleId: string, cellKey: string): CellReadDecision =>
    decideCellRead({ moduleId, cellKey, cells: cellState.cells, selections: cellState.selections, sources: sourceEnabled })
  const readable = (moduleId: string, cellKey: string): boolean => decisionsUsable && decide(moduleId, cellKey).kind === 'read'
  const anyReadable = (...cells: ReadonlyArray<readonly [string, string]>): boolean =>
    cells.some(([moduleId, cellKey]) => readable(moduleId, cellKey))
  const cellStateLabels = { disabled: text.cellState.notEnabled, unreadable: text.cellState.sourceUnknown }
  /**
   * 一格「不能用」时的那句话与落点：**先看判定 kind，不压成布尔**（2026-11-12 用户现场：
   * ETF 那格开着、0xRouter 这个源关着，卡片只画红边，从不说缺的是哪个源）。
   * - `not-enabled` → 说**这一格**（格名）；
   * - `source-disabled` → 说**那个源**（源显示名）；
   * - `read` / `source-unknown` → 不给这句（读不到由卡片自己的「读不到」承担）。
   */
  const cellOffOf = (
    moduleId: 'capital' | 'fear-greed',
    cellKey: string
  ): { sourceLabel: string; onOpenSources: () => void } | undefined => {
    const off = cellOffFor({
      decision: decide(moduleId, cellKey),
      cellLabel: cellLabel(moduleId, cellKey),
      sourceName: (sourceId) => resolveProductKey(`settings.intelligenceSources.sourceNames.${sourceId}`)
    })
    return off === undefined
      ? undefined
      : { ...off, onOpenSources: () => onManageSource({ business: 'dashboard', moduleKey: moduleId, cellId: dashboardCellId(moduleId, cellKey) }) }
  }
  /** 资金面两格各一颗「去启用」：**两个独立闭包**，读者点哪一格就落到哪一格。 */
  const capitalCellOff = (cellKey: string): DashboardCapitalCellOff | undefined => cellOffOf('capital', cellKey)
  const capitalCellAvailability: DashboardCapitalCellAvailability = {
    ...(capitalCellOff('stablecoin') === undefined ? {} : { stablecoin: capitalCellOff('stablecoin') }),
    ...(capitalCellOff('etf') === undefined ? {} : { etf: capitalCellOff('etf') })
  }
  // 情绪卡那一格不能用：卡仍在，遮罩说清是「这一格没启用」还是「这个源没启用」。
  const fearGreedCellOff = cellOffOf('fear-greed', 'index')
  // 市场状态表每一行：读不到 / 未启用就画状态行（不是删行）。
  const { rowStates, rowStateLabels } = quoteRowPresentation({
    decisionsUsable,
    decide,
    cellLabel: (row) => cellLabel('quotes', QUOTES_ROW_CELL_KEYS[row]),
    sourceName: (sourceId) => resolveProductKey(`settings.intelligenceSources.sourceNames.${sourceId}`)
  })
  const firstDisabledQuotesCell = Object.entries(QUOTES_ROW_CELL_KEYS).find(([row]) => rowStates[row as keyof typeof QUOTES_ROW_CELL_KEYS] === 'disabled')
  const calendarState = useDashboardEconomicCalendar({ client, now })
  const timeZone = useShellTimeZone()
  /**
   * 恐惧与防跌溢价卡：两半走**同一条**复合查询，刷新与数据事件都从这一个口进。启用表没读完之前
   * 一次都不读；格级关掉时的请求拦截随后跟着旧情绪格一起落。
   */
  const sentimentOptions = useDashboardSentimentOptionsCard({
    client: sentimentOptionsClient ?? intelligenceSentimentOptionsCardClient,
    now, timeZone, disabled: !readsReady, revision: cardRevision
  })
  // 费率那格读不到时的重读入口：与持仓各自一格，一格重试不影响另一格。
  const [fundingReloadKey, setFundingReloadKey] = useState(0)
  /**
   * 持仓两格各自的判定（**不压成布尔**）：格关了 / 源关了 / 源状态读不到 是三种不同的说法，
   * 压成 `false` 之后卡片只能一直「读不到」——2026-11-11 用户现场就是两格开着、币安源关着，
   * 卡永远停在加载。
   */
  const positioningDecisions = {
    oi: decide('positioning', 'oi'),
    funding: decide('positioning', 'funding')
  }
  const fundingRateState = useDashboardFundingRateHistory({
    client: fundingRateClient,
    waiting: !readsReady,
    disabled: decisionsUsable && positioningDecisions.funding.kind !== 'read',
    now, reloadKey: fundingReloadKey, revision: dataRevision
  })
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
  const positioningState = useDashboardOpenInterest({
    client: openInterestClient,
    // 还没读完启用表 → 首帧就是加载；读完并决定不读 → 终态（见 hook 里的两条分支）。
    waiting: !readsReady,
    disabled: decisionsUsable && positioningDecisions.oi.kind !== 'read' && positioningDecisions.funding.kind !== 'read',
    now, window: positioningWindow, revision: dataRevision
  })
  // 两格各自的源可用性：判定按「未配置 → 未启用 → 读不到」的顺序，来自源注册表与格级启用表，
  // 页面不自己判。两格同源，但启用是逐格的——只关一格时另一格照旧显示。
  const positioningCells = readsReady
    ? projectPositioningCells({
        configured: cellSourceChoices('positioning', 'oi').length > 0 && cellSourceChoices('positioning', 'funding').length > 0,
        decisions: positioningDecisions,
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
  // 紧张的是「同一份快照多读一次」，不是「多开一条读路径」：刷新换 token，表与图一起重读。
  const [ratesRefreshToken, setRatesRefreshToken] = useState(0)
  const macroRatesView = useMacroRatesSnapshot({ client: macroRatesClient, disabled: !anyReadable(['quotes', 'ust10y']), refreshToken: ratesRefreshToken })
  // The policy row reads one assembled object: the meeting date, the official facts and the odds
  // history are joined in the main process, so this dashboard never builds a second opinion.
  /**
   * 政策路径有**两条硬依赖**（会议日 ← 美联储日程，赔率 ← Polymarket），同模块两格。
   * 任一格没去读，这一格就打不开——所以逐格判定，缺哪格说哪格（2026-11-12 用户与架构师口径）。
   */
  const policyProbability = decide('policy-path', 'probability')
  const policyFed = decide('policy-path', 'fed')
  const policyCellsRead = policyProbability.kind === 'read' && policyFed.kind === 'read'
  const policyPathRead = usePolicyPathReading(readsReady && policyCellsRead, dataRevision)
  const policyPath = policyPathRead.result
  // 三张简化卡的读数走自己的只读接口（按指标身份取最新已发布）；抽屉只管渲染，不再取第二遍。
  const cardFactsRead = useMacroIndicatorFacts(readsReady, dataRevision)
  const cardFactsView = cardFactsRead.result
  /**
   * 时钟卡：日期与周期 P 来自日程（同一个按月读），值来自**与抽屉同一次**卡片读数，
   * 政策块来自政策读数。角度/透明度/撞牌都在 `clockCardModel` 里算，这里不重算。
   */
  const clockFacts = cardFactsView?.state === 'available' ? cardFactsView.facts : []
  const policyDrawer = usePolicyDrawerOverlay()
  // 关键指标 · 预期变化：曲线、政策卡与三张简化卡都读真数据。
  const [indicatorDrawerOpen, setIndicatorDrawerOpen] = useState(false)
  // 页面层请求打开日历抽屉：请求序号一变就开，不去共享内部开关。定位由抽屉按序号自己落一次。
  useEffect(() => {
    if ((openIndicatorDrawerRequest?.seq ?? 0) > 0) setIndicatorDrawerOpen(true)
  }, [openIndicatorDrawerRequest])
  // 这三层是本层开的：任一开着就报给布局（圆钮压在上面就是第二层入口）。
  const dashboardModalOpen = settingsDrawerOpen || indicatorDrawerOpen || policyDrawer.open
  useEffect(() => { onModalLayerChange?.(dashboardModalOpen) }, [dashboardModalOpen, onModalLayerChange])
  // 抽屉的「现在」在**每次打开时**取一次：每渲染都取会让按月的读跟着重读同一份快照。
  const drawerNow = useMemo(() => now().toISOString(), [now, indicatorDrawerOpen])
  // 曲线事件标注的输入：只用页面原有的那个日历读（按月、按 asOf），不新开取数通道。
  const curveReleaseEvents = useCurveReleaseEvents({
    // 时钟卡要看日程（上一期/下一期/周期 P），这份按月读不再只服务抽屉。
    enabled: true,
    ...(readCalendarMonth ? { readCalendarMonth } : {}),
    // 用曲线那次读数的快照时刻，不另取「现在」：两处各取各的，标注就对不上它标的跳变。
    ...(policyPath?.state === 'available' ? { asOf: policyPath.asOf, reading: policyPath.reading } : {}),
    locale
  })
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

      {/* 设置抽屉：外壳、两层边界、丢弃确认都在 `DashboardSettingsDrawer` 里（2026-11-16 抽出）。 */}
      <DashboardSettingsDrawer
        open={settingsDrawerOpen}
        requestKey={openSettingsRequest ?? 0}
        initialMenu={initialSettingsMenu}
        {...(initialDrawerSection === undefined ? {} : { initialDrawerSection })}
        initialSourceFilter={initialSourceFilter}
        {...(initialBusinessPosition === undefined ? {} : { initialBusinessPosition })}
        {...(onOpenProcessingSettings === undefined ? {} : { onOpenProcessingSettings })}
        sourcesDraftDirty={sourcesDraftDirty}
        screen={drawerScreen}
        onScreenState={setDrawerScreen}
        onClose={() => setSettingsDrawerOpen(false)}
        onDraftChange={setSourcesDraftDirty} />

      {/* 左栏顶部一排两块（用户 2026-11-15）：钟表 336 固定 + 利率数学期望占满剩余。
          间距只有 8，这一排不带左右内距；AI 结论已搬到右栏（下面那个 portal）。 */}
      <DashboardMacroRow
        pending={!readsReady}
        locale={locale}
        text={text}
        now={now}
        events={curveReleaseEvents}
        facts={clockFacts}
        {...(policyPath?.state === 'available' ? { reading: policyPath.reading } : {})}
        policyUnavailable={policyPath?.state === 'unavailable'}
        reloadPolicy={policyPathRead.reload}
        probability={policyProbability}
        fed={policyFed}
        onConfigureSources={onConfigureSources}
        onManageSource={onManageSource}
        onOpenDrawer={() => setIndicatorDrawerOpen(true)}
        resolveKey={resolveProductKey} />
      {crossAssetClient ? <CrossAssetObservationPanel
        client={crossAssetClient}
        rowStates={rowStates}
        rowStateLabels={rowStateLabels}
        sourceStatusStale={feedView.feedStale && feedView.feedLastSuccessAtMs !== undefined
          ? text.cellState.sourceStale.replace('{time}', formatTime(new Date(feedView.feedLastSuccessAtMs).toISOString()))
          : undefined}
        cellStateLabels={cellStateLabels}
        crossAssetReadingEnabled={anyReadable(['quotes', 'ndx'], ['quotes', 'btc'], ['quotes', 'eth'])}
        macroSnapshot={macroView.snapshot}
        macroState={macroView.state}
        // The panel reads the same calendar this dashboard already reads, rather than reaching for a
        // second client of its own: one month query per window, one source of truth for the events.
        calendar={client}
        readCalendarMonth={readCalendarMonth}
        // …and it hands a picked line up rather than opening anything itself: the page owns both the
        // detail drawer and the recorded selection.
        onSelectEvent={onSelectChartEvent}
        {...(firstDisabledQuotesCell === undefined ? {} : {
          onEnableData: () => onManageSource({ business: 'dashboard', moduleKey: 'quotes', cellId: dashboardCellId('quotes', firstDisabledQuotesCell[1]) })
        })}
        text={crossAssetText} /> : null}
      <UstYieldCurveSection view={macroRatesView} settled={readsReady} enabled={anyReadable(['quotes', 'ust10y'])}
        resolveText={resolveProductKey} timeZone={timeZone} locale={locale}
        refresh={() => setRatesRefreshToken((token) => token + 1)}
        onEnable={() => onManageSource({ business: 'dashboard', moduleKey: 'quotes', cellId: dashboardCellId('quotes', 'ust10y') })} />
      {/* 没配置源的模块**不藏**（用户 2026-11-11）：格级关掉时这一格仍在，显示「来源没有启用」+ 去启用；
          读数没读出来显示读不到 + 再试一次；只有真的读完才画读数。 */}
      {readsReady ? (() => {
        // 右栏顶部现在装 AI 结论（原来钟表卡在这里）：同一栏、占满整栏。
        const conclusionMount = <div ref={conclusionSlot} data-dashboard-conclusion-slot />
        return policySlot ? createPortal(conclusionMount, policySlot) : conclusionMount
      })() : null}
      {policyDrawer.open && policyPath?.state === 'available' ? <PolicyPathDrawer reading={policyPath.reading} text={text.policyPath} onClose={policyDrawer.close} returnFocusTo={policyDrawer.trigger} /> : null}
      {/* 关键指标抽屉：曲线与政策卡读同一份真实读数；三张简化卡读装配层的事实。右侧滑出，与左侧分析详情不是同一层。 */}
      {<MacroIndicatorDrawer open={indicatorDrawerOpen} locale={locale} policyText={text.policyPath}
        {...(calendarBlock === undefined ? {} : { calendarBlock })}
        {...(policyPath?.state === 'available' ? { policyReading: policyPath.reading } : {})}
        onRetryPolicy={policyPathRead.reload}
        releaseEvents={curveReleaseEvents}
        {...(cardFactsView?.state === 'available' ? { cardFacts: cardFactsView.facts } : {})}
        {...(cardFactsView?.state === 'unavailable' ? { cardFactsUnreadable: true } : {})}
        now={drawerNow} openTarget={openIndicatorDrawerRequest}
        {...(readCalendarMonth ? { readCalendarMonth } : {})}
        onOpenPolicyDetail={policyDrawer.openFrom} onConfigure={onConfigureSources}
        onClose={() => setIndicatorDrawerOpen(false)} />}
      {/* 恐惧与防跌溢价：整行一条带，落在「同一起点收益率」之后、资金面之前（界面定稿落法 A）。
          卡里左半就是原来资金面带里那副仪表：读口、组件、锚点都只此一份。 */}
      <div className="mi-crypto-dashboard__defensive-premium-row">
        <SentimentOptionsCard state={sentimentOptions.state} text={defensivePremiumCardText(text)}
          onRefresh={sentimentOptions.reload} onViewSource={() => onManageSource()}
          {...(fearGreedCellOff === undefined ? {} : { cellOff: fearGreedCellOff })} />
      </div>
      {/* 阅读顺序：同一起点收益率 → 恐惧与防跌溢价 → 资金面 → 杠杆。情绪不再并进资金面那一带：
          它已经是上面那张整行卡的一半，和资金面是两件事。资金面自己占满整行，不留左列。 */}
      <div className="mi-crypto-dashboard__capital-positioning-row">
        {/* 资金面卡逐格标「没配置 / 没启用」（`ef952ba`），宿主只把两格的状态传进去，
            不用「两格都能读」决定画不画卡——那正是用户骂的整卡隐藏。 */}
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
