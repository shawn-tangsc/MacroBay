import { LoadingState } from '@platform/ui/components/loading'

import type { FearGreedSeriesPoint, OptionSkewSeriesPoint } from '../../../../contracts/intelligenceQueryContracts'

/**
 * 合并卡的两条走势图：各自一张 SVG、各自一根纵轴、各自一个单位。
 *
 * 为什么不是一张双轴图：两条线的量纲不同（指数 0–100 / 百分点），叠在一张图上读者会拿
 * 交叉点当关系；分开画，任何一条想说什么都只跟自己那条轴比。
 *
 * 横轴从最新一个源日往回数 30 天：只剩 1 个点就画在右端（不假装有一整条历史），29 天就把
 * 最左那格空着。日期就是源给的 `YYYY-MM-DD`，不印钟点、不换算时区。
 */

const WIDTH = 520
const HEIGHT = 132
const PAD = { left: 40, right: 10, top: 10, bottom: 20 } as const
const PLOT_WIDTH = WIDTH - PAD.left - PAD.right
const PLOT_HEIGHT = HEIGHT - PAD.top - PAD.bottom
const WINDOW_DAYS = 30

export function FearGreedChart({ points, ariaLabel, axisLabel }: Readonly<{
  points: readonly FearGreedSeriesPoint[]
  ariaLabel: string
  axisLabel: string
}>): React.ReactElement | null {
  const newest = points[0]
  if (!newest) return null
  const plotted = points
    .map(point => ({ day: point.day, value: point.score, x: xOf(point.day, newest.day), y: yOf(point.score, 0, 100) }))
    .reverse()

  return <ChartFigure ariaLabel={ariaLabel} axisLabel={axisLabel} ticks={[0, 50, 100]}>
    <Series plotted={plotted} seriesKey="fear-greed" />
    <XAxisLabels first={oldestLabel(plotted)} last={newest.day} />
  </ChartFigure>
}

export function SkewChart({ points, ariaLabel, axisLabel, unit }: Readonly<{
  points: readonly OptionSkewSeriesPoint[]
  ariaLabel: string
  axisLabel: string
  unit: string
}>): React.ReactElement | null {
  const newest = points[0]
  if (!newest) return null
  const values = points.map(point => point.riskReversal)
  const low = Math.min(...values)
  const high = Math.max(...values)
  // 一条水平线（或只有一个点）也要给它一圈上下限，否则坐标轴塌成零高。
  const span = high - low < 0.1 ? 0.1 : high - low
  const min = low - span * 0.15
  const max = high + span * 0.15
  const plotted = points
    .map(point => ({ day: point.day, value: point.riskReversal, x: xOf(point.day, newest.day), y: yOf(point.riskReversal, min, max) }))
    .reverse()

  return <ChartFigure ariaLabel={ariaLabel} axisLabel={`${axisLabel}（${unit}）`} ticks={[min, max]} formatTick={value => value.toFixed(1)}>
    <Series plotted={plotted} seriesKey="skew" />
    <XAxisLabels first={oldestLabel(plotted)} last={newest.day} />
  </ChartFigure>
}

/**
 * 加载态的空图框：与真图同一 viewBox、同一 `width: 100%`，所以高度由同一套布局算出来，
 * 不写死任何像素；不画线、不画值——它只占位，不让换态把卡压塌。
 *
 * 等待的转圈叠在图框里、不另占一行：它是指示，不是内容，多一行就把加载态撑得比正常态高。
 * 给了 `waitingLabel` 时图框不再对读屏隐藏，转圈照常播报；空 `<svg>` 自己隐藏掉。
 */
export function ChartPlaceholder({ axisLabel, waitingLabel }: Readonly<{ axisLabel: string; waitingLabel?: string }>): React.ReactElement {
  return <figure className="mi-defensive-premium__chart" data-chart-placeholder
    {...(waitingLabel === undefined ? { 'aria-hidden': 'true' } : {})}>
    {/* 与真图同一条轴说明：少了它，加载态比正常态矮一行。 */}
    <figcaption className="mi-defensive-premium__chart-axis">{axisLabel}</figcaption>
    <span className="mi-defensive-premium__chart-frame">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height="auto" aria-hidden="true" />
      {waitingLabel === undefined ? null : <span className="mi-defensive-premium__chart-wait">
        <LoadingState label={waitingLabel} minHeight={24} layout="inline" />
      </span>}
    </span>
  </figure>
}

