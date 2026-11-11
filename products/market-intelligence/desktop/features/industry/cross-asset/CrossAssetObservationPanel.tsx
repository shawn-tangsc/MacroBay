import { useEffect, useState } from 'react'
import { Button } from 'antd'
import { Info, RefreshCw } from 'lucide-react'
import { fillLabelParams } from '@platform/ui/components/textKeyParams'
import { LoadingState } from '@platform/ui/components/loading'
import { Popover as FocusPopover } from '@platform/ui/components/popover'
import { IconButton } from '@platform/ui/components/icon-button'
import { Segmented } from '@platform/ui/components/segmented'
import { StateView, STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state'
import { Tooltip as FocusTooltip } from '@platform/ui/components/tooltip'
import type { productText } from '../../../shared/i18n/productText'
import type { createCrossAssetObservationClient } from '../../../shared/ipc/crossAssetObservationClient'
import { crossAssetContractPolicy } from '../../../../contracts/crossAssetObservationContracts'
import type { CrossAssetId, CrossAssetMetric, CrossAssetSnapshot } from '../../../../contracts/crossAssetObservationContracts'
import type { MacroMarketSnapshotView, MacroMarketSnapshotReading } from '../../../../contracts/macro/macroMarketSnapshotContracts'
import { macroMarketSnapshotPublicPolicy } from '../../../../contracts/macro/macroMarketSnapshotContracts'
import type { MacroRatesReading, MacroRatesSnapshotView } from '../../../../contracts/macro/macroRatesSnapshotContracts'
import { macroRatesSnapshotPublicPolicy } from '../../../../contracts/macro/macroRatesSnapshotContracts'
import { useCrossAssetObservation } from './useCrossAssetObservation'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import { crossAssetMacroReading, crossAssetRatesSeriesIds, resolveCrossAssetStatusRows, type CrossAssetStatusId } from './crossAssetStatusRegistry'
import { crossAssetWindows } from './crossAssetWindowReturns'
import { chartLinesHiddenBy, CrossAssetReturnChart } from './CrossAssetReturnChart'
import { CircleSlash, TriangleAlert } from 'lucide-react'

import { CellStateCard, type CellStateKind } from '../../../pages/intelligence/DashboardCellState'
import { CrossAssetReadingLine } from './CrossAssetReadingLine'
import { CrossAssetStatusHeading } from './CrossAssetStatusHeading'
import { CrossAssetQuoteLegStatus } from './CrossAssetQuoteLegStatus'
import { crossAssetSignedValue } from './crossAssetFormat'
import { LiveBadge } from './CrossAssetLiveBadge'
import {
  AssetStatusRow, IndexObservation, IndexStatusRow, LoadingStatusRow, PlannedStatusRow, WindowCells, indexRowName, levelText, livePriceText, macroMetrics,
  type MacroDriverId, type RowMetrics, type Text
} from './crossAssetStatusRows'
import { crossAssetTextKeys, crossAssetWindowLabelKeys } from './crossAssetTextKeys'
import type { CrossAssetEventLine } from './crossAssetEventLines'
import { useCrossAssetEventLines } from './useCrossAssetEventLines'
import type { MacroMarketViewState } from './useMacroMarketSnapshot'
import type { MacroRatesViewState } from './useMacroRatesSnapshot'
import { basisPointsText, crossAssetRatesDailyExtras } from './crossAssetRatesDaily'
import { macroEconomicCalendarClient } from '../../../shared/ipc/macroEconomicCalendarClient'
import { MARKET_ANALYSIS_CONTEXT_CAVEATS } from '../../../../contracts/marketAnalysisContracts'

import './CrossAssetObservationPanel.css'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

/** The windows the chart offers, from the contract that defines them: a hand-copied list drifts. */
/**
 * 提示文案的键：指向本面板自己的那一块 `productText`。
 *
 * 平台 `Tooltip` 只收键、句子由调用方的解析器给；写死键名而不是把已解析的句子塞进
 * `resolveText={() => …}`，后者会让键形同虚设（守卫会拦，但更该一开始就写对）。
 */
const crossAssetRanges = crossAssetContractPolicy.ranges
type CrossAssetRange = typeof crossAssetRanges[number]

type HintLine = { labelKey: string; params?: Readonly<Record<string, string>> }

function RatesStatusRow({ id, reading, rates, text }: {
  id: 'us10y' | 'realRate'; reading: MacroRatesReading
  rates: ReadonlyMap<string, MacroRatesReading>; text: Text
}): React.ReactElement {
  const extras = crossAssetRatesDailyExtras({ id, reading, rates })
  const resolveText = useProductTextKey()
  /**
   * 「期限利差」与「通胀预期」是同一句话里本来就该并列的两段（同一张表相邻两个读数），所以合一个键：
   * 组合模板带三个参数，` · ` 是句子的一部分，不是调用点拼出来的结构（产品经理 2026-11-02 定的边界）。
   * 只有一段时各走单段键——不为少一行硬合，也不许两段拼在调用点。
   */
  const spread = extras.termSpreadDelta === undefined
    ? undefined
    : `${basisPointsText(extras.termSpreadDelta)}${text.bpUnit}`
  const inflation = extras.breakeven === undefined
    ? undefined
    : { value: extras.breakeven.value.toFixed(2), date: extras.breakeven.date }
  const detailLine: HintLine | undefined =
    spread !== undefined && inflation !== undefined
      ? { labelKey: crossAssetTextKeys.dailySpreadAndInflation, params: { spread, inflation: inflation.value, date: inflation.date } }
      : spread !== undefined
        ? { labelKey: crossAssetTextKeys.dailySpreadOnly, params: { spread } }
        : inflation !== undefined
          ? { labelKey: crossAssetTextKeys.inflationExpectationWithDate, params: { value: inflation.value, date: inflation.date } }
          : undefined
  const detail = detailLine === undefined ? undefined : fillLabelParams(resolveText(detailLine.labelKey), detailLine.params)
  const change = reading.previous === undefined
    ? fillLabelParams(resolveText(crossAssetTextKeys.dailyChangeUnknownWithDate), { date: reading.period })
    : fillLabelParams(resolveText(crossAssetTextKeys.dailyChangeWithDate), { change: `${basisPointsText(reading.actual - reading.previous)}${text.bpUnit}`, date: reading.period })
  // 气泡里的每一行都是「键 + 它自己的参数」：句子在 `productText`，调用点只给已格式化好的值。
  const dailyFacts: readonly HintLine[] = [
    { labelKey: crossAssetTextKeys.dailyFrequency },
    ...(detailLine === undefined ? [] : [detailLine]),
    ...(extras.mixedObservationDates ? [{ labelKey: crossAssetTextKeys.dailyMixedDates }] : []),
    { labelKey: crossAssetTextKeys.dailyCaveat }
  ]
  // 这一格不是控件：撤掉浮层与焦点停靠，说明改由可访问名承载（同一件事不占一个键盘站）。
  const dailyDescription = dailyFacts.map(line => resolveText(line.labelKey)).join(text.hintListSep)
  return <tr data-status-row={id} data-connected="true" data-observation-date={reading.period}>
    <th scope="row"><span>{text.assetLabels[id]}</span><small>{text.statusReads[id]}</small></th>
    <td data-asset-price={id}>{reading.actual.toFixed(2)}%</td>
    <td className="mi-cross-asset__daily" colSpan={crossAssetWindows.length} data-asset-daily={id}
      aria-label={dailyDescription}
      data-direction={reading.previous === undefined ? 0 : Math.sign(reading.actual - reading.previous)}
      data-caveat={macroRatesSnapshotPublicPolicy.caveats.officialDailyClose}
      {...(extras.mixedObservationDates ? { 'data-mixed-observation-dates': MARKET_ANALYSIS_CONTEXT_CAVEATS.macroRatesMixedPeriods } : {})}>
      <strong>{change}</strong>{detail ? <small data-asset-daily-detail={id}>{detail}</small> : null}
    </td>
  </tr>
}
function MacroStatusRow({ id, reading, text, formatTime }: {
  id: 'dxy' | 'gold'; reading?: MacroMarketSnapshotReading; text: Text
  formatTime: (value: string, precision: 'second') => string
}): React.ReactElement {
  // The live tick rides beside the collected level and never replaces it: the four window cells below
  // still come from stored points, and the freshness tag marks the 最新 cell as an unclosed value.
  const live = reading?.live
  const resolveText = useProductTextKey()
  return <tr data-status-row={id} data-connected="true">
    <th scope="row"><span>{text.assetLabels[id]}
      {/* The synthetic label rides with the level: a level this product computed is never shown as
          if it were the licensed index, and the caveat sentence is one hover away. */}
      {reading?.synthetic ? <em className="mi-cross-asset__synthetic" data-synthetic={id}
        aria-label={text.syntheticCaveat}
        data-caveat={macroMarketSnapshotPublicPolicy.caveats.syntheticDollarIndex}>{text.syntheticTag}</em> : null}
      {/* Freshness belongs with the name, beside the synthetic tag, not glued to the figure: a tag
          after the price reads as if it qualified the number itself. */}
      {live ? <LiveBadge state={live.state} tick={live} formatTime={formatTime} text={text} /> : null}
    </span>{text.statusReads[id] ? <small>{text.statusReads[id]}</small> : null}</th>
    <td data-asset-price={id}>{live ? livePriceText(live.price) : levelText(reading)}</td>
    <WindowCells id={id} metrics={macroMetrics(reading)} text={text} />
  </tr>
}
export function CrossAssetObservationPanel({ client, macroSnapshot, macroState, rates, ratesState, calendar = macroEconomicCalendarClient, readMarketEvents, onSelectEvent, text, hideStatusRows, rowStates, cellStateLabels, sourceStatusStale, crossAssetReadingEnabled = true, onEnableData }: {
  client: ReturnType<typeof createCrossAssetObservationClient>; macroSnapshot?: MacroMarketSnapshotView
  /**
   * 两路读的**结算状态**：没有它，面板分不出「还没读完」与「读完了确实没有」，市场状态表就会先写
   * 「未接入」再改成「已接入」——先给结论再改结论（用户 11-02 报过的同一类毛病）。
   */
  macroState?: MacroMarketViewState
  rates?: MacroRatesSnapshotView
  ratesState?: MacroRatesViewState
  /**
   * The panel's own copy, plus the calendar's title vocabulary when the page hands it over.
   *
   * Optional on purpose: duplicating the calendar's title map here would be a second copy of one list,
   * and the two would drift. Without it the lines still draw, labelled by the key rather than by an
   * invented name.
   */
  text: Text & Readonly<{ eventTitles?: Record<string, string> }>
  /**
   * 读者在设置里关掉的格：这些行**不渲染**（不是画 0、不是占位）。行 id 归本面板自己的表，
   * 格 → 行的换算在 `dashboardCellEnabled` 那一处做，这里只按 id 过滤。
   */
  hideStatusRows?: readonly CrossAssetStatusId[]
  /** 每行现在的三态：有值就画状态行（不是删行）；没有就画数据行。 */
  rowStates?: Readonly<Partial<Record<CrossAssetStatusId, CellStateKind>>>
  /** 三态那两句由宿主传（跨资产自己的文案表里没有它们，别在这里造第二份）。 */
  cellStateLabels?: Readonly<{ disabled: string; unreadable: string }>
  /** 源状态表是上一次成功的读数（读失败但有 last-good）；只作短状态词，说明不铺正文。 */
  sourceStatusStale?: string
  /** 三行行情（索引 / BTC / ETH）与图表同读一份跨资产快照：三格都关掉时整路不发请求。 */
  crossAssetReadingEnabled?: boolean
  /**
   * 「启用数据」的去处（宿主给：它知道这一格该落到哪）。**这一行是唯一的启用入口**——
   * 表里不再给逐行/表尾的启用或重试按钮，同屏只留标题右边这一颗。
   */
  onEnableData?: () => void
  /** The calendar, read by month: it is the only place this panel learns what happened and when. */
  calendar?: Readonly<{ queryMonth: (input: { month: string; asOf: string }) => Promise<unknown> }>
  /**
   * The 0xRouter route, read by month and paged, injected by the page which owns its locale.
   *
   * Read alongside the official one: that route carries nine release families, so a day whose data
   * came through the provider alone (initial claims, retail sales, PPI) drew nothing at all even
   * though the calendar listed it. Optional, and its failure costs only the provider's lines.
   */
  readMarketEvents?: (month: string, asOf: string) => Promise<readonly unknown[] | null>
  /**
   * Opening the event's drawer and recording it is the page's business, not the chart's.
   *
   * The month travels with the line because it is how the page re-reads that event: deriving it from
   * the instant mis-files a release published just after midnight, and the Agent's facts are read by
   * the month the calendar filed the event under.
   */
  onSelectEvent?: (line: CrossAssetEventLine, month: string) => void
}): React.ReactElement {
  const formatTime = useShellTimeFormat()
  const resolveProductText = useProductTextKey()
  const view = useCrossAssetObservation({ client, enabled: crossAssetReadingEnabled })
  const snapshot = view.snapshot
  /**
   * The window's events, reduced to drawable lines by the page's own calendar read.
   *
   * The hook owns the fetch, the month bookkeeping and the failure path; this component only draws
   * what it returns and hands a picked line back up.
   */
  const eventLines = useCrossAssetEventLines({ calendar, readMarketEvents, eventTitles: text.eventTitles, windowStart: snapshot?.windowStart, windowEnd: snapshot?.analysisEnd, asOf: snapshot?.asOf })
  /**
   * The same event read from two months would be one line either way; the first event names the line's
   * month, because a minute cannot belong to two. With no page listening the callback is absent and
   * the click does nothing, which is what a chart without an owner should do.
   */
  const selectEvent = (line: CrossAssetEventLine): void => {
    const eventKey = line.events[0]?.eventKey
    if (!eventKey) return
    onSelectEvent?.(line, eventLines.months[eventKey] ?? new Date(line.atMs).toISOString().slice(0, 7))
  }
  // An unavailable snapshot contributes nothing: the macro rows fall back to 未接入 rather than to
  // a level the dashboard cannot vouch for.
  const readings = macroSnapshot && macroSnapshot.state !== 'unavailable' ? macroSnapshot.readings : []
  const rateReadings = rates && rates.state !== 'unavailable' ? rates.readings : []
  const rateBySeries = new Map(rateReadings.map(reading => [reading.seriesId, reading]))
  const statusRows = resolveCrossAssetStatusRows(readings, rateReadings, {
    macro: macroState === 'loading', rates: ratesState === 'loading'
  })
  /**
   * 图表工具条的说明：三行，分别是分析时刻、三条曲线的覆盖、相关性样本数。
   *
   * 交给平台浮层的 `lines`：**一行一个键、一行一份参数**（契约 §8）。数字先格式化好再传，
   * 调用点不拼句子；共用一份 `labelParams` 的旧写法已随契约取消——同一页两套气泡不行。
   * 没有快照时只留一行「暂不可用」，与原来那句同一个键。
   */
  const historyHint: { lines: readonly HintLine[] } = snapshot ? {
    lines: [
      { labelKey: crossAssetTextKeys.hintAnalysis, params: { time: formatTime(snapshot.analysisEnd, 'second') } },
      {
        labelKey: crossAssetTextKeys.hintCoverage,
        params: {
          coverage: (['index', 'btc', 'eth'] as const).map(asset =>
            `${asset === 'index' ? indexRowName(snapshot, text) : text.assets[asset]} ${snapshot.historyCoverage[asset].count}/${snapshot.historyCoverage[asset].expectedCount}`
          ).join(text.hintListSep)
        }
      },
      {
        labelKey: crossAssetTextKeys.hintCorrelations,
        params: {
          correlations: text.correlations,
          indexBtc: `${snapshot.correlations.indexBtc.sampleCount}/288`,
          indexEth: `${snapshot.correlations.indexEth.sampleCount}/288`
        }
      }
    ]
  } : { lines: [{ labelKey: crossAssetTextKeys.unavailable }] }
  /** 图上画不出来的线（本窗内曲线全是空点）：图例标「未绘制」，原因进图标题的 ⓘ。 */
  const undrawnChartLines = snapshot === undefined ? [] : (['index', 'btc', 'eth'] as const)
    .filter(asset => (snapshot.curves[asset] ?? []).every(point => point.returnPercent === null))
  const historyHintLines: readonly HintLine[] = undrawnChartLines.length === 0
    ? historyHint.lines
    : [...historyHint.lines, { labelKey: 'pages.intelligence.portal.dashboard.crossAsset.lineNotDrawnReason' }]
  // Two kinds of reading live in this table and they answer questions at different speeds: intraday
  // ones move all day, official ones arrive once per business day. Mixed together, the daily rows read
  // as if they were merely quiet; kept apart, each block's header says what its numbers mean.
  const renderStatusRow = (row: (typeof statusRows)[number]): React.ReactElement => {
    const state = cellStateLabels === undefined ? undefined : rowStates?.[row.id]
    if (state !== undefined) {
      const name = row.id === 'index' || row.id === 'btc' || row.id === 'eth'
        ? text.assets[row.id]
        : text.assetLabels[row.id]
      const StateIcon = state === 'unreadable' ? TriangleAlert : CircleSlash
      return <tr aria-disabled="true" data-source-state={state} data-status-row={row.id}>
        <th scope="row"><span>{name}</span></th>
        <td className="mi-cross-asset__state-cell" colSpan={1 + crossAssetWindows.length}>
          <span className="mi-source-state" data-state={state}>
            <StateIcon aria-hidden="true" className="mi-source-state__icon" size={14} />
            {state === 'unreadable' ? cellStateLabels!.unreadable : cellStateLabels!.disabled}
          </span>
        </td>
      </tr>
    }
    return row.state === 'loading'
    ? <LoadingStatusRow key={row.id} id={row.id} text={text} />
    : row.state === 'planned'
      ? <PlannedStatusRow key={row.id} id={row.id} text={text} />
      : row.id === 'dxy' || row.id === 'gold'
        ? <MacroStatusRow key={row.id} id={row.id} text={text} formatTime={formatTime}
            reading={crossAssetMacroReading(readings, row.id)} />
        : row.id === 'us10y' || row.id === 'realRate'
          ? <RatesStatusRow key={row.id} id={row.id} text={text} rates={rateBySeries}
              reading={rateBySeries.get(crossAssetRatesSeriesIds[row.id])!} />
          : row.id === 'index'
            ? <IndexStatusRow key={row.id} snapshot={snapshot} text={text} formatTime={formatTime} />
            : <AssetStatusRow key={row.id} id={row.id} snapshot={snapshot} text={text} />
  }
  const dailyRowIds = ['us10y', 'realRate']
  // 关掉的格整行不画：不是 0，也不是「未接入」那种占位。
  const visibleRows = hideStatusRows === undefined || hideStatusRows.length === 0
    ? statusRows
    : statusRows.filter(row => !hideStatusRows.includes(row.id))
  // 跨资产图：三条线都不可用才整图不画（至少一条可用就照画）。
  const rowStateOf = (id: CrossAssetStatusId): CellStateKind | undefined => cellStateLabels === undefined ? undefined : rowStates?.[id]
  /** 有没有源没配好（未配置 / 未启用）：决定标题那颗是「启用数据」还是「再试一次」。 */
  const anyRowDisabled = statusRows.some(row => rowStateOf(row.id) === 'disabled')
  /**
   * 跨资产这条通道自己没读到（首读失败、没有快照）。**表不换成一整块提示**：表头与列名留着，
   * 状态句放在表头下第一行（用户 2026-11-11：结构要留）。
   * 契约不一致（版本不同）走另一支：重试治不了它，唯一的出口是重启应用，那一支的动作留在图上。
   */
  const channelUnavailable = snapshot === undefined && view.state !== 'loading' && view.failure !== 'contract'
  const contractMismatch = snapshot === undefined && view.state !== 'loading' && view.failure === 'contract'
  const chartLineStates = (['index', 'btc', 'eth'] as const).map(id => rowStates?.[id])
  const allChartLinesUnusable = cellStateLabels !== undefined && chartLineStates.every(state => state !== undefined)
  const chartLineUnreadable = chartLineStates.includes('unreadable')
  const intradayRows = visibleRows.filter(row => !dailyRowIds.includes(row.id))
  const dailyRows = visibleRows.filter(row => dailyRowIds.includes(row.id))
  /**
   * 标题右边那一颗，**这一张卡上唯一的「补数据」入口**（用户 2026-11-11：状态区里打不开，
   * 要放到「市场状态」标题右边；只要有用到的源没配好就出现）：
   * - 有源没配好（未配置/未启用）→「启用数据」，走宿主的来源配置入口（它知道该落哪一格）；
   * - 都配好了但有行读不到 →「再试一次」，就是原来那颗「更新历史」走的 `view.refresh()`，
   *   没有再写一套；
   * - 都读到 → 整颗不出现。
   */
  const titleAction = contractMismatch
    // 版本不一致重试治不了：标题行不给「再试一次」，图区那颗「重启应用」才是唯一出口。
    ? undefined
    : anyRowDisabled && onEnableData !== undefined
      ? { label: resolveProductText('pages.intelligence.portal.dashboard.crossAsset.enableData'), run: onEnableData }
      : !anyRowDisabled && (channelUnavailable || statusRows.some(row => rowStateOf(row.id) === 'unreadable'))
        ? { label: resolveProductText('pages.intelligence.portal.data.retry'), run: () => void view.refresh() }
        : undefined

  return <section className="mi-cross-asset" data-cross-asset-workspace aria-label={text.title}>
    <div className="mi-cross-asset__body">
      {/* The left slot keeps its historical class name; its content is the cross-asset status block:
          every input the reading depends on, with the ones still missing named rather than faked. */}
      <div className="mi-cross-asset__quote" data-cross-asset-region="status">
        <CrossAssetStatusHeading text={text} resolveProductText={resolveProductText} {...(titleAction === undefined ? {} : { action: titleAction })} />
        <table className="mi-cross-asset__status-table">
          {/* Explicit widths: with `table-layout: fixed` the header and the figures share one grid. */}
          <colgroup><col className="mi-cross-asset__status-col" /><col className="mi-cross-asset__status-col-latest" /><col className="mi-cross-asset__status-col-window" span={crossAssetWindows.length} /></colgroup>
          <thead><tr><th>{text.statusColumns.asset}{sourceStatusStale === undefined ? null : <small className="mi-cross-asset__stale" data-source-status-stale>{sourceStatusStale}</small>}</th><th>{text.statusColumns.latest}</th>
          {crossAssetWindows.map(window => <th key={window}>{text.statusColumns[window]}</th>)}</tr></thead>
          {/* 整表读不到也不再换成一整块状态面：行位与列头留着，每行自己说自己的状态
              （用户 2026-11-11 原话：从状态这里没法打开，把它放到标题右边；一大块提示会吃掉半张卡）。 */}
          {channelUnavailable || contractMismatch
            ? <tbody data-channel-state="unavailable"><tr>
                <td className="mi-cross-asset__state-cell" colSpan={2 + crossAssetWindows.length}>
                  <span className="mi-source-state" data-state="unreadable">
                    <TriangleAlert aria-hidden="true" className="mi-source-state__icon" size={14} />
                    {contractMismatch ? text.contractMismatch : text.unavailable}
                  </span>
                </td>
              </tr></tbody>
            : null}
          <tbody data-status-section="intraday">{intradayRows.map(renderStatusRow)}</tbody>
          {/* The daily block repeats the asset and latest headings but not the window columns: an
              observation per business day has nothing to say about the last fifteen minutes. */}
          <tbody data-status-section="daily">
            <tr className="mi-cross-asset__section"><th scope="colgroup" colSpan={2 + crossAssetWindows.length}>
              {/* 标题与 ⓘ 是一个 flex 容器里的两件东西，不是两个块级兄弟：块级流里 icon 会被挤到下一行，
                  还会因为没吃到复位而画出浏览器默认的方框（读者 2026-11-08 截图）。 */}
              <span className="mi-cross-asset__section-heading">{text.dailyFrequency}
              {/* The block's rhythm, on its heading rather than inside a figure cell: an official daily
                  close arrives once per trading day, so a row that has not moved for a day or two is
                  waiting for the source to publish, not stuck. The reader asked that after seeing
                  10-13 sit unchanged next to a chart timestamped 10-15.
                  It is one sentence, so it is a hint rather than a panel: the sentence rides on an icon
                  beside the title (reader, 2026-11-06), with the sentence as both its accessible name and
                  its tooltip. The heading row keeps one line and the answer stays one hover — or one
                  focus — away.
                  Size is the small档 on purpose: this heading is 9.5px, and the 24px step above made the
                  icon read as a badge hanging over the table (reader, 2026-11-06). 22px is the smallest
                  trigger the platform offers — it cannot be drawn at text size without a new档, and a new
                 档 is the component's decision, not this call site's. */}
              <FocusPopover labelKey={crossAssetTextKeys.dailyCadence} resolveText={resolveProductText}
                trigger={(triggerProps) => (
                  // 悬停/聚焦先看，点一下钉住：同一条说明的两种读法都在这颗按钮上，**不留空处理器**——
                  // 长得像 ⓘ 却点了没反应，读者只会以为坏了（界面设计 2026-11-07，同行那颗图表的 ⓘ 就是这种形状）。
                  // 点击只接 `onSelect` 一条：`IconButton` 的 `onClick` 之后仍会再调一次 `onSelect`，
                  // 两条都接就是同一个动作跑两遍——钉住又被立刻取消，点了看着像没反应。
                  <IconButton ariaLabelKey={crossAssetTextKeys.dailyCadence} className="mi-cross-asset__section-hint"
                    expanded={triggerProps.expanded} icon={Info} onBlur={triggerProps.onBlur}
                    onFocus={triggerProps.onFocus} onMouseEnter={triggerProps.onMouseEnter}
                    onMouseLeave={triggerProps.onMouseLeave} onSelect={triggerProps.onSelect}
                    resolveText={resolveProductText} size="sm" variant="plain" />
                )} /></span></th></tr>
            {dailyRows.map(renderStatusRow)}
          </tbody>
        </table>
        <small>{text.closed}{snapshot ? <IndexObservation snapshot={snapshot} text={text} formatTime={formatTime} /> : null}</small>
      </div>
      {crossAssetReadingEnabled && !allChartLinesUnusable ? <div data-cross-asset-region="chart"><div className="mi-cross-asset__chart-toolbar"><div className="mi-cross-asset__chart-actions"><h3>{text.chart}</h3>
        <FocusPopover
          lines={historyHintLines}
          resolveText={resolveProductText}
          trigger={(triggerProps) => (
            // The same IconButton as the status block's help: two explanations beside two titles
            // must not be two different-looking triggers.
            <IconButton
              ariaLabelKey={crossAssetTextKeys.analysis}
              expanded={triggerProps.expanded}
              icon={Info}
              onBlur={triggerProps.onBlur}
              onClick={triggerProps.onSelect}
              onFocus={triggerProps.onFocus}
              onMouseEnter={triggerProps.onMouseEnter}
              onMouseLeave={triggerProps.onMouseLeave}
              onSelect={() => undefined}
              resolveText={resolveProductText}
              size="md"
              variant="plain"
            />
          )} /></div>
        <div className="mi-cross-asset__chart-actions"><Segmented value={view.range} ariaLabelKey={crossAssetTextKeys.rangeLabel} resolveText={resolveProductText}
            items={crossAssetRanges.map(range => ({ value: range, labelKey: crossAssetWindowLabelKeys[range] }))}
            onChange={range => view.setRange(range as CrossAssetRange)} />
          <IconButton ariaLabelKey={crossAssetTextKeys.refresh} icon={RefreshCw} loading={view.refreshing}
            onSelect={() => void view.refresh()} size="md" tooltipKey={crossAssetTextKeys.refresh}
            resolveText={(key) => key === crossAssetTextKeys.refresh ? text.refresh : key} /></div></div>
        {/* 整块来源状态那枚药丸已撤掉（读者 2026-11-03）：曲线是已存下来的收盘，实时流断了它照样画，
            而药丸整块写「不可用」，读者只会读成「这张图坏了」。逐资产的读数仍在下一行，那才是读者要的答案。 */}
        {/* 实时报价那条腿没连上/过期：只在需要说明时画一行，句子按腿说、原因进 ⓘ。 */}
        {snapshot?.quotes === undefined ? null : <CrossAssetQuoteLegStatus quotes={snapshot.quotes} text={text} resolveProductText={resolveProductText} />}
        {/* The legend and the tooltip carry the same name the row does: one panel, one instrument name
            per figure, so a legend reading 「纳斯达克 100」 can never sit above `QQQUSDT`'s curve. */}
        {snapshot && view.stale ? <p data-cross-asset-stale>{text.staleRead}</p> : null}
        {(() => {
          return snapshot ? <CrossAssetReturnChart curves={snapshot.curves} macroCurves={snapshot.macroCurves} forming={snapshot.forming}
          hiddenLines={chartLinesHiddenBy([...(hideStatusRows ?? []), ...Object.keys(rowStates ?? {})])}
          events={eventLines.lines} eventsCollapsed={eventLines.collapsed} onSelectEvent={selectEvent}
          text={{ ...text, assets: { ...text.assets, index: indexRowName(snapshot, text) },
            // The macro lines carry the very names the 市场状态 rows beside them carry: one instrument,
            // one name per figure, so the legend and the table can never disagree.
            macroAssets: { dxy: text.assetLabels.dxy, gold: text.assetLabels.gold } }} />
          : view.state === 'loading'
            ? <LoadingState label={text.loading} fill />
            // 查询失败是「读不到」，不是「没有」：走统一状态面，码用 unreadable（程序故障，可重试）。
            // 主进程发来的快照不符合本版契约（版本不一致）时，重试读的是同一份契约：主进程更新后就
            // 会成功，没更新就仍然失败——原因句因此明说要重启应用，重试不是空按钮，但它也不是解药。
            // `unreadable` 在动作表里是 required，`retry` 是它唯一允许的动作（契约 §16）。
            : view.failure === 'contract'
              // 版本不一致重试多少次都一样：唯一的出口是重启应用。`needs-restart` 这个名字就是
              // 为它准备的，动作走平台那条窗口通道（`app.relaunch()` 后退出当前进程）。
              ? <StateView state="error" reasonCode="needs-restart" size="md"
                  productReason={{ key: 'mi.crossAsset.contractMismatch', resolve: () => text.contractMismatch }}
                  action={{ labelKey: STATE_VIEW_ACTION_KEYS.restart_app, onSelect: () => { void window.platform.app.relaunch() } }} />
              // 查询失败：**这一块不再画整块提示**（那是第二颗「再试一次」）。图区留空，
              // 状态句在表头下第一行，「再试一次」在标题行——一处入口。
              : null
        })()}
      </div> : allChartLinesUnusable ? <CellStateCard
        kind={chartLineUnreadable ? 'unreadable' : 'disabled'}
        label={chartLineUnreadable ? cellStateLabels!.unreadable : cellStateLabels!.disabled}
        onSelect={() => { if (chartLineUnreadable) void view.refresh() }} /> : null}
      {/* The reading line (design 142): one footnote spanning the panel, under the chart it explains.
          It is the product's own statement about the chart, kept apart from the model's conclusion — a
          reader must be able to tell "this is how the figure reads" from "this is what we think". */}
      {snapshot?.reading ? <CrossAssetReadingLine reading={snapshot.reading} text={text} /> : null}
      {/* 读法两行（设计 140 §4）暂时不渲染：读者 2026-10-15 要求规则解读留到后面单独做。
          文案（`readingMarket`/`readingEvent`，两种语言各一份）、样式与验收都原样保留，
          只把这一块撤下，恢复是一行的事。
          The two reading lines are withheld at the reader's request. The copy in both locales and its
          styles stay untouched, so the block can come back without being rewritten — and it must keep
          living outside the conclusion block, which is what lets a reader tell the product explaining
          the figure from the model judging it. */}
      {/* The 跨市场观察 aside (correlations, relative returns, facts) is temporarily unrendered: the
          data and its i18n keys are untouched, only this block is withheld for now. */}
    </div>
  </section>
}
