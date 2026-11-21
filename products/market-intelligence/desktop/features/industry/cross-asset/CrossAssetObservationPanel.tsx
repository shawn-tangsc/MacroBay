import type { MarketCalendarMonthRead } from '../../../pages/intelligence/readMarketCalendarMonth'
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
import { crossAssetMacroReading, resolveCrossAssetStatusRows, type CrossAssetStatusId } from './crossAssetStatusRegistry'
import { crossAssetWindows } from './crossAssetWindowReturns'
import { chartLinesHiddenBy, CrossAssetReturnChart, linesWithoutComparableData, type CrossAssetChartLineId } from './CrossAssetReturnChart'
import { CircleSlash, TriangleAlert } from 'lucide-react'

import { CellStateCard, type CellStateKind } from '../../../pages/intelligence/DashboardCellState'
// 「偏旧」的阈值只认仓里那一处定义：另开一个数，两处迟早漂成两种说法（界面设计 2026-11-16）。
import { dashboardPositioningPresentationPolicy } from '../../../pages/intelligence/dashboardOpenInterestModel'
import { CrossAssetReadingLine } from './CrossAssetReadingLine'
import { CrossAssetStatusHeading } from './CrossAssetStatusHeading'
import { CrossAssetQuoteLegStatus } from './CrossAssetQuoteLegStatus'
import { crossAssetSignedValue } from './crossAssetFormat'
import { LiveBadge } from './CrossAssetLiveBadge'
import {
  AssetStatusRow, IndexObservation, IndexStatusRow, LoadingStatusRow, MacroStatusRow, PlannedStatusRow, RowHint, RowName, SourceUnavailableRow, WindowCells, indexRowName, levelText, livePriceText, macroMetrics,
  type MacroDriverId, type RowMetrics, type Text
} from './crossAssetStatusRows'
import { crossAssetTextKeys, crossAssetWindowLabelKeys } from './crossAssetTextKeys'
import type { CrossAssetEventLine } from './crossAssetEventLines'
import { useCrossAssetEventLines } from './useCrossAssetEventLines'
import type { MacroMarketViewState } from './useMacroMarketSnapshot'
import type { MacroRatesViewState } from './useMacroRatesSnapshot'
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

