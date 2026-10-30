import { useRef, useState } from 'react'

import { LoadingState } from '@platform/ui/components/loading'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { OpenInterestWindow } from '../../../../contracts/openInterestHistory'
import type { PositioningState } from '../../../../contracts/openInterestPositioning'
import type { DashboardFundingRateHistoryState } from '../../../pages/intelligence/dashboardFundingRateHistoryModel'
import {
  dashboardPositioningPresentationPolicy,
  formatDashboardChange,
  formatDashboardNotional,
  positioningStateFor,
  type DashboardPositioningPoint,
  type DashboardPositioningViewState
} from '../../../pages/intelligence/dashboardOpenInterestModel'

import './PositioningPanel.css'

type Rate = Readonly<{ observedAt: string; ratePercent: number; paymentDirection: 'long-pays-short' | 'short-pays-long' | 'neutral' }>

type Text = Readonly<{
  pairTitle: string
  loading: string
  empty: string
  unavailable: string
  observedAt: string
  stale: string
  notional: string
  rateLabel: string
  oiShort: string
  rateShort: string
  settledAt: string
  legendLine: string
  legendBar: string
  assets: Readonly<Record<'btc' | 'eth', string>>
  paymentDirections: Readonly<Record<'long-pays-short' | 'short-pays-long' | 'neutral', string>>
  change1h: string
  change24h: string
  window7d: string
  window24h: string
  states: Readonly<Record<PositioningState, string>>
  stateWhy: string
  liquidationMore: string
  liquidationChip: string
  helpLabel: string
  helpLines: readonly string[]
  liquidationUnavailable: string
  noRate: string
}>

export type PositioningPanelProps = Readonly<{
  funding: DashboardFundingRateHistoryState
  positioning: DashboardPositioningViewState
  window: OpenInterestWindow
  onWindowChange: (window: OpenInterestWindow) => void
  text: Text
}>

// A strip above the plot belongs to the liquidation marks: a label drawn over the curves hid the
// very movement it was pointing at.
const VIEW = Object.freeze({ width: 800, height: 214, left: 40, right: 782, markerTop: 3, markerRow: 16, upperTop: 30, upperBottom: 112, zero: 166 })

export function PositioningPanel({ funding, positioning, window, onWindowChange, text }: PositioningPanelProps): React.ReactElement {
  const formatTime = useShellTimeFormat()
  const header = (extra?: React.ReactNode) => (
    <header className="mi-positioning-panel__head">
      <h2>{text.pairTitle}</h2>
      <span className="mi-positioning-panel__help" tabIndex={0} role="note" aria-label={text.helpLabel} data-help>
        <i aria-hidden="true">?</i>
        <span className="mi-positioning-panel__help-pop" role="tooltip">
          {text.helpLines.map(line => <b key={line}>{line}</b>)}
        </span>
      </span>
      {extra}
      <WindowTabs window={window} onWindowChange={onWindowChange} text={text} />
    </header>
  )

  const btcRate = funding.state === 'available' ? funding.btc : []
  const ethRate = funding.state === 'available' ? funding.eth : []
  const available = positioning.state === 'available'
  const latest = available ? positioning.btc.at(-1)?.observedAt ?? positioning.eth.at(-1)?.observedAt : undefined
  const status = (positioning.state === 'loading' || funding.state === 'loading')
    ? <LoadingState label={text.loading} minHeight={140} />
    : <p className="mi-positioning-panel__status">{positioning.state === 'empty' ? text.empty : text.unavailable}</p>

  return (
    <section className="mi-positioning-panel" data-state={positioning.state} data-funding-state={funding.state} data-window={window}
      data-stale={available && positioning.staleSince ? 'true' : undefined}>
      {header(
        <>
          {latest
            ? <small className="mi-positioning-panel__asof">{text.observedAt} {formatTime(latest)}{available && positioning.staleSince ? ` · ${text.stale}` : ''}</small>
            : null}
        </>
      )}
      <div className="mi-positioning-panel__body">
        <div className="mi-positioning-panel__summary">
          <Asset asset="btc" text={text} rate={btcRate.at(-1)} rateAgo={btcRate.at(-4)} change={available ? positioning.changeBtc : undefined}
            notional={available ? positioning.btc.at(-1) : undefined} state={available ? positioningStateFor(positioning, btcRate, positioning.changeBtc) : undefined} />
          <Asset asset="eth" text={text} rate={ethRate.at(-1)} rateAgo={ethRate.at(-4)} change={available ? positioning.changeEth : undefined}
            notional={available ? positioning.eth.at(-1) : undefined} state={available ? positioningStateFor(positioning, ethRate, positioning.changeEth) : undefined} />
        </div>
        <div className="mi-positioning-panel__chart-wrap">
          {available
            ? <>
                <PositioningChart positioning={positioning} funding={funding} text={text} />
                {positioning.hintsState === 'available' && !positioning.hintsTruncated ? null : (
                  <p className="mi-positioning-panel__foot" data-hints-state={positioning.hintsState}>
                    {positioning.hintsState === 'unavailable' ? text.liquidationUnavailable : text.liquidationMore}
                  </p>
                )}
              </>
            : status}
        </div>
      </div>
    </section>
  )
}

