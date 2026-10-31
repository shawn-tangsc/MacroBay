import { useRef, useState } from 'react'

import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { DashboardFundingRateHistoryState } from '../../../pages/intelligence/dashboardFundingRateHistoryModel'
import {
  dashboardPositioningPresentationPolicy,
  formatDashboardChange,
  formatDashboardNotional,
  type DashboardPositioningPoint,
  type DashboardPositioningViewState
} from '../../../pages/intelligence/dashboardOpenInterestModel'

import type { PositioningPanelText } from './positioningText'

const VIEW = Object.freeze({ width: 1000, height: 186, left: 32, right: 992, markerTop: 3, markerRow: 16, upperTop: 26, upperBottom: 92, zero: 142 })

export function PositioningChart({ positioning, funding, text }: Readonly<{
  positioning: Extract<DashboardPositioningViewState, { state: 'available' }>
  funding: DashboardFundingRateHistoryState
  text: PositioningPanelText
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

  // Each asset is scaled to its own range: BTC is three times ETH, and one shared axis would flatten
  // the smaller line. Computed once — the per-point version rescanned 168 values for every point.
  const scaleOf = (points: readonly DashboardPositioningPoint[]) => {
    const values = points.length ? points.map(point => point.notionalUsd) : [0, 1]
    const min = Math.min(...values)
    const max = Math.max(...values)
    return { min, range: Math.max(max - min, dashboardPositioningPresentationPolicy.chart.minimumNotionalSpan) }
  }
  const btcScale = scaleOf(positioning.btc)
  const ethScale = scaleOf(positioning.eth)
  const upperY = (value: number, scale: Readonly<{ min: number; range: number }>) =>
    VIEW.upperBottom - ((value - scale.min) / scale.range) * (VIEW.upperBottom - VIEW.upperTop)

  const periodMs = 8 * 3_600_000
  const fundingPoints = funding.state === 'available'
    ? [...funding.btc.map(point => ({ ...point, asset: 'btc' as const })), ...funding.eth.map(point => ({ ...point, asset: 'eth' as const }))]
        // A settlement a few seconds after the newest reading still belongs to the last period,
        // so the raw cut is loose and the snapped instant decides what is inside the window.
        .filter(point => Date.parse(point.observedAt) >= startMs - periodMs && Date.parse(point.observedAt) <= endMs + periodMs)
    : []
  // One slot per funding period, keyed by the boundary it is nearest to. A per-timestamp bar drew
  // four inside one band (the two symbols settle seconds apart, and flooring split them across the
  // boundary), and the pairs painted over each other.
  const slots = new Map<number, { btc?: number; eth?: number }>()
  for (const point of fundingPoints) {
    const settlesAt = Math.round(Date.parse(point.observedAt) / periodMs) * periodMs
    // A period outside the window has no position on this axis; clamping it to an edge stacked
    // several of them on one x, which is what looked like merged bars.
    if (settlesAt < startMs || settlesAt > endMs) continue
    const slot = slots.get(settlesAt) ?? {}
    slot[point.asset] = point.ratePercent
    slots.set(settlesAt, slot)
  }
  const maximumRate = Math.max(...[...slots.values()].flatMap(slot => [slot.btc, slot.eth]).map(value => Math.abs(value ?? 0)), 0.001)
  const barCentre = Math.min(30, VIEW.zero - VIEW.upperBottom - 10)
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
        <path d={linePath(positioning.btc, x, point => upperY(point.notionalUsd, btcScale))} className="mi-positioning-panel__line" data-series="btc" />
        <path d={linePath(positioning.eth, x, point => upperY(point.notionalUsd, ethScale))} className="mi-positioning-panel__line" data-series="eth" />
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
        {/* Each line ends with its own number. The two lines are scaled to their own ranges, so
            the heights are not comparable — the labels are what tie a point on the curve back to
            the notional in the summary column. */}
        {(['btc', 'eth'] as const).map(asset => {
          const last = positioning[asset].at(-1)
          if (!last) return null
          const cx = x(Date.parse(last.observedAt))
          const cy = upperY(last.notionalUsd, asset === 'btc' ? btcScale : ethScale)
          const flip = cx > VIEW.right - 64
          return (
            <text key={asset} data-line-end={asset} data-series={asset}
              className="mi-positioning-panel__end"
              x={flip ? cx - 4 : cx + 4}
              y={Math.max(VIEW.upperTop + 12, Math.min(cy - 6, VIEW.upperBottom - 2))}
              textAnchor={flip ? 'end' : 'start'}>{formatDashboardNotional(last.notionalUsd)}</text>
          )
        })}
        {positioning.hints.map((hint, index) => {
          // Pinned to the bucket's own value. The hourly line takes the hour's last reading, so a
          // dip that recovered inside that hour is invisible on the line — without this dot the
          // mark would sit beside a flat stretch with nothing to explain it.
          const cx = x(Date.parse(hint.observedAt))
          const cy = upperY(hint.notionalUsd, hint.asset === 'btc' ? btcScale : ethScale)
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
        {axisTicks(startMs, span, count).map(tick => (
          <text key={tick.at} x={x(tick.at)} y={VIEW.height - 1}
            textAnchor={tick.first ? 'start' : tick.last ? 'end' : 'middle'}
            className="mi-positioning-panel__tick">{formatTime(new Date(tick.at).toISOString())}</text>
        ))}
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

export function formatRate(value: number): string {
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

/**
 * Five evenly spaced instants across the window, snapped to the hour so the labels read as
 * round times. The card is full width now, and two labels at the ends left most of the axis
 * unreadable — a reader could not tell where in the week a dip happened.
 */
function axisTicks(startMs: number, span: number, count: number): readonly Readonly<{ at: number; first: boolean; last: boolean }>[] {
  if (count < 2 || span <= 0) return []
  const steps = 4
  return Array.from({ length: steps + 1 }, (_, index) => {
    const raw = startMs + (span * index) / steps
    const at = index === 0 ? startMs : index === steps ? startMs + span : Math.round(raw / 3_600_000) * 3_600_000
    return { at, first: index === 0, last: index === steps }
  })
}
