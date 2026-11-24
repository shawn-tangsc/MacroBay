import { useEffect, useMemo, useRef, useState } from 'react'

import { Tooltip } from '@platform/ui/components/tooltip'
import { formatShellClock } from '@platform/ui/time/shellTimeFormat'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'

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
import {
  MARKER_CHIP,
  POSITIONING_CHART_FALLBACK,
  layoutLiquidationMarks,
  positioningChartGeometry,
  type LiquidationMarkLayout,
  type PositioningChartGeometry
} from './positioningLiquidationMarkers'
import { placePositioningTooltip } from './positioningTooltip'

import type { PositioningPanelText } from './positioningText'

/**
 * 图按**容器像素**画：量和国债卡、资金流卡同一套（`ResizeObserver` → `clientWidth/Height`），
 * svg 的 `width/height` 就是实测值，字 9px 就是 9px。
 *
 * 旧写法是一块固定 1000×300 的坐标系 + `width:100%; height:auto`，整幅（含字）按列宽等比缩小：
 * 图列 700 时缩放 0.7，牌字只有 6.3px（用户 2026-11-24 报「整体缩小」）。量不到尺寸时
 * （静态渲染、首帧）退回同一比例的兜底坐标系，量到就换成真像素。
 */
function useChartBox(): readonly [React.RefObject<HTMLDivElement | null>, Readonly<{ width: number; height: number }>] {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<Readonly<{ width: number; height: number }>>({ width: 0, height: 0 })
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = (): void => setBox({ width: Math.round(node.clientWidth), height: Math.round(node.clientHeight) })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, box] as const
}

/** 量到就用实测像素，量不到用兜底比例——两条路都是像素坐标，只是数不同。 */
function geometryOf(box: Readonly<{ width: number; height: number }>): PositioningChartGeometry {
  return positioningChartGeometry(
    box.width > 0 ? box.width : POSITIONING_CHART_FALLBACK.width,
    box.height > 0 ? box.height : POSITIONING_CHART_FALLBACK.height
  )
}

/** 量到之前挂一个 viewBox 让首帧也画得出来（量到之后去掉，1 单位 = 1 像素）。 */
function viewBoxOf(box: Readonly<{ width: number; height: number }>, view: PositioningChartGeometry): string | undefined {
  return box.width > 0 && box.height > 0 ? undefined : `0 0 ${view.width} ${view.height}`
}

/**
 * 没有可画的读数时的图框：保留两条车道标签与两条基准线（上车道底线、费率零线）。
 *
 * 尺寸与真图同源（同一个量容器 + 同一份几何），空态与有数据态卡高一致，读者不会觉得换了一张卡；
 * 不画刻度：刻度必须是真实时刻，骨架不编数据。状态句由调用点放在这张图上方的那一行。
 */
export function PositioningChartSkeleton({ text }: Readonly<{ text: PositioningPanelText }>): React.ReactElement {
  const [ref, box] = useChartBox()
  const view = geometryOf(box)
  return (
    <div className="mi-positioning-panel__chart-body" data-chart-skeleton="true" ref={ref}>
      <div className="mi-positioning-panel__chart">
        <svg width={box.width || undefined} height={box.height || undefined} viewBox={viewBoxOf(box, view)}
          aria-hidden="true" focusable="false">
          <text x="0" y={view.upperTop - 8} className="mi-positioning-panel__lane">{text.notional}</text>
          <text x="0" y={view.upperBottom + 18} className="mi-positioning-panel__lane">{text.rateLabel}</text>
          <line x1={view.left} x2={view.right} y1={view.upperBottom + 6} y2={view.upperBottom + 6} className="mi-positioning-panel__rule" />
          <line x1={view.left} x2={view.right} y1={view.zero} y2={view.zero} className="mi-positioning-panel__zero" />
        </svg>
      </div>
    </div>
  )
}

