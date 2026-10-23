import { useEffect, useState } from 'react'
import { Button, Segmented, Tooltip } from 'antd'
import { Info, RefreshCw } from 'lucide-react'
import type { productText } from '../../../shared/i18n/productText'
import type { createCrossAssetObservationClient } from '../../../shared/ipc/crossAssetObservationClient'
import { crossAssetContractPolicy } from '../../../../contracts/crossAssetObservationContracts'
import type { CrossAssetId, CrossAssetMetric, CrossAssetSnapshot } from '../../../../contracts/crossAssetObservationContracts'
import type { MacroMarketSnapshotView, MacroMarketSnapshotReading } from '../../../../contracts/macro/macroMarketSnapshotContracts'
import { macroMarketSnapshotPublicPolicy } from '../../../../contracts/macro/macroMarketSnapshotContracts'
import type { MacroRatesReading, MacroRatesSnapshotView } from '../../../../contracts/macro/macroRatesSnapshotContracts'
import { macroRatesSnapshotPublicPolicy } from '../../../../contracts/macro/macroRatesSnapshotContracts'
import { useCrossAssetObservation } from './useCrossAssetObservation'
import { crossAssetMacroReading, crossAssetRatesSeriesIds, resolveCrossAssetStatusRows } from './crossAssetStatusRegistry'
import { crossAssetWindowReturns, crossAssetWindows, type CrossAssetWindow } from './crossAssetWindowReturns'
import { CrossAssetReturnChart } from './CrossAssetReturnChart'
import { CrossAssetReadingLine } from './CrossAssetReadingLine'
import { crossAssetSignedValue } from './crossAssetFormat'
import { LiveBadge } from './CrossAssetLiveBadge'
import type { CrossAssetEventLine } from './crossAssetEventLines'
import { useCrossAssetEventLines } from './useCrossAssetEventLines'
import { basisPointsText, crossAssetRatesDailyExtras } from './crossAssetRatesDaily'
import { macroEconomicCalendarClient } from '../../../shared/ipc/macroEconomicCalendarClient'
import { MARKET_ANALYSIS_CONTEXT_CAVEATS } from '../../../../contracts/marketAnalysisContracts'

/**
 * The row's name, read from the instrument that is actually answering it.
 *
 * A row called 「纳斯达克 100」 that prints `QQQUSDT`'s price is a name disagreeing with its own figure —
 * the reader asked "QQQ 呢?" the moment they saw it. So the name follows the source: the licensed cash
 * index is named as the index, and the tokenised perpetual is named `QQQ` and carries the 代理 label
 * beside it. A row with no reading is named after its *default* instrument, which is what it would
 * display, so the name never promises an instrument the row is not showing.
 */
function indexRowName(snapshot: CrossAssetSnapshot | undefined, text: Text): string {
  return snapshot?.indexSource === 'real' ? text.indexNames.real : text.indexNames.proxy
}

/** The provider sends five decimals; the panel shows the two a reader compares prices with. */
function livePriceText(price: string): string {
  const value = Number(price)
  return Number.isFinite(value) ? value.toFixed(2) : price
}
import './CrossAssetObservationPanel.css'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

/** The windows the chart offers, from the contract that defines them: a hand-copied list missed `30d`. */
const crossAssetRanges = crossAssetContractPolicy.ranges
type CrossAssetRange = typeof crossAssetRanges[number]

type Text = typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['crossAsset']
type MacroDriverId = 'dxy' | 'gold' | 'us10y' | 'realRate'
type RowMetrics = Readonly<Record<CrossAssetWindow, CrossAssetMetric>>