function WindowTabs({ window, onWindowChange, text }: Readonly<{ window: OpenInterestWindow; onWindowChange: (window: OpenInterestWindow) => void; text: Text }>): React.ReactElement {
  return (
    <span className="mi-positioning-panel__tabs">
      {(['7d', '24h'] as const).map(option => (
        <button key={option} type="button" aria-pressed={window === option} data-window={option}
          onClick={() => onWindowChange(option)}>{option === '7d' ? text.window7d : text.window24h}</button>
      ))}
    </span>
  )
}

/**
 * One asset as a small reading card: who it is and what state it is in, what the rate costs,
 * how big the position is, and how it moved over the two windows the analysis uses.
 *
 * The colour at the left edge is the asset's line colour in the chart, which is what ties a
 * column of numbers to a curve three hundred pixels to its right. The state sits beside the
 * name rather than under the numbers: it answers "what am I looking at" before the reader has
 * read a single figure.
 */
function Asset({ asset, text, rate, rateAgo, change, notional, state }: Readonly<{
  asset: 'btc' | 'eth'
  text: Text
  rate?: Rate
  rateAgo?: Rate
  change?: Readonly<{ h1Pct?: number; h24Pct?: number }>
  notional?: DashboardPositioningPoint
  state: PositioningState | undefined
}>): React.ReactElement {
  return (
    <div className="mi-positioning-panel__asset" data-asset={asset} data-funding-latest={asset}>
      <div className="mi-positioning-panel__asset-head">
        <span className="mi-positioning-panel__name">{text.assets[asset]}</span>
        {state ? (
          // The label alone is a conclusion. Hovering it shows the two numbers the conclusion was
          // drawn from, which is what makes it checkable rather than another opaque badge.
          <span className="mi-positioning-panel__state" data-state={state} tabIndex={0}>
            {text.states[state]}
            <span className="mi-positioning-panel__state-tip" role="tooltip">
              {text.stateWhy
                .replace('{change}', formatDashboardChange(change?.h24Pct))
                .replace('{now}', rate ? formatRate(rate.ratePercent) : '—')
                .replace('{ago}', rateAgo ? formatRate(rateAgo.ratePercent) : '—')}
            </span>
          </span>
        ) : null}
      </div>
      <div className="mi-positioning-panel__quote">
        {rate
          ? <>
              <span className="mi-positioning-panel__rate" data-direction={rate.paymentDirection}>{formatRate(rate.ratePercent)}</span>
              <span className="mi-positioning-panel__pay">{text.paymentDirections[rate.paymentDirection]}</span>
            </>
          : <span className="mi-positioning-panel__rate">—</span>}
      </div>
      <div className="mi-positioning-panel__row" data-layout="level">
        <span className="mi-positioning-panel__label">{text.notional}</span>
        <b className="mi-positioning-panel__value">{notional ? formatDashboardNotional(notional.notionalUsd) : '—'}</b>
      </div>
      <div className="mi-positioning-panel__row" data-layout="pair">
        <span className="mi-positioning-panel__pair">
          <i className="mi-positioning-panel__label">{text.change1h}</i>
          <b className="mi-positioning-panel__value">{formatDashboardChange(change?.h1Pct)}</b>
        </span>
        <span className="mi-positioning-panel__pair">
          <i className="mi-positioning-panel__label">{text.change24h}</i>
          <b className="mi-positioning-panel__value">{formatDashboardChange(change?.h24Pct)}</b>
        </span>
      </div>
    </div>
  )
}

