import { LiveBadge } from './CrossAssetLiveBadge'
import { crossAssetWindows, type CrossAssetWindow } from './crossAssetWindowReturns'
import { crossAssetWindowReturns } from './crossAssetWindowReturns'
import type { CrossAssetId, CrossAssetMetric, CrossAssetSnapshot } from '../../../../contracts/crossAssetObservationContracts'
import { macroMarketSnapshotPublicPolicy } from '../../../../contracts/macro/macroMarketSnapshotContracts'
import type { MacroMarketSnapshotReading } from '../../../../contracts/macro/macroMarketSnapshotContracts'
import type { productText } from '../../../shared/i18n/productText'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import { crossAssetSignedValue } from './crossAssetFormat'
import { crossAssetTextKeys } from './crossAssetTextKeys'

/**
 * 市场状态表里三行行情（纳指 / BTC / ETH）与它们共用的单元格、空行、末次收盘说明。
 *
 * 从 `CrossAssetObservationPanel` 抽出来，只为一件事：那个文件被体积门禁挡在 500 行线上。
 * 抽的是**渲染**，不是新行为——同一个 Props、同一批键、同样的 `data-*` 标记，行为一模一样。
 */
export function indexRowName(snapshot: CrossAssetSnapshot | undefined, text: Text): string {
  return snapshot?.indexSource === 'real' ? text.indexNames.real : text.indexNames.proxy
}

/** The provider sends five decimals; the panel shows the two a reader compares prices with. */
export function livePriceText(price: string): string {
  const value = Number(price)
  return Number.isFinite(value) ? value.toFixed(2) : price
}

export type Text = typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['crossAsset']
export type MacroDriverId = 'dxy' | 'gold' | 'us10y' | 'realRate'
export type RowMetrics = Readonly<Record<CrossAssetWindow, CrossAssetMetric>>
export function priceOf(snapshot: CrossAssetSnapshot | undefined, asset: CrossAssetId): string {
  const quote = snapshot?.quotes?.[asset]
  return quote && quote.state !== 'missing' && quote.price ? quote.price : '—'
}
export function value(metric: CrossAssetMetric | undefined, unit: string, empty: string): string {
  if (!metric || metric.state !== 'available') return empty
  // One formatter for both surfaces that print these figures: the table's cells and the reading line.
  return crossAssetSignedValue(metric.value, unit)
}
/** A stored level is a real number or nothing at all; it is never rounded into existence. */
export function levelText(reading: MacroMarketSnapshotReading | undefined): string {
  return reading && Number.isFinite(reading.level) ? reading.level.toFixed(2) : '—'
}
export function assetMetrics(snapshot: CrossAssetSnapshot | undefined, asset: CrossAssetId): RowMetrics | undefined {
  return snapshot && crossAssetWindowReturns({ range: snapshot.range, curves: snapshot.curves[asset], closedReturns: snapshot.closedReturns[asset] })
}
/** Windows the series could not answer stay `unavailable`, so the cell prints 无数据 rather than 0. */
export function macroMetrics(reading: MacroMarketSnapshotReading | undefined): RowMetrics | undefined {
  if (!reading) return undefined
  const metrics = {} as Record<CrossAssetWindow, CrossAssetMetric>
  for (const window of crossAssetWindows) {
    const percent = reading.returns[window]
    metrics[window] = percent === undefined ? { state: 'unavailable', reason: 'missing' } : { state: 'available', value: percent }
  }
  return Object.freeze(metrics)
}
export function WindowCells({ id, metrics, text }: { id: string; metrics?: RowMetrics; text: Text }): React.ReactElement {
  const resolveText = useProductTextKey()
  return <>{crossAssetWindows.map(window => {
    const metric = metrics?.[window]
    // A missing window is a dash in the cell and 无数据 in a tooltip: the column stays narrow and the
    // dash cannot be misread as a printed zero. The tooltip opens on focus as well as hover, so the
    // same sentence is reachable with the keyboard (a bare `title` reaches only the mouse).
    const percent = metric && metric.state === 'available' ? value(metric, '%', text.noData) : undefined
    const cell = <td key={window} data-asset-return={`${id}:${window}`}
      data-direction={metric?.state === 'available' ? Math.sign(metric.value) : 0}
      data-unavailable={percent === undefined ? 'true' : undefined}
      aria-label={percent === undefined ? text.noData : undefined}>{percent ?? text.windowNoData}</td>
    // 不是真控件就不迁：单元格套 `tabIndex` + 浮层是假控件，说明改挂在可访问名上。
    return cell
  })}</>
}
/** No figure and no value cell at all: the row states the gap instead of filling it. */
export function PlannedStatusRow({ id, text }: { id: MacroDriverId; text: Text }): React.ReactElement {
  return <tr data-status-row={id} data-connected="false">
    <th scope="row"><span>{text.assetLabels[id]}</span><small>{text.statusReads[id]}</small></th>
    <td colSpan={crossAssetWindows.length + 1} className="mi-cross-asset__not-connected"><span>{text.notConnected}</span><small>{text.notConnectedHint}</small></td>
  </tr>
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

export function AssetStatusRow({ id, snapshot, text }: { id: CrossAssetId; snapshot?: CrossAssetSnapshot; text: Text }): React.ReactElement {
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
export function IndexStatusRow({ snapshot, text, formatTime }: {
  snapshot?: CrossAssetSnapshot; text: Text; formatTime: (value: string, precision: 'second') => string
}): React.ReactElement {
  const source = snapshot?.indexSource ?? 'unavailable'
  const resolveText = useProductTextKey()
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
        aria-label={text.proxyCaveat}>{text.proxyTag}</em> : null}
      {marketState === 'closed' ? <em className="mi-cross-asset__synthetic" data-market-state-tag="closed"
        aria-label={text.marketClosedHint}>{text.marketClosed}</em> : null}
    </span>{text.statusReads.index ? <small>{text.statusReads.index}</small> : null}</th>
    <td data-asset-price="index" data-last-closed-at={lastClosed?.at}>{value === undefined ? text.notConnected : livePriceText(value)}</td>
    <WindowCells id="index" metrics={assetMetrics(snapshot, 'index')} text={text} />
  </tr>
}
/** The last closed bar of the index row, in the snapshot's own clock. */
export function IndexObservation({ snapshot, text, formatTime }: {
  snapshot: CrossAssetSnapshot; text: Text; formatTime: (value: string, precision: 'second') => string
}): React.ReactElement | null {
  const at = snapshot.lastClosed?.index?.at
  return at ? <>{` · ${text.lastClosedBar} `}<time>{formatTime(at, 'second')}</time></> : null
}