function ChartFigure({ ariaLabel, axisLabel, ticks, formatTick = String, children }: Readonly<{
  ariaLabel: string
  axisLabel: string
  ticks: readonly number[]
  formatTick?: (value: number) => string
  children: React.ReactNode
}>): React.ReactElement {
  const unique = [...new Set(ticks)]
  return <figure className="mi-defensive-premium__chart">
    <figcaption className="mi-defensive-premium__chart-axis">{axisLabel}</figcaption>
    <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height="auto">
      <g className="mi-defensive-premium__grid">
        {unique.map(value => <line key={value} x1={PAD.left} x2={WIDTH - PAD.right}
          y1={yOf(value, Math.min(...unique), Math.max(...unique))} y2={yOf(value, Math.min(...unique), Math.max(...unique))} />)}
      </g>
      {children}
      <g className="mi-defensive-premium__tick">
        {unique.map(value => <text key={value} x={PAD.left - 6} textAnchor="end" dominantBaseline="middle"
          y={yOf(value, Math.min(...unique), Math.max(...unique))}>{formatTick(value)}</text>)}
      </g>
    </svg>
  </figure>
}

function XAxisLabels({ first, last }: Readonly<{ first: string; last: string }>): React.ReactElement {
  // 只有一个点时左右两处会印同一个日期，看起来像有 30 天跨度；那种情况只留右缘那一个。
  return <g className="mi-defensive-premium__tick">
    {first === last ? null : <text data-axis-date="first" x={PAD.left} y={HEIGHT - 6} textAnchor="start">{first}</text>}
    <text data-axis-date="last" x={WIDTH - PAD.right} y={HEIGHT - 6} textAnchor="end">{last}</text>
  </g>
}

/**
 * 少于 5 个点只画点、不连线：几个点连起来会被读成「趋势」，而方向判定恰恰说这时不够判。
 */
function Series({ plotted, seriesKey }: Readonly<{ plotted: ReadonlyArray<{ x: number; y: number }>; seriesKey: string }>): React.ReactElement {
  return <g data-chart-series={seriesKey}>
    {plotted.length >= 5
      ? <polyline className="mi-defensive-premium__line" fill="none" points={pathOf(plotted)} data-chart-line={seriesKey} />
      : null}
    {plotted.map((point, index) => <circle key={`${point.x}-${index}`} className="mi-defensive-premium__dot" cx={point.x} cy={point.y} r="2.5" />)}
  </g>
}

function pathOf(points: ReadonlyArray<{ x: number; y: number }>): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

function oldestLabel(points: ReadonlyArray<{ day: string }>): string {
  return points[0]?.day ?? ''
}

/** 横轴固定 30 天：最新一天贴右缘，越往回越靠左；窗口外的点（服务端不该给）落到左缘之外就夹住。 */
function xOf(day: string, newestDay: string): number {
  const offset = daysBetween(day, newestDay)
  const ratio = Math.min(1, Math.max(0, offset / (WINDOW_DAYS - 1)))
  return WIDTH - PAD.right - ratio * PLOT_WIDTH
}

function yOf(value: number, min: number, max: number): number {
  const ratio = max === min ? 0.5 : (value - min) / (max - min)
  return PAD.top + PLOT_HEIGHT - Math.min(1, Math.max(0, ratio)) * PLOT_HEIGHT
}

/** 源日都是 UTC 零点标记的日期标签：只做纯日期差，不引入读者时区。 */
function daysBetween(day: string, newestDay: string): number {
  const from = Date.parse(`${day}T00:00:00.000Z`)
  const to = Date.parse(`${newestDay}T00:00:00.000Z`)
  if (Number.isNaN(from) || Number.isNaN(to)) return 0
  return Math.round((to - from) / 86_400_000)
}
