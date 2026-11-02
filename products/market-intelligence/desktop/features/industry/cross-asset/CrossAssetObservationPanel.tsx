import { useEffect, useState } from 'react'
import { Button } from 'antd'
import { Info, RefreshCw } from 'lucide-react'
import { fillLabelParams } from '@platform/ui/components/textKeyParams'
import { LoadingState } from '@platform/ui/components/loading'
import { Popover as FocusPopover } from '@platform/ui/components/popover'
import { IconButton } from '@platform/ui/components/icon-button'
import { Segmented } from '@platform/ui/components/segmented'
import { StatusPill, type StatusPillTone } from '@platform/ui/components/status-pill'
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
import { crossAssetMacroReading, crossAssetRatesSeriesIds, resolveCrossAssetStatusRows } from './crossAssetStatusRegistry'
import { crossAssetWindows } from './crossAssetWindowReturns'
import { CrossAssetReturnChart } from './CrossAssetReturnChart'
import { CrossAssetReadingLine } from './CrossAssetReadingLine'
import { crossAssetSignedValue } from './crossAssetFormat'
import { LiveBadge } from './CrossAssetLiveBadge'
import {
  AssetStatusRow, IndexObservation, IndexStatusRow, PlannedStatusRow, WindowCells, indexRowName, levelText, livePriceText, macroMetrics,
  type MacroDriverId, type RowMetrics, type Text
} from './crossAssetStatusRows'
import { crossAssetTextKeys, crossAssetWindowLabelKeys } from './crossAssetTextKeys'
import type { CrossAssetEventLine } from './crossAssetEventLines'
import { useCrossAssetEventLines } from './useCrossAssetEventLines'
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
/**
 * 来源状态到药丸档位的映射：五档闭集，越限与滞后都算「需要看一眼」。
 *
 * 「资源受限」保留原词配 `warn`——它说的是我们的采集被挡了，不是数据旧，
 * 并成「数据偏旧」会让读者以为等一会儿就好。
 */