function PositioningChart({ positioning, funding, text }: Readonly<{
  positioning: Extract<DashboardPositioningViewState, { state: 'available' }>
  funding: DashboardFundingRateHistoryState
  text: Text
}>): React.ReactElement {
  const ref = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<Readonly<{ index: number; left: number; top: number; width: number; height: number }> | undefined>(undefined)
  const formatTime = useShellTimeFormat()

  const rows = positioning.btc.length >= positioning.eth.length ? positioning.btc : positioning.eth
  const count = rows.length
  const startMs = count > 0 ? Date.parse(rows[0]!.observedAt) : 0
  const endMs = count > 0 ? Date.parse(rows.at(-1)!.observedAt) : 0
  const span = Math.max(1, endMs - startMs)
  const x = (ms: number) => VIEW.left + ((ms - startMs) / span) * (VIEW.right - VIEW.left)
  const xAt = (index: number) => count <= 1 ? VIEW.left : VIEW.left + (index / (count - 1)) * (VIEW.right - VIEW.left)

  const upperY = (value: number, points: readonly DashboardPositioningPoint[]) => {
    const values = points.length ? points.map(point => point.notionalUsd) : [0, 1]
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = Math.max(max - min, dashboardPositioningPresentationPolicy.chart.minimumNotionalSpan)
    return VIEW.upperBottom - ((value - min) / range) * (VIEW.upperBottom - VIEW.upperTop)
  }

  const periodMs = 8 * 3_600_000
  const fundingPoints = funding.state === 'available'
    ? [...funding.btc.map(point => ({ ...point, asset: 'btc' as const })), ...funding.eth.map(point => ({ ...point, asset: 'eth' as const }))]
        .filter(point => Date.parse(point.observedAt) >= startMs - periodMs && Date.parse(point.observedAt) <= endMs)
    : []
  // One slot per funding period, not per timestamp: the two symbols settle a few seconds apart,
  // so placing a bar at each raw instant drew three and four bars inside one 8-hour band and let
  // the two assets paint over each other. The bar belongs to the period that charged it.
  // Snap to the nearest 8-hour boundary, not the one before it: the two symbols settle a few
  // seconds apart, and flooring sent 15:59:58 and 16:00:03 into different periods — two slots a
  // pixel apart, four bars in one spot, one of them nominally a day later.
  const slots = new Map<number, { btc?: number; eth?: number }>()
  for (const point of fundingPoints) {
    const settlesAt = Math.round(Date.parse(point.observedAt) / periodMs) * periodMs
    const slot = slots.get(settlesAt) ?? {}
    slot[point.asset] = point.ratePercent
    slots.set(settlesAt, slot)
  }
  const maximumRate = Math.max(...[...slots.values()].flatMap(slot => [slot.btc, slot.eth]).map(value => Math.abs(value ?? 0)), 0.001)
  const barCentre = Math.min(30, VIEW.zero - VIEW.upperBottom - 12)
  const rateY = (value: number) => VIEW.zero - (value / maximumRate) * barCentre
  const band = Math.max(2, (8 * 3_600_000 / span) * (VIEW.right - VIEW.left))
  // Two bars share one 8-hour band, one per asset. Drawn on the same centre they painted over
  // each other and the amber under the translucent purple read as a third colour, which is why
  // the lower lane looked pink instead of showing two series.
  const barWidth = Math.max(1.6, Math.min(band * 0.36, 8))
  const barGap = Math.max(0.8, barWidth * 0.18)
  const groupWidth = barWidth * 2 + barGap
  /**
   * The pair moves together and is clamped as a unit. Clamping each bar on its own pushed both
   * of them to `right - barWidth` for the newest period — a slot whose instant sits on the axis
   * edge — and the two painted over each other again, which is the merge this replaces.
   */
  const groupLeft = (centre: number) => Math.min(Math.max(centre - groupWidth / 2, VIEW.left), VIEW.right - groupWidth)
  const barX = (centre: number, asset: 'btc' | 'eth') => groupLeft(centre) + (asset === 'btc' ? 0 : barWidth + barGap)

  const hovered = hover === undefined ? undefined : rows[hover.index]
  // The rate that applies at the pointed instant: the period it falls in, not "the last point
  // before it" — with the two symbols settling seconds apart that lookup returned whichever
  // symbol happened to be stored first.
  const hoveredSlot = hovered === undefined
    ? undefined
    : slots.get(Math.floor(Date.parse(hovered.observedAt) / periodMs) * periodMs + periodMs)

  const pick = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || count === 0) return
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    const scaled = ((ratio * VIEW.width) - VIEW.left) / (VIEW.right - VIEW.left)
    setHover({
      index: Math.round(Math.min(1, Math.max(0, scaled)) * (count - 1)),
      // The tooltip follows the pointer: pinned to a corner it hid whichever half of the chart
      // the reader was not pointing at.
      left: event.clientX - rect.left,
      top: event.clientY - rect.top,
      width: rect.width,
      height: rect.height
    })
  }

  return (
    <div className="mi-positioning-panel__chart">
      <svg ref={ref} viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} role="img" aria-label={text.pairTitle}
        onMouseMove={pick} onMouseLeave={() => setHover(undefined)}>
        <text x="0" y={VIEW.upperTop - 8} className="mi-positioning-panel__lane">{text.notional}</text>
        <text x="0" y={VIEW.upperBottom + 18} className="mi-positioning-panel__lane">{text.rateLabel}</text>
        <line x1={VIEW.left} x2={VIEW.right} y1={VIEW.upperBottom + 6} y2={VIEW.upperBottom + 6} className="mi-positioning-panel__rule" />
        <path d={linePath(positioning.btc, x, point => upperY(point.notionalUsd, positioning.btc))} className="mi-positioning-panel__line" data-series="btc" />
        <path d={linePath(positioning.eth, x, point => upperY(point.notionalUsd, positioning.eth))} className="mi-positioning-panel__line" data-series="eth" />
        <line x1={VIEW.left} x2={VIEW.right} y1={VIEW.zero} y2={VIEW.zero} className="mi-positioning-panel__zero" />
        {[...slots.entries()].map(([settlesAt, slot]) => (['btc', 'eth'] as const).map(asset => {
          const rate = slot[asset]
          if (rate === undefined) return null
          const y = rateY(rate)
          return <rect key={`${asset}-${settlesAt}`} data-series={asset} data-settles-at={new Date(settlesAt).toISOString()}
            className="mi-positioning-panel__bar"
            x={barX(x(settlesAt), asset)} y={Math.min(y, VIEW.zero)}
            width={barWidth} height={Math.max(Math.abs(VIEW.zero - y), 0.8)} rx="1" />
        }))}
        {positioning.hints.map((hint, index) => {
          // Pinned to the bucket's own value. The hourly line takes the hour's last reading, so a
          // dip that recovered inside that hour is invisible on the line — without this dot the
          // mark would sit beside a flat stretch with nothing to explain it.
          const cx = x(Date.parse(hint.observedAt))
          const cy = upperY(hint.notionalUsd, positioning[hint.asset])
          // Each mark says who and how much, on its own line: a header badge could only name the
          // newest one, and the instant is already readable from where the line sits.
          const crowded = index > 0 && cx - x(Date.parse(positioning.hints[index - 1]!.observedAt)) < 58
          // The chip says what it is, not only who: a bare "ETH −1.9%" floating over a chart reads
          // as an unexplained number, and the reader had to guess it was the liquidation mark.
          const label = text.liquidationChip
            .replace('{asset}', text.assets[hint.asset])
            .replace('{pct}', formatDashboardChange(hint.dropPct))
          // The chip lives in the strip above the plot, never on top of it; only the rule and the
          // dot enter the chart. Nearby marks take the second row of the strip.
          const chipWidth = chipWidthFor(label)
          const chipY = VIEW.markerTop + (crowded ? VIEW.markerRow : 0)
          const chipX = Math.min(Math.max(cx - chipWidth / 2, VIEW.left), VIEW.right - chipWidth)
          return (
            <g key={`${hint.asset}-${hint.observedAt}`} data-hint={hint.asset} className="mi-positioning-panel__hint">
              <line x1={cx} x2={cx} y1={chipY + 13} y2={VIEW.height - 10} />
              <circle cx={cx} cy={cy} r="3" />
              <rect className="mi-positioning-panel__hint-chip" x={chipX} y={chipY} width={chipWidth} height={14} rx="3" />
              <text x={chipX + chipWidth / 2} y={chipY + 10.5} textAnchor="middle">{label}</text>
            </g>
          )
        })}
        {hovered && hover ? <line className="mi-positioning-panel__crosshair" x1={xAt(hover.index)} x2={xAt(hover.index)} y1={VIEW.upperTop} y2={VIEW.height - 10} /> : null}
        <text x={VIEW.left} y={VIEW.height - 1} className="mi-positioning-panel__tick">{count > 0 ? formatTime(rows[0]!.observedAt) : ''}</text>
        <text x={VIEW.right} y={VIEW.height - 1} textAnchor="end" className="mi-positioning-panel__tick">{count > 0 ? formatTime(rows.at(-1)!.observedAt) : ''}</text>
      </svg>
      {hovered && hover ? (
        <div className="mi-positioning-panel__tooltip" style={tooltipStyle(hover)}>
          <strong>{formatTime(hovered.observedAt)}</strong>
          {(['btc', 'eth'] as const).map(asset => {
            const notional = positioning[asset][hover!.index]?.notionalUsd
            const rate = hoveredSlot?.[asset]
            return (
              <span key={asset} data-series={asset}>
                <b>{text.assets[asset]}</b>
                <em>{text.oiShort}</em> {notional === undefined ? '—' : formatDashboardNotional(notional)}
                <em>{text.rateShort}</em> {rate === undefined ? text.noRate : formatRate(rate)}
              </span>
            )
          })}
          {hoveredSlot
            ? <small>{text.settledAt} {formatTime(new Date(Math.round(Date.parse(hovered.observedAt) / periodMs) * periodMs).toISOString())}</small>
            : null}
        </div>
      ) : null}
    </div>
  )
}

