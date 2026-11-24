import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { GaugeChart as GaugeSeries, LineChart } from 'echarts/charts'
import { GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'

import { LoadingState } from '@platform/ui/components/loading'

import type { FearGreedSeriesPoint, OptionSkewSeriesPoint } from '../../../../contracts/intelligenceQueryContracts'
import type { ChartFonts, ChartOption, ChartPalette } from './defensivePremiumChartOptions'
import { fearGreedChartOption, gaugeChartOption, readChartFonts, readChartPalette, skewChartOption } from './defensivePremiumChartOptions'

/**
 * 注册集合**钉死在这里**：三张图只用到两个系列、三个组件与 SVG 渲染器，不整包引 ECharts。
 * 用例按这个数组逐个比对（多注册一个、少注册一个、换成 `import *` 都会红）。
 */
export const CHART_MODULES = [LineChart, GaugeSeries, GridComponent, TooltipComponent, MarkLineComponent, SVGRenderer] as const

echarts.use([...CHART_MODULES])

/**
 * 合并卡的三张图：ECharts（SVG renderer）。
 *
 * 为什么用 SVG renderer：这个 workspace 跑在 Electron 里、还要在 happy-dom 的用例里渲染，
 * SVG renderer 两种环境都不需要 canvas。元素有布局时按真实宽度初始化，指针事件（十字光标、tooltip）
 * 才有效；没有布局时（用例、离屏首帧）退回 ECharts 的 SSR 模式并给一个固定宽——那种模式不接指针
 * 事件，只负责把图画出来。
 *
 * 颜色从容器上读 `.mi-sample-surface` 继承下来的 CSS 变量（深浅主题各自有值），组件里不写死颜色。
 */

/** 曲线区高度（px）。与 CSS 里的 `--mi-defensive-premium-chart-height` 是同一个数，有用例对账。 */
export const CHART_HEIGHT = 168

/**
 * 仪表**画布**的高度：与两侧走势图同为 168（用户 2026-11-24：仪表要占满整格、与两侧等高，
 * 不许为给下面一句话让位而缩一圈）。档位词已经搬到头栏中轨，图里不再有任何字，
 * 所以画布不需要留出 41 那一截。
 */
export const GAUGE_CHART_HEIGHT = CHART_HEIGHT

/**
 * 走势格的兜底宽：1040 内容宽下两格各 388。
 * **416 不是任何一列的真实宽度**——它就是那次「仪表按 416 画、弧压到中列」的来源（用户 2026-11-22）。
 */
const CHART_FALLBACK_WIDTH = 388

/**
 * 仪表的兜底宽：它是**中间一列 240 的格子**（940–995 那档退回 184），绝不能借曲线那 388/416。
 * 借了的下场是真实布局还没量到时按别人的宽画一张弧，弧横着压到中列图上
 * （用户 2026-11-22 的截图：`11-14`、`11-22` 和右轴标题都被盖住）。
 */
const GAUGE_FALLBACK_WIDTH = 240

/** 图的主题：颜色与字号都从宿主的 CSS 变量读，读不到才用兜底值。 */
function readChartTheme(element: Element): { palette: ChartPalette; fonts: ChartFonts } {
  return { palette: readChartPalette(element), fonts: readChartFonts(element) }
}

type ChartFrameProps = Readonly<{
  chart: 'fear-greed' | 'skew' | 'gauge'
  height: number
  /** 图的读屏名：一次说完「画的是什么、窗口多大、首末值」。 */
  label: string
  /** 装饰性的图（读数已经以文字出现在旁边）：不进可访问树。 */
  decorative?: boolean
  /** 量不到宽度时的兜底宽：按**本列**宽度给，不许跨列借用。 */
  fallbackWidth?: number
  build: (theme: { palette: ChartPalette; fonts: ChartFonts }, size: { width: number; height: number }) => ChartOption
}>

function ChartFrame({ chart, height, label, decorative, fallbackWidth = CHART_FALLBACK_WIDTH, build }: ChartFrameProps): React.ReactElement {
  const host = useRef<HTMLDivElement | null>(null)
  const instance = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    const element = host.current
    if (!element) return undefined
    const width = element.clientWidth || fallbackWidth
    // 不用 `ssr: true`：那种模式只产出 SVG 字符串、**不往元素里挂**，卡片会是一块空白，
    // 而且不接指针事件（十字光标与 tooltip 就没了）。SVG renderer 在 happy-dom 里同样能跑，
    // 所以这里始终用可挂载的模式，只把宽高显式给出来（无布局环境用**本列**兜底宽）。
    const created = echarts.init(element, undefined, { renderer: 'svg', width, height })
    instance.current = created
    created.setOption(build(readChartTheme(element), { width, height }), true)
    /** 量到真实宽度就按它重画；量不到（0）说明还没布局，等下一拍或等 ResizeObserver。 */
    const redraw = (): void => {
      const next = element.clientWidth
      if (next <= 0) return
      created.resize({ width: next, height })
      created.setOption(build(readChartTheme(element), { width: next, height }), true)
    }
    // 首次布局可能晚于这次 effect：下一帧再量一次（ResizeObserver 只在尺寸**变化**时回调，
    // 从「兜底宽」到「真实宽」如果没触发回调，这里兜住）。
    const frame = typeof requestAnimationFrame === 'undefined' ? undefined : requestAnimationFrame(redraw)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(redraw)
    observer?.observe(element)
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      observer?.disconnect()
      created.dispose()
      instance.current = null
    }
    // 初始化只做一次；换数据由下面那个 effect 处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, fallbackWidth])

  useEffect(() => {
    const element = host.current
    if (!element || instance.current === null) return
    const width = element.clientWidth || fallbackWidth
    instance.current.setOption(build(readChartTheme(element), { width, height }), true)
  }, [build, height, fallbackWidth])

  return <figure className="mi-defensive-premium__chart" data-chart={chart} style={{ height }}
    {...(decorative ? { 'aria-hidden': 'true' } : { role: 'img', 'aria-label': label })}>
    <div ref={host} className="mi-defensive-premium__chart-canvas" aria-hidden="true" />
  </figure>
}

