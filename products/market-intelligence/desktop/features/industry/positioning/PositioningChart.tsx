import { useRef, useState } from 'react'

import { Tooltip } from '@platform/ui/components/tooltip'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { DashboardFundingRateHistoryState } from '../../../pages/intelligence/dashboardFundingRateHistoryModel'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import {
  dashboardPositioningPresentationPolicy,
  formatDashboardChange,
  formatDashboardNotional,
  type DashboardPositioningPoint,
  type DashboardPositioningViewState
} from '../../../pages/intelligence/dashboardOpenInterestModel'
import { axisTicks } from './positioningAxisTicks'
import { MARKER_CHIP, POSITIONING_CHART_VIEW, type LiquidationMarkLayout } from './positioningLiquidationMarkers'

import type { PositioningPanelText } from './positioningText'

/** 几何归 `positioningLiquidationMarkers`：牌带两排、车道与基线都从那张表取，避免两处各改各的。 */
const VIEW = POSITIONING_CHART_VIEW

/**
 * 没有可画的读数时的图框：保留两条车道标签与两条基准线（上车道底线、费率零线）。
 *
 * 高度与真图同一个 `VIEW`——空态与有数据态用同一张图的尺寸，读者不会觉得换了一张卡；
 * 不画刻度：刻度必须是真实时刻，骨架不编数据。状态句由调用点放在这张图上方的那一行。
 */
export function PositioningChartSkeleton({ text }: Readonly<{ text: PositioningPanelText }>): React.ReactElement {
  return (
    <div className="mi-positioning-panel__chart" data-chart-skeleton="true">
      <svg viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} aria-hidden="true" focusable="false">
        <text x="0" y={VIEW.upperTop - 8} className="mi-positioning-panel__lane">{text.notional}</text>
        <text x="0" y={VIEW.upperBottom + 18} className="mi-positioning-panel__lane">{text.rateLabel}</text>
        <line x1={VIEW.left} x2={VIEW.right} y1={VIEW.upperBottom + 6} y2={VIEW.upperBottom + 6} className="mi-positioning-panel__rule" />
        <line x1={VIEW.left} x2={VIEW.right} y1={VIEW.zero} y2={VIEW.zero} className="mi-positioning-panel__zero" />
      </svg>
    </div>
  )
}

export function PositioningChart({ positioning, funding, text, marks }: Readonly<{
  positioning: Extract<DashboardPositioningViewState, { state: 'available' }>
  funding: DashboardFundingRateHistoryState
  text: PositioningPanelText
  /**
   * 牌与竖线的排布由调用点算一次（面板还要拿 `hidden` 去补那句截断数）：这里只画，
   * 免得同一件事在卡里各算一套、数字对不上。
   */
  marks: LiquidationMarkLayout
}>): React.ReactElement {
  const ref = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<Readonly<{ index: number; left: number; top: number; width: number; height: number }> | undefined>(undefined)
  const formatTime = useShellTimeFormat()
  const resolveProductKey = useProductTextKey()

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
  // One readable leg is still a readable leg: draw the points that came back, the card names the
  // other one as unknown. Both missing never reaches this component (the model says unavailable).
  const fundingLegs = funding.state === 'available'
    ? funding
    : funding.state === 'partial' ? { btc: funding.btc ?? [], eth: funding.eth ?? [] } : undefined
  const fundingPoints = fundingLegs
    ? [...fundingLegs.btc.map(point => ({ ...point, asset: 'btc' as const })), ...fundingLegs.eth.map(point => ({ ...point, asset: 'eth' as const }))]
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
          // One label above its line, one below: the two ends are often a few units apart, and
          // both above collided exactly when the reader most wants to compare them.
          const flip = cx > VIEW.right - 64
          const dy = asset === 'btc' ? -8 : 12
          return (
            <text key={asset} data-line-end={asset} data-series={asset}
              className="mi-positioning-panel__end"
              x={flip ? cx - 4 : cx + 4}
              y={Math.max(VIEW.upperTop + 12, Math.min(cy + dy, VIEW.upperBottom + 4))}
              textAnchor={flip ? 'end' : 'start'}>{formatDashboardNotional(last.notionalUsd)}</text>
          )
        })}
        {/* 一枚牌一组：线、点、牌在同一个组里，悬停/聚焦/点哪个都出同一份浮层。
            牌只说自己那个市场那个方向，颜色也由它定（`data-hint-direction` → `currentColor`）。
            **不存在只画线的命中**——每条线都在某个带牌的组里；两排都放不下的命中连牌带线一起不画，
            数量由面板那句「图上还有 N 次」统一记账。 */}
        {marks.chips.map(chip => (
          <Tooltip key={chip.key} dataText={chip.summary} resolveText={resolveProductKey}>
            <g className="mi-positioning-panel__hint" data-hint={chip.asset} data-hint-direction={chip.direction}
              data-hint-count={chip.marks.length} tabIndex={0} aria-label={chip.summary}>
              {chip.marks.map(mark => (
                <g key={mark.key}>
                  <line x1={mark.x} x2={mark.x} y1={VIEW.markerRow} y2={VIEW.height - 10} />
                  <circle cx={mark.x} cy={upperY(mark.notionalUsd, mark.asset === 'btc' ? btcScale : ethScale)} r="3" />
                </g>
              ))}
              <g className="mi-positioning-panel__hint-chip">
                <rect x={chip.left} y={chip.top} width={chip.width}
                  height={chip.height} rx={MARKER_CHIP.radius} />
                {/* 一行字，牌心压在自己那条线上；颜色与牌框、竖线同一个 `currentColor`。 */}
                <text x={chip.left + chip.width / 2} y={chip.top + MARKER_CHIP.baseline}
                  textAnchor="middle">{chip.text}</text>
              </g>
            </g>
          </Tooltip>
        ))}
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
                <em>{text.oiShort}</em> {notional === undefined ? text.missingValue : formatDashboardNotional(notional)}
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