const sourceStateTone: Readonly<Record<'disabled' | 'connecting' | 'live' | 'stale' | 'limited' | 'unavailable', StatusPillTone>> = Object.freeze({
  disabled: 'muted', connecting: 'info', live: 'ok', stale: 'warn', limited: 'warn', unavailable: 'bad'
})
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
export function CrossAssetObservationPanel({ client, macroSnapshot, rates, calendar = macroEconomicCalendarClient, readMarketEvents, onSelectEvent, text }: {
  client: ReturnType<typeof createCrossAssetObservationClient>; macroSnapshot?: MacroMarketSnapshotView
  rates?: MacroRatesSnapshotView
  /**
   * The panel's own copy, plus the calendar's title vocabulary when the page hands it over.
   *
   * Optional on purpose: duplicating the calendar's title map here would be a second copy of one list,
   * and the two would drift. Without it the lines still draw, labelled by the key rather than by an
   * invented name.
   */
  text: Text & Readonly<{ eventTitles?: Record<string, string> }>
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
  const view = useCrossAssetObservation({ client })
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
  const statusRows = resolveCrossAssetStatusRows(readings, rateReadings)
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
  // Two kinds of reading live in this table and they answer questions at different speeds: intraday
  // ones move all day, official ones arrive once per business day. Mixed together, the daily rows read
  // as if they were merely quiet; kept apart, each block's header says what its numbers mean.
  const renderStatusRow = (row: (typeof statusRows)[number]): React.ReactElement => row.state === 'planned'
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
  const dailyRowIds = ['us10y', 'realRate']
  const intradayRows = statusRows.filter(row => !dailyRowIds.includes(row.id))
  const dailyRows = statusRows.filter(row => dailyRowIds.includes(row.id))

  return <section className="mi-cross-asset" data-cross-asset-workspace aria-label={text.title}>
    <div className="mi-cross-asset__body">
      {/* The left slot keeps its historical class name; its content is the cross-asset status block:
          every input the reading depends on, with the ones still missing named rather than faked. */}
      <div className="mi-cross-asset__quote" data-cross-asset-region="status">
        <div className="mi-cross-asset__quote-heading"><h3>{text.statusTitle}</h3>
        <IconButton
          ariaLabelKey={crossAssetTextKeys.subtitle}
          icon={Info}
          onSelect={() => undefined}
          resolveText={resolveProductText}
          size="md"
          tooltipKey={crossAssetTextKeys.subtitle}
        /></div>
        <table className="mi-cross-asset__status-table">
          {/* Explicit widths: with `table-layout: fixed` the header and the figures share one grid. */}
          <colgroup><col className="mi-cross-asset__status-col" /><col className="mi-cross-asset__status-col-latest" /><col className="mi-cross-asset__status-col-window" span={crossAssetWindows.length} /></colgroup>
          <thead><tr><th>{text.statusColumns.asset}</th><th>{text.statusColumns.latest}</th>
          {crossAssetWindows.map(window => <th key={window}>{text.statusColumns[window]}</th>)}</tr></thead>
          <tbody data-status-section="intraday">{intradayRows.map(renderStatusRow)}</tbody>
          {/* The daily block repeats the asset and latest headings but not the window columns: an
              observation per business day has nothing to say about the last fifteen minutes. */}
          <tbody data-status-section="daily">
            <tr className="mi-cross-asset__section"><th scope="colgroup" colSpan={2 + crossAssetWindows.length}>{text.dailyFrequency}
              {/* The block's rhythm, on its heading rather than inside a figure cell: an official daily
                  close arrives once per trading day, so a row that has not moved for a day or two is
                  waiting for the source to publish, not stuck. The reader asked that after seeing
                  10-13 sit unchanged next to a chart timestamped 10-15. */}
              <small data-daily-cadence>{text.dailyCadence}</small></th></tr>
            {dailyRows.map(renderStatusRow)}
          </tbody>
        </table>
        <small>{text.closed}{snapshot ? <IndexObservation snapshot={snapshot} text={text} formatTime={formatTime} /> : null}</small>
      </div>
      <div data-cross-asset-region="chart"><div className="mi-cross-asset__chart-toolbar"><div className="mi-cross-asset__chart-actions"><h3>{text.chart}</h3>
        <FocusPopover
          {...historyHint}
          resolveText={resolveProductText}
          trigger={(triggerProps) => (
            <Button
              aria-expanded={triggerProps.expanded}
              aria-label={text.analysis}
              icon={<Info size={13} />}
              onBlur={triggerProps.onBlur}
              onClick={triggerProps.onSelect}
              onFocus={triggerProps.onFocus}
              onMouseEnter={triggerProps.onMouseEnter}
              onMouseLeave={triggerProps.onMouseLeave}
              size="small"
              type="text" />
          )} /></div>
        <div className="mi-cross-asset__chart-actions"><Segmented value={view.range} ariaLabelKey={crossAssetTextKeys.rangeLabel} resolveText={resolveProductText}
            items={crossAssetRanges.map(range => ({ value: range, labelKey: crossAssetWindowLabelKeys[range] }))}
            onChange={range => view.setRange(range as CrossAssetRange)} />
          <IconButton ariaLabelKey={crossAssetTextKeys.refresh} icon={RefreshCw} loading={view.refreshing}
            onSelect={() => void view.refresh()} size="md" tooltipKey={crossAssetTextKeys.refresh}
            resolveText={(key) => key === crossAssetTextKeys.refresh ? text.refresh : key} /></div></div>
        {/* 整块来源状态：药丸只标「这一块数据的整体状态」，逐资产的留给下面那行小字。 */}
        {snapshot?.sourceState && snapshot.sourceState !== 'live'
          ? <span data-source-state={snapshot.sourceState}><StatusPill tone={sourceStateTone[snapshot.sourceState]}
              labelKey={crossAssetTextKeys.states[snapshot.sourceState]} resolveText={resolveProductText} /></span>
          : null}
        {snapshot?.quotes ? <div className="mi-cross-asset__status">{(['btc', 'eth'] as const).filter(asset => snapshot.quotes![asset].state !== 'live').map(asset => <small key={asset} data-quote-asset={asset}>{text.assets[asset]} {text.states[snapshot.quotes![asset].state]}</small>)}</div> : null}
        {/* The legend and the tooltip carry the same name the row does: one panel, one instrument name
            per figure, so a legend reading 「纳斯达克 100」 can never sit above `QQQUSDT`'s curve. */}
        {snapshot ? <CrossAssetReturnChart curves={snapshot.curves} macroCurves={snapshot.macroCurves} forming={snapshot.forming}
          events={eventLines.lines} eventsCollapsed={eventLines.collapsed} onSelectEvent={selectEvent}
          text={{ ...text, assets: { ...text.assets, index: indexRowName(snapshot, text) },
            // The macro lines carry the very names the 市场状态 rows beside them carry: one instrument,
            // one name per figure, so the legend and the table can never disagree.
            macroAssets: { dxy: text.assetLabels.dxy, gold: text.assetLabels.gold } }} />
          : view.state === 'loading'
            ? <LoadingState label={text.loading} fill />
            // 查询失败是「读不到」，不是「没有」：走统一状态面，码用 unreadable（程序故障，可重试）。
            // 「来源被关」那一支等设置深链入口落地后再拆成 disabled · target-disabled。
            // 主进程发来的快照不符合本版契约（版本不一致）时，重试读的是同一份契约：主进程更新后就
            // 会成功，没更新就仍然失败——原因句因此明说要重启应用，重试不是空按钮，但它也不是解药。
            // `unreadable` 在动作表里是 required，`retry` 是它唯一允许的动作（契约 §16）。
            : view.failure === 'contract'
              ? <StateView state="error" reasonCode="unreadable" size="md"
                  productReason={{ key: 'mi.crossAsset.contractMismatch', resolve: () => text.contractMismatch }}
                  action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: () => void view.refresh() }} />
              : <StateView state="error" reasonCode="unreadable" size="md"
                  action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: () => void view.refresh() }} />}
      </div>
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