export function FearGreedChart({ points, ariaLabel }: Readonly<{
  points: readonly FearGreedSeriesPoint[]
  ariaLabel: string
}>): React.ReactElement | null {
  if (points.length === 0) return null
  return <ChartFrame chart="fear-greed" height={CHART_HEIGHT} label={ariaLabel}
    build={theme => fearGreedChartOption({ points, ...theme })} />
}

export function SkewChart({ points, ariaLabel }: Readonly<{
  points: readonly OptionSkewSeriesPoint[]
  ariaLabel: string
}>): React.ReactElement | null {
  if (points.length === 0) return null
  return <ChartFrame chart="skew" height={CHART_HEIGHT} label={ariaLabel}
    build={theme => skewChartOption({ points, ...theme })} />
}

/**
 * 加载态的空图框：与真图同高（同一个高度变量），不画线、不画值。
 * 转圈叠在图框里、不另占一行：它是指示，不是内容。
 */
export function ChartPlaceholder({ axisLabel, waitingLabel }: Readonly<{ axisLabel: string; waitingLabel?: string }>): React.ReactElement {
  return <div className="mi-defensive-premium__chart mi-defensive-premium__chart--placeholder" data-chart-placeholder
    aria-hidden={waitingLabel === undefined ? 'true' : undefined}>
    {/* 轴说明一直在（换成图之后同一句会在 Y 轴名上），转圈叠在它上面。 */}
    <span className="mi-defensive-premium__chart-axis">{axisLabel}</span>
    {waitingLabel === undefined ? null : <span className="mi-defensive-premium__chart-wait">
      <LoadingState label={waitingLabel} layout="inline" />
    </span>}
  </div>
}

/**
 * 仪表那一列：五段弧 + 指针 + 圆盘里的分数；没有读数时只剩弧。
 * 装饰性：分数与档位词以文字出现在它上面的读数行里，读屏不需要再念一遍这块画布。
 */
export function GaugeChart({ score }: Readonly<{ score: number | undefined }>): React.ReactElement {
  return <ChartFrame chart="gauge" height={GAUGE_CHART_HEIGHT} label="" decorative fallbackWidth={GAUGE_FALLBACK_WIDTH}
    build={(theme, size) => gaugeChartOption({ score, width: size.width, height: size.height, ...theme })} />
}