function priceOf(snapshot: CrossAssetSnapshot | undefined, asset: CrossAssetId): string {
  const quote = snapshot?.quotes?.[asset]
  return quote && quote.state !== 'missing' && quote.price ? quote.price : '—'
}
function value(metric: CrossAssetMetric | undefined, unit: string, empty: string): string {
  if (!metric || metric.state !== 'available') return empty
  // One formatter for both surfaces that print these figures: the table's cells and the reading line.
  return crossAssetSignedValue(metric.value, unit)
}
/** A stored level is a real number or nothing at all; it is never rounded into existence. */
function levelText(reading: MacroMarketSnapshotReading | undefined): string {
  return reading && Number.isFinite(reading.level) ? reading.level.toFixed(2) : '—'
}
function assetMetrics(snapshot: CrossAssetSnapshot | undefined, asset: CrossAssetId): RowMetrics | undefined {
  return snapshot && crossAssetWindowReturns({ range: snapshot.range, curves: snapshot.curves[asset], closedReturns: snapshot.closedReturns[asset] })
}
/** Windows the series could not answer stay `unavailable`, so the cell prints 无数据 rather than 0. */
function macroMetrics(reading: MacroMarketSnapshotReading | undefined): RowMetrics | undefined {
  if (!reading) return undefined
  const metrics = {} as Record<CrossAssetWindow, CrossAssetMetric>
  for (const window of crossAssetWindows) {
    const percent = reading.returns[window]
    metrics[window] = percent === undefined ? { state: 'unavailable', reason: 'missing' } : { state: 'available', value: percent }
  }
  return Object.freeze(metrics)
}
function WindowCells({ id, metrics, text }: { id: string; metrics?: RowMetrics; text: Text }): React.ReactElement {
  return <>{crossAssetWindows.map(window => {
    const metric = metrics?.[window]
    // A missing window is a dash in the cell and 无数据 on its title: the column stays narrow and the
    // dash cannot be misread as a printed zero.
    const percent = metric && metric.state === 'available' ? value(metric, '%', text.noData) : undefined
    return <td key={window} data-asset-return={`${id}:${window}`}
      data-direction={metric?.state === 'available' ? Math.sign(metric.value) : 0}
      data-unavailable={percent === undefined ? 'true' : undefined}
      title={percent === undefined ? text.noData : undefined}>{percent ?? text.windowNoData}</td>
  })}</>
}
/** No figure and no value cell at all: the row states the gap instead of filling it. */
function PlannedStatusRow({ id, text }: { id: MacroDriverId; text: Text }): React.ReactElement {
  return <tr data-status-row={id} data-connected="false">
    <th scope="row"><span>{text.assetLabels[id]}</span><small>{text.statusReads[id]}</small></th>
    <td colSpan={crossAssetWindows.length + 1} className="mi-cross-asset__not-connected"><span>{text.notConnected}</span><small>{text.notConnectedHint}</small></td>
  </tr>
}
function format(template: string, values: Readonly<Record<string, string>>): string {
  return Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, value), template)
}
/**
 * A daily FRED close. The 最新 cell prints the level at two decimals; the four intraday window
 * columns collapse into one cell that prints the day-over-day change in basis points with the
 * observation date, because a daily close cannot answer a 15m window and must not pretend to.
 *
 * The extras under it answer "which day is this number about?" before they are stated: the term
 * spread only while both legs describe one trading day (a difference between two days describes no
 * day), and the inflation expectation always with its own date, since it is its own series and can be
 * a day ahead — it was on 2026-10-15 (T10YIE 10-14, the yields 10-13).
 */