export function CrossAssetObservationPanel({ client, macroSnapshot, macroState, calendar = macroEconomicCalendarClient, readCalendarMonth, onSelectEvent, text, hideStatusRows, rowStates, rowStateLabels, cellStateLabels, sourceStatusStale, crossAssetReadingEnabled = true, onEnableData }: {
  client: ReturnType<typeof createCrossAssetObservationClient>; macroSnapshot?: MacroMarketSnapshotView
  /**
   * 两路读的**结算状态**：没有它，面板分不出「还没读完」与「读完了确实没有」，市场状态表就会先写
   * 「未接入」再改成「已接入」——先给结论再改结论（用户 11-02 报过的同一类毛病）。
   */
  macroState?: MacroMarketViewState
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
  /**
   * 状态行里那句「没启用 / 读不到」要点名时用（2026-11-12）：`source-disabled` 报**源名**、
   * `not-enabled` 报**格名**；缺省仍走 `cellStateLabels` 那两句笼统话。
   */
  rowStateLabels?: Readonly<Partial<Record<CrossAssetStatusId, string>>>
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
  readCalendarMonth?: (month: string, asOf: string) => Promise<MarketCalendarMonthRead | null>
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
  const eventLines = useCrossAssetEventLines({ calendar, readCalendarMonth, eventTitles: text.eventTitles, windowStart: snapshot?.windowStart, windowEnd: snapshot?.analysisEnd, asOf: snapshot?.asOf })
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
  // 默认**隐藏**（用户 2026-11-16 定）：开关关了才把这类行显示出来。
  const [hideUnavailable, setHideUnavailable] = useState(true)
  const readings = macroSnapshot && macroSnapshot.state !== 'unavailable' ? macroSnapshot.readings : []
  /** 快照自己的时刻：判「偏旧」的时钟只取这一处，不读宿主时间（同一屏两次渲染不会给出两种答案）。 */
  const snapshotAsOfMs = macroSnapshot !== undefined && macroSnapshot.state !== 'unavailable'
    ? Date.parse(macroSnapshot.asOf)
    : undefined
  const statusRows = resolveCrossAssetStatusRows(readings, { macro: macroState === 'loading' })
  /**
   * 图表工具条的说明：三行，分别是分析时刻、三条曲线的覆盖、相关性样本数。
   *
   * 交给平台浮层的 `lines`：**一行一个键、一行一份参数**（契约 §8）。数字先格式化好再传，
   * 调用点不拼句子；共用一份 `labelParams` 的旧写法已随契约取消——同一页两套气泡不行。
   * 没有快照时只留一行「暂不可用」，与原来那句同一个键。
   */
  const historyPopover: { lines: readonly HintLine[] } = snapshot ? {
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
  /**
   * 本段没有可比数据的线（本窗内曲线全是空点）：图例在名字后面说「本段无数据」，原因进图标题的 ⓘ。
   * 判据与图例同源（`linesWithoutComparableData`），所以「哪条线没有数据」只有一个说法；
   * 美元/黄金也算——休市或源停更时它们的整窗都是空点，读者看到的正是「美元 DXY 本段无数据」（用户 2026-11-16）。
   * 读失败不走这一支：通道没读到、格没启用、源没启用时线根本不进图例。
   */
  const noComparableChartLines = snapshot === undefined ? [] : linesWithoutComparableData(snapshot)
  /**
   * 被供应商**永久**拒绝的腿（读数自带 `sourceFailure`，判据在服务侧）：图例尾注要说「套餐不提供」，
   * ⓘ 里给最近收盘最新的一条、其余合并成一句。整块 ⓘ 仍只有 4 行（界面设计 2026-11-16）：
   * 三条固定说明 + 这里一行，所以"被拒"优先于"没有可比数据"，两者不叠加。
   */
  const planRefusedLines: readonly Readonly<{ line: CrossAssetChartLineId; name: string; atMs: number }>[] =
    (['dxy', 'gold'] as const).flatMap(line => {
      const reading = crossAssetMacroReading(readings, line)
      return reading?.sourceFailure === undefined ? [] : [{ line, name: text.assetLabels[line], atMs: reading.atMs }]
    }).sort((left, right) => right.atMs - left.atMs)
  const refusalHint: HintLine | undefined = planRefusedLines.length === 0 ? undefined : {
    labelKey: planRefusedLines.length > 1 ? crossAssetTextKeys.planNotServedReasonMore : crossAssetTextKeys.planNotServedReason,
    params: {
      name: planRefusedLines[0]!.name,
      time: formatTime(new Date(planRefusedLines[0]!.atMs).toISOString(), 'second'),
      count: String(planRefusedLines.length - 1)
    }
  }
  const historyPopoverLines: readonly HintLine[] = refusalHint !== undefined
    ? [...historyPopover.lines, refusalHint]
    : noComparableChartLines.length === 0
      ? historyPopover.lines
      : [...historyPopover.lines, { labelKey: crossAssetTextKeys.noComparableDataReason }]
  // 这张表只剩盘中读数（四个窗口）；日频那两行已经在「国债收益率 · 日频」卡里（用户 2026-11-22 定），
  // 同一屏不留两种说法。
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
            {rowStateLabels?.[row.id] ?? (state === 'unreadable' ? cellStateLabels!.unreadable : cellStateLabels!.disabled)}
          </span>
        </td>
      </tr>
    }
    // 供应商不再提供这个品种：整行盖住（行组件模块里的那一个），原因只在图标题的 ⓘ 里。
    if (row.id === 'dxy' || row.id === 'gold') {
      const reading = crossAssetMacroReading(readings, row.id)
      if (reading?.sourceFailure !== undefined) {
        return <SourceUnavailableRow key={row.id} id={row.id} label={text.assetLabels[row.id]}
          windows={crossAssetWindows.length} statusText={resolveProductText(crossAssetTextKeys.sourceRefused)} />
      }
    }
    return row.state === 'loading'
    ? <LoadingStatusRow key={row.id} id={row.id} text={text} />
    : row.state === 'planned'
      ? <PlannedStatusRow key={row.id} id={row.id} text={text} />
      : row.id === 'dxy' || row.id === 'gold'
        ? <MacroStatusRow key={row.id} id={row.id} text={text} formatTime={formatTime}
            reading={crossAssetMacroReading(readings, row.id)}
            {...(snapshotAsOfMs === undefined ? {} : { asOfMs: snapshotAsOfMs })} />
        : row.id === 'index'
            ? <IndexStatusRow key={row.id} snapshot={snapshot} text={text} formatTime={formatTime} />
            : <AssetStatusRow key={row.id} id={row.id} snapshot={snapshot} text={text} />
  }
  // 关掉的格整行不画：不是 0，也不是「未接入」那种占位。
  /** 被供应商永久拒绝的行：勾上「不显示来源不可用的行」时它们整行不出现。 */
  const unavailableRowIds = (['dxy', 'gold'] as const).filter(id => crossAssetMacroReading(readings, id)?.sourceFailure !== undefined)
  const visibleRows = (hideStatusRows === undefined || hideStatusRows.length === 0
    ? statusRows
    : statusRows.filter(row => !hideStatusRows.includes(row.id)))
    .filter(row => !(hideUnavailable && unavailableRowIds.includes(row.id as 'dxy' | 'gold')))
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
        <CrossAssetStatusHeading text={text} resolveProductText={resolveProductText}
          {...(titleAction === undefined ? {} : { action: titleAction })}
          toggle={{
            label: resolveProductText(crossAssetTextKeys.hideUnavailableRows),
            checked: hideUnavailable,
            onChange: setHideUnavailable
          }} />
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
          <tbody data-status-section="intraday">{visibleRows.map(renderStatusRow)}</tbody>
        </table>
        <small>{text.closed}{snapshot ? <IndexObservation snapshot={snapshot} text={text} formatTime={formatTime} /> : null}</small>
      </div>
      {crossAssetReadingEnabled && !allChartLinesUnusable ? <div data-cross-asset-region="chart"><div className="mi-cross-asset__chart-toolbar"><div className="mi-cross-asset__chart-actions"><h3>{text.chart}</h3>
        <FocusPopover
          lines={historyPopoverLines}
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
          hiddenLines={chartLinesHiddenBy([
            ...(hideStatusRows ?? []), ...Object.keys(rowStates ?? {}), ...planRefusedLines.map(entry => entry.line)
          ])}
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
