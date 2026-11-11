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

import type { PositioningPanelText } from './positioningText'

const VIEW = Object.freeze({ width: 1000, height: 186, left: 32, right: 992, markerTop: 3, markerRow: 16, upperTop: 26, upperBottom: 92, zero: 142 })
/** 标记牌：13 高、贴图上方那条带里，下缘正好是 `markerRow`——竖线从牌子底下开始，不穿牌。 */
const MARKER_CHIP = Object.freeze({ height: 13, baseline: 12, radius: 4, gap: 6 })

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

export function PositioningChart({ positioning, funding, text }: Readonly<{
  positioning: Extract<DashboardPositioningViewState, { state: 'available' }>
  funding: DashboardFundingRateHistoryState
  text: PositioningPanelText
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

  // 点上画**当前窗口内的全部命中**（账本），每格一个：点与牌子同源、与通知不同源。
  // 7 天视图就画 7 天内所有命中，不再固定只画「现在那一条」——那条只在 24 小时视图下才等于全部。
  const marks = positioning.hints
    .map(hint => {
      const markMs = Date.parse(hint.observedAt)
      if (!(markMs >= startMs && markMs <= endMs)) return undefined
      return {
        key: `${hint.asset}-${hint.observedAt}`,
        asset: hint.asset,
        direction: hint.direction,
        x: x(markMs),
        y: upperY(hint.notionalUsd, hint.asset === 'btc' ? btcScale : ethScale),
        pct: formatDashboardChange(hint.pricePct ?? hint.dropPct),
        volumeMultiple: hint.volumeMultiple
      }
    })
    .filter((entry): entry is {
      key: string; asset: 'btc' | 'eth'; direction: 'long' | 'short'; x: number; y: number; pct: string; volumeMultiple: number
    } => entry !== undefined)
    .sort((left, right) => left.x - right.x)

  type Mark = (typeof marks)[number]
  type Cluster = Readonly<{
    key: string
    marks: readonly Mark[]
    asset: 'btc' | 'eth'
    direction: 'long' | 'short' | 'mixed'
    label: string
    summary: string
    left: number
    width: number
  }>

  /** 簇的话：一条说方向 + 价格变化；同向 ≥2 说 ×N；混向不写方向。 */
  const clusterLabel = (cluster: readonly Mark[]): string => {
    if (cluster.length === 1) {
      const only = cluster[0]!
      return (only.direction === 'long' ? text.markLong : text.markShort).replace('{pct}', only.pct)
    }
    const sameDirection = cluster.every(mark => mark.direction === cluster[0]!.direction)
    if (sameDirection) {
      const template = cluster[0]!.direction === 'long' ? text.markLongMany : text.markShortMany
      return template.replace('{count}', String(cluster.length))
    }
    return text.markMixedMany.replace('{count}', String(cluster.length))
  }

  const directionOf = (cluster: readonly Mark[]): 'long' | 'short' | 'mixed' =>
    cluster.every(mark => mark.direction === cluster[0]!.direction) ? cluster[0]!.direction : 'mixed'

  /**
   * 从左到右贪心成簇（界面 2026-11-08）：取最左未分配者起一簇，牌以线居中、到边内收贴边；
   * 若牌与上一张右缘不足 `MARKER_CHIP.gap`，就把下一条并进来重算文字再试——放得下就收簇。
   * 线不动：并簇只改**文字与牌位**，每条命中仍留自己那根竖线。
   */
  const clusters: Cluster[] = []
  let cursor = 0
  while (cursor < marks.length) {
    let members: Mark[] = [marks[cursor]!]
    let label = clusterLabel(members)
    let width = chipWidthFor(label)
    const placement = (): number => {
      const center = (members[0]!.x + members.at(-1)!.x) / 2
      return Math.max(VIEW.left, Math.min(center - width / 2, VIEW.right - width))
    }
    let left = placement()
    // 试放下一条：它自己那张牌若与**本簇**的牌右缘不足 6px，就并进来重算，再试下一条。
    // 注意「并进本簇」不是「另起一簇再往左挤」——那会让两枚牌压在一起。
    while (cursor + members.length < marks.length) {
      const next = marks[cursor + members.length]!
      const nextWidth = chipWidthFor(clusterLabel([next]))
      const nextLeft = Math.max(VIEW.left, Math.min(next.x - nextWidth / 2, VIEW.right - nextWidth))
      if (nextLeft >= left + width + MARKER_CHIP.gap) break
      members = [...members, next]
      label = clusterLabel(members)
      width = chipWidthFor(label)
      left = placement()
    }
    const direction = directionOf(members)
    clusters.push({
      key: members.map(mark => mark.key).join('+'),
      marks: members,
      asset: members[0]!.asset,
      direction,
      label,
      // 浮层与牌同一句话，单个再加一句量；成簇时量各不相同，不编一个数出来。
      summary: members.length === 1 ? `${label} · ${members[0]!.volumeMultiple.toFixed(1)}×` : label,
      left,
      width
    })
    cursor += members.length
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
        {/* 一簇一组：线、点、牌在同一个组里，悬停/聚焦/点哪个都出同一份浮层。
            **不存在只画线的命中**——每条线都在某个带牌的簇里。 */}
        {clusters.map(cluster => (
          <Tooltip key={cluster.key} dataText={cluster.summary} resolveText={resolveProductKey}>
            <g className="mi-positioning-panel__hint" data-hint={cluster.asset} data-hint-direction={cluster.direction}
              data-hint-count={cluster.marks.length} tabIndex={0} aria-label={cluster.summary}>
              {cluster.marks.map(mark => (
                <g key={mark.key}>
                  <line x1={mark.x} x2={mark.x} y1={VIEW.markerRow} y2={VIEW.height - 10} />
                  <circle cx={mark.x} cy={mark.y} r="3" />
                </g>
              ))}
              <g className="mi-positioning-panel__hint-chip">
                <rect x={cluster.left} y={VIEW.markerTop} width={cluster.width}
                  height={MARKER_CHIP.height} rx={MARKER_CHIP.radius} />
                <text x={cluster.left + cluster.width / 2} y={VIEW.markerTop + MARKER_CHIP.baseline}
                  textAnchor="middle">{cluster.label}</text>
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

/** Rough advance widths at the 9px chart-label size: a CJK glyph ~9px, latin ~5.2px. */
function chipWidthFor(label: string): number {
  let width = 0
  for (const character of label) width += /[\u3000-\u9fff]/.test(character) ? 9 : 5.2
  return Math.round(width + 12)
}