function RatesStatusRow({ id, reading, rates, text }: {
  id: 'us10y' | 'realRate'; reading: MacroRatesReading
  rates: ReadonlyMap<string, MacroRatesReading>; text: Text
}): React.ReactElement {
  const extras = crossAssetRatesDailyExtras({ id, reading, rates })
  const detail = [
    extras.termSpreadDelta === undefined ? undefined : `${text.termSpread} ${basisPointsText(extras.termSpreadDelta)}${text.bpUnit}`,
    extras.breakeven === undefined ? undefined : format(text.inflationExpectationWithDate, { value: extras.breakeven.value.toFixed(2), date: extras.breakeven.date })
  ].filter(Boolean).join(' · ') || undefined
  const change = reading.previous === undefined
    ? format(text.dailyChangeUnknownWithDate, { date: reading.period })
    : format(text.dailyChangeWithDate, { change: `${basisPointsText(reading.actual - reading.previous)}${text.bpUnit}`, date: reading.period })
  return <tr data-status-row={id} data-connected="true" data-observation-date={reading.period}>
    <th scope="row"><span>{text.assetLabels[id]}</span><small>{text.statusReads[id]}</small></th>
    <td data-asset-price={id}>{reading.actual.toFixed(2)}%</td>
    <td className="mi-cross-asset__daily" colSpan={crossAssetWindows.length} data-asset-daily={id}
      data-direction={reading.previous === undefined ? 0 : Math.sign(reading.actual - reading.previous)}
      data-caveat={macroRatesSnapshotPublicPolicy.caveats.officialDailyClose}
      {...(extras.mixedObservationDates ? { 'data-mixed-observation-dates': MARKET_ANALYSIS_CONTEXT_CAVEATS.macroRatesMixedPeriods } : {})}
      title={[text.dailyFrequency, detail, extras.mixedObservationDates ? text.dailyMixedDates : undefined, text.dailyCaveat].filter(Boolean).join(' · ')}>
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
  return <tr data-status-row={id} data-connected="true">
    <th scope="row"><span>{text.assetLabels[id]}
      {/* The synthetic label rides with the level: a level this product computed is never shown as
          if it were the licensed index, and the caveat sentence is one hover away. */}
      {reading?.synthetic ? <em className="mi-cross-asset__synthetic" data-synthetic={id}
        data-caveat={macroMarketSnapshotPublicPolicy.caveats.syntheticDollarIndex} title={text.syntheticCaveat}>{text.syntheticTag}</em> : null}
      {/* Freshness belongs with the name, beside the synthetic tag, not glued to the figure: a tag
          after the price reads as if it qualified the number itself. */}
      {live ? <LiveBadge state={live.state} tick={live} formatTime={formatTime} text={text} /> : null}
    </span>{text.statusReads[id] ? <small>{text.statusReads[id]}</small> : null}</th>
    <td data-asset-price={id}>{live ? livePriceText(live.price) : levelText(reading)}</td>
    <WindowCells id={id} metrics={macroMetrics(reading)} text={text} />
  </tr>
}
function AssetStatusRow({ id, snapshot, text }: { id: CrossAssetId; snapshot?: CrossAssetSnapshot; text: Text }): React.ReactElement {
  return <tr data-status-row={id} data-connected="true">
    <th scope="row"><span>{text.assets[id]}</span>{text.statusReads[id] ? <small>{text.statusReads[id]}</small> : null}</th>
    <td data-asset-price={id}>{priceOf(snapshot, id)}</td>
    <WindowCells id={id} metrics={assetMetrics(snapshot, id)} text={text} />
  </tr>
}
/**
 * The Nasdaq 100 row, which has two admitted sources and therefore two things to say.
 *
 * The value is always the last bar that actually closed: the real index prints only inside the US
 * cash session, so outside it the last close *is* the current reading, and the row says 休市 beside
 * it. The proxy answers the row only when the real source has nothing at all, and it wears the 代理
 * label whenever it does — a tokenised perpetual is never shown as the standard index. When neither
 * leg has a bar the row says 未接入 and prints no number.
 */