function linePath(points: readonly DashboardPositioningPoint[], x: (ms: number) => number, y: (point: DashboardPositioningPoint) => number): string {
  return points.map((point, index) => `${index ? 'L' : 'M'}${x(Date.parse(point.observedAt)).toFixed(1)} ${y(point).toFixed(1)}`).join(' ')
}

function formatRate(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(4)}%`
}

const TOOLTIP = Object.freeze({ width: 214, height: 76, offset: 14, inset: 4 })

/**
 * Places the tooltip beside the pointer and flips it to the other side when the preferred side
 * would leave the chart, so the reading never sits on top of what it is describing.
 */
function tooltipStyle(hover: Readonly<{ left: number; top: number; width: number; height: number }>): Readonly<{ left: number; top: number }> {
  const { width, height, offset, inset } = TOOLTIP
  const fitsRight = hover.left + offset + width <= hover.width - inset
  const left = fitsRight ? hover.left + offset : Math.max(inset, hover.left - offset - width)
  const top = Math.min(Math.max(inset, hover.top - height / 2), Math.max(inset, hover.height - height - inset))
  return { left, top }
}

/** Rough advance widths: a CJK glyph is about 9px at 8.5px, latin about 5.2px. */
function chipWidthFor(label: string): number {
  let width = 0
  for (const character of label) width += /[\u3000-\u9fff]/.test(character) ? 9 : 5.2
  return Math.round(width + 12)
}