export function PositioningChart({ positioning, funding, text, geometry, marks, box }: Readonly<{
  positioning: Extract<DashboardPositioningViewState, { state: 'available' }>
  funding: DashboardFundingRateHistoryState
  text: PositioningPanelText
  /** 像素坐标系：量到容器就是实测宽高。 */
  geometry: PositioningChartGeometry
  /** 牌与竖线的排布：和几何同源，算一次（`hidden` 要拿去做下面那句截断数）。 */
  marks: LiquidationMarkLayout
  box: Readonly<{ width: number; height: number }>
}>): React.ReactElement {
  const ref = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<Readonly<{ index: number; left: number; top: number; width: number; height: number }> | undefined>(undefined)
  const formatTime = useShellTimeFormat()
  const timeZone = useShellTimeZone()
  /** 轴刻度用紧凑口径：同日 `HH:mm`、跨日 `MM-DD HH:mm`，不带时区——五个刻度各印一遍 `GMT+8` 会互相压字。
      浮层里那一刻仍用完整口径（带时区），轴只回答「几点」。 */
  const formatTick = (instant: string): string => formatShellClock(instant, { timeZone }) ?? formatTime(instant)
  const resolveProductKey = useProductTextKey()

  const rows = positioning.btc.length >= positioning.eth.length ? positioning.btc : positioning.eth
  const count = rows.length
  const startMs = count > 0 ? Date.parse(rows[0]!.observedAt) : 0
  const endMs = count > 0 ? Date.parse(rows.at(-1)!.observedAt) : 0
  const span = Math.max(1, endMs - startMs)
  const x = (ms: number) => geometry.left + ((ms - startMs) / span) * (geometry.right - geometry.left)
  const xAt = (index: number) => count <= 1 ? geometry.left : geometry.left + (index / (count - 1)) * (geometry.right - geometry.left)

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
    geometry.upperBottom - ((value - scale.min) / scale.range) * (geometry.upperBottom - geometry.upperTop)

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
  // 柱子最多占到费率车道的一半多一点（0.6）：车道高度由几何给，柱子跟着车道走，不写死像素。
  const barCentre = Math.max(8, Math.round((geometry.zero - geometry.upperBottom) * 0.6))
  const rateY = (value: number) => geometry.zero - (value / maximumRate) * barCentre
  const band = Math.max(2, (8 * 3_600_000 / span) * (geometry.right - geometry.left))
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
  const groupLeft = (centre: number) => Math.min(Math.max(centre - groupWidth / 2, geometry.left), geometry.right - groupWidth)
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
    const localX = event.clientX - rect.left
    // 像素坐标：指针落在哪一列，直接按绘图区的左右缘比，不再经过 viewBox 比例。
    const ratio = (localX - geometry.left) / (geometry.right - geometry.left)
    setHover({
      index: Math.round(Math.min(1, Math.max(0, ratio)) * (count - 1)),
      // The tooltip follows the pointer: pinned to a corner it hid whichever half of the chart
      // the reader was not pointing at.
      left: localX,
      top: event.clientY - rect.top,
      width: rect.width,
      height: rect.height
    })
  }

  return (
    <div className="mi-positioning-panel__chart">
      <svg ref={ref} width={box.width || undefined} height={box.height || undefined} viewBox={viewBoxOf(box, geometry)}
        role="img" aria-label={text.pairTitle}
        onMouseMove={pick} onMouseLeave={() => setHover(undefined)}>
        <text x="0" y={geometry.upperTop - 8} className="mi-positioning-panel__lane">{text.notional}</text>
        <text x="0" y={geometry.upperBottom + 18} className="mi-positioning-panel__lane">{text.rateLabel}</text>
        <line x1={geometry.left} x2={geometry.right} y1={geometry.upperBottom + 6} y2={geometry.upperBottom + 6} className="mi-positioning-panel__rule" />
        <path d={linePath(positioning.btc, x, point => upperY(point.notionalUsd, btcScale))} className="mi-positioning-panel__line" data-series="btc" />
        <path d={linePath(positioning.eth, x, point => upperY(point.notionalUsd, ethScale))} className="mi-positioning-panel__line" data-series="eth" />
        <line x1={geometry.left} x2={geometry.right} y1={geometry.zero} y2={geometry.zero} className="mi-positioning-panel__zero" />
        {[...slots.entries()].map(([settlesAt, slot]) => (['btc', 'eth'] as const).map(asset => {
          const rate = slot[asset]
          if (rate === undefined) return null
          const y = rateY(rate)
          return <rect key={`${asset}-${settlesAt}`} data-series={asset} data-settles-at={new Date(settlesAt).toISOString()}
            className="mi-positioning-panel__bar"
            x={barX(x(settlesAt), asset)} y={Math.min(y, geometry.zero)}
            width={barWidth} height={Math.max(Math.abs(geometry.zero - y), 0.8)} rx="1" />
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
          const flip = cx > geometry.right - 64
          const dy = asset === 'btc' ? -8 : 12
          return (
            <text key={asset} data-line-end={asset} data-series={asset}
              className="mi-positioning-panel__end"
              x={flip ? cx - 4 : cx + 4}
              y={Math.max(geometry.upperTop + 12, Math.min(cy + dy, geometry.upperBottom + 4))}
              textAnchor={flip ? 'end' : 'start'}>{formatDashboardNotional(last.notionalUsd)}</text>
          )
        })}
        {/* 一枚牌一组：线、点、牌在同一个组里，悬停/聚焦/点哪个都出同一份浮层。
            牌只说自己那个市场那个方向，颜色也由它定（`data-hint-direction` → `currentColor`）。
            **不存在只画线的命中**——每条线都在某个带牌的组里；两排都放不下的命中连牌带线一起不画，
            数量由下面那句「图上还有 N 次」统一记账。 */}
        {marks.chips.map(chip => (
          <Tooltip key={chip.key} dataText={chip.summary} resolveText={resolveProductKey}>
            <g className="mi-positioning-panel__hint" data-hint={chip.asset} data-hint-direction={chip.direction}
              data-hint-count={chip.marks.length} tabIndex={0} aria-label={chip.summary}>
              {chip.marks.map(mark => (
                <g key={mark.key}>
                  <line x1={mark.x} x2={mark.x} y1={geometry.markerRow} y2={geometry.height - 10} />
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
        {hovered && hover ? <line className="mi-positioning-panel__crosshair" x1={xAt(hover.index)} x2={xAt(hover.index)} y1={geometry.upperTop} y2={geometry.height - 10} /> : null}
        {axisTicks(startMs, span, count).map(tick => (
          <text key={tick.at} x={x(tick.at)} y={geometry.height - 6}
            textAnchor={tick.first ? 'start' : tick.last ? 'end' : 'middle'}
            className="mi-positioning-panel__tick">{formatTick(new Date(tick.at).toISOString())}</text>
        ))}
      </svg>
      {hovered && hover ? (
        <div className="mi-positioning-panel__tooltip" style={placePositioningTooltip({
          x: hover.left, y: hover.top, boxWidth: hover.width, boxHeight: hover.height
        })}>
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

/**
 * 图这一列的整块：量容器 → 几何 → 牌排布 → 图 + 两条脚注。
 *
 * 量在这里、算也在这里：牌能不能放下取决于图有多宽，截断数又是「服务端截断 + 排不下」一个数字，
 * 三者必须同源，拆到两处就会各算一套。脚注放在量出来的框**外面**，不占图的高度。
 */
export function PositioningChartBody({ positioning, funding, text, fundingNote }: Readonly<{
  positioning: Extract<DashboardPositioningViewState, { state: 'available' }>
  funding: DashboardFundingRateHistoryState
  text: PositioningPanelText
  /** 一条腿读不到时的说明（面板按 `funding.missing` 造句，这里只排位置）。 */
  fundingNote: string
}>): React.ReactElement {
  const [ref, box] = useChartBox()
  const geometry = useMemo(() => geometryOf(box), [box.width, box.height])
  const marks = useMemo(() => layoutLiquidationMarks(positioning, text, geometry), [positioning, text, geometry])
  const undrawn = positioning.hiddenHits + marks.hidden
  return (
    <>
      <div className="mi-positioning-panel__chart-body" ref={ref}>
        <PositioningChart positioning={positioning} funding={funding} text={text} geometry={geometry} marks={marks} box={box} />
      </div>
      {/* 一条腿读不到：整句、muted、不带重试——另半张图照常画，读者要知道少了哪条腿。 */}
      {fundingNote ? (
        <p className="mi-positioning-panel__funding-missing" data-funding-missing="true" role="status">{fundingNote}</p>
      ) : null}
      {/*
        截断行：只说图，不说判定结论。它和卡底的「判定三态」是两处、可以同时出现——
        一个说图上有几个点没画，一个说这次判成什么；**截断行不许提结论，判定行不许提数量**。
        只有**一个数字**：服务端截断的（DTO 本来就没进图）+ 两排都排不下而丢掉的。
      */}
      {undrawn > 0 ? (
        <p className="mi-positioning-panel__hidden-hits" data-hidden-hits="">
          {text.liquidationHiddenHits.replace('{count}', String(undrawn))}
        </p>
      ) : null}
    </>
  )
}

function linePath(points: readonly DashboardPositioningPoint[], x: (ms: number) => number, y: (point: DashboardPositioningPoint) => number): string {
  return points.map((point, index) => `${index ? 'L' : 'M'}${x(Date.parse(point.observedAt)).toFixed(1)} ${y(point).toFixed(1)}`).join(' ')
}

export function formatRate(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(4)}%`
}