function IndexStatusRow({ snapshot, text, formatTime }: {
  snapshot?: CrossAssetSnapshot; text: Text; formatTime: (value: string, precision: 'second') => string
}): React.ReactElement {
  const source = snapshot?.indexSource ?? 'unavailable'
  // Neither leg has a reading: the row states the gap in one cell, exactly like a macro row whose
  // series is not connected yet. It prints no figure and no window, because there is nothing to
  // compute either from — 未接入 is the honest answer, and it is not a number.
  if (source === 'unavailable') {
    return <tr data-status-row="index" data-connected="false" data-index-source="unavailable" data-market-state="unavailable"
      data-index-name={indexRowName(snapshot, text)}>
      <th scope="row"><span>{indexRowName(snapshot, text)}</span><small>{text.statusReads.index}</small></th>
      <td colSpan={crossAssetWindows.length + 1} className="mi-cross-asset__not-connected"><span>{text.notConnected}</span><small>{text.notConnectedHint}</small></td>
    </tr>
  }
  const proxy = source === 'proxy'
  const quote = snapshot?.quotes?.index
  const lastClosed = snapshot?.lastClosed?.index ?? null
  const marketState = snapshot?.marketState?.index ?? 'open'
  // A live trade belongs to the proxy leg alone; the real index has none, so its newest value is the
  // last bar that closed.
  const live = proxy && quote && quote.state !== 'missing' && quote.price ? quote.price : undefined
  const value = live ?? lastClosed?.close
  return <tr data-status-row="index" data-connected="true" data-index-source={source} data-market-state={marketState}
    data-index-name={indexRowName(snapshot, text)}>
    <th scope="row"><span>{indexRowName(snapshot, text)}
      {proxy ? <em className="mi-cross-asset__synthetic" data-index-proxy="true" data-caveat="tokenized-index-proxy"
        title={text.proxyCaveat}>{text.proxyTag}</em> : null}
      {marketState === 'closed' ? <em className="mi-cross-asset__synthetic" data-market-state-tag="closed"
        title={text.marketClosedHint}>{text.marketClosed}</em> : null}
    </span>{text.statusReads.index ? <small>{text.statusReads.index}</small> : null}</th>
    <td data-asset-price="index" data-last-closed-at={lastClosed?.at}>{value === undefined ? text.notConnected : livePriceText(value)}</td>
    <WindowCells id="index" metrics={assetMetrics(snapshot, 'index')} text={text} />
  </tr>
}
/** The last closed bar of the index row, in the snapshot's own clock. */
function IndexObservation({ snapshot, text, formatTime }: {
  snapshot: CrossAssetSnapshot; text: Text; formatTime: (value: string, precision: 'second') => string
}): React.ReactElement | null {
  const at = snapshot.lastClosed?.index?.at
  return at ? <>{` · ${text.lastClosedBar} `}<time>{formatTime(at, 'second')}</time></> : null
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
  const historyInfo = snapshot ? <>
    <div>{text.analysis} {formatTime(snapshot.analysisEnd, 'second')}</div>
    <div>{text.coverage} {(['index', 'btc', 'eth'] as const).map(asset => `${asset === 'index' ? indexRowName(snapshot, text) : text.assets[asset]} ${snapshot.historyCoverage[asset].count}/${snapshot.historyCoverage[asset].expectedCount}`).join(' · ')}</div>
    <div>{text.correlations} · {text.samples} {snapshot.correlations.indexBtc.sampleCount}/288 · {snapshot.correlations.indexEth.sampleCount}/288</div>
  </> : text.unavailable
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
        <Tooltip title={text.subtitle} trigger={['hover', 'focus', 'click']}><Button type="text" size="small" aria-label={text.subtitle} icon={<Info size={13} />} /></Tooltip></div>
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
        <Tooltip title={historyInfo} trigger={['hover', 'focus', 'click']}><Button type="text" size="small" aria-label={text.analysis} icon={<Info size={13} />} /></Tooltip></div>
        <div className="mi-cross-asset__chart-actions"><Segmented size="small" value={view.range} options={crossAssetRanges.map(range => ({ label: range.toUpperCase(), value: range }))} onChange={range => view.setRange(range as CrossAssetRange)} />
          <Tooltip title={text.refresh}><Button type="text" size="small" aria-label={text.refresh} loading={view.refreshing} icon={<RefreshCw size={13} />} onClick={() => void view.refresh()} /></Tooltip></div></div>
        {snapshot?.sourceState && snapshot.sourceState !== 'live' ? <small data-source-state={snapshot.sourceState}>{text.states[snapshot.sourceState]}</small> : null}
        {snapshot?.quotes ? <div className="mi-cross-asset__status">{(['btc', 'eth'] as const).filter(asset => snapshot.quotes![asset].state !== 'live').map(asset => <small key={asset} data-quote-asset={asset}>{text.assets[asset]} {text.states[snapshot.quotes![asset].state]}</small>)}</div> : null}
        {/* The legend and the tooltip carry the same name the row does: one panel, one instrument name
            per figure, so a legend reading 「纳斯达克 100」 can never sit above `QQQUSDT`'s curve. */}
        {snapshot ? <CrossAssetReturnChart curves={snapshot.curves} macroCurves={snapshot.macroCurves} forming={snapshot.forming}
          events={eventLines.lines} eventsCollapsed={eventLines.collapsed} onSelectEvent={selectEvent}
          text={{ ...text, assets: { ...text.assets, index: indexRowName(snapshot, text) },
            // The macro lines carry the very names the 市场状态 rows beside them carry: one instrument,
            // one name per figure, so the legend and the table can never disagree.
            macroAssets: { dxy: text.assetLabels.dxy, gold: text.assetLabels.gold } }} /> : <p className="mi-cross-asset__empty">{view.state === 'loading' ? text.loading : text.unavailable}</p>}
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
