import type { ComposeOption } from 'echarts/core'
import type { GaugeSeriesOption, LineSeriesOption } from 'echarts/charts'
import type { GridComponentOption, TooltipComponentOption } from 'echarts/components'

import type { FearGreedSeriesPoint, OptionSkewSeriesPoint } from '../../../../contracts/intelligenceQueryContracts'

/**
 * 合并卡三张图的 ECharts 选项：两条折线与一个仪表。
 *
 * 选项是**纯函数**（数据进、option 出），所以用例直接断 option——series 点数、轴名、颜色、
 * 平滑与面积——不用去读 canvas/SVG 内部结构，也就不再依赖「某个 class 出现过」这种假绿。
 *
 * 颜色从**宿主元素的 CSS 变量**读（门户色板定义在 `.mi-sample-surface` 上，深浅两套主题各自 remap），
 * 组件里不写死十六进制；没有样式表的环境（用例、离屏首帧）才退回下面这组深色值。
 */

/** 只组合这三张图用到的系列与组件：按需注册，不整包引 ECharts。 */
export type ChartOption = ComposeOption<
  LineSeriesOption | GaugeSeriesOption | GridComponentOption | TooltipComponentOption
>

/** 图的字号也从 token 派生（`--font-body` / `--font-meta`），不写死数字。 */
export type ChartFonts = { body: number; meta: number }

/** 拿不到 CSS 变量时用：与 `tokens.css` 的 body / meta 两档一致。 */
export const CHART_FONTS_FALLBACK: ChartFonts = { body: 12, meta: 11 }

export type ChartTheme = { palette: ChartPalette; fonts: ChartFonts }

export type ChartPalette = {
  line: string
  text: string
  muted: string
  grid: string
  axis: string
  surface: string
  bands: readonly [string, string, string, string, string]
}

/**
 * 色板只从宿主元素的 CSS 变量读（门户色板定义在 `.mi-sample-surface` 上，深浅主题各自 remap）。
 * **生产代码里不存任何颜色字面量**：读不到就是空串，那种环境只有用例与离屏首帧，不画给人看。
 */
const PALETTE_VARS = [
  ['line', '--mi-dashboard-lime'],
  ['text', '--mi-dashboard-text'],
  ['muted', '--mi-dashboard-muted'],
  ['grid', '--mi-dashboard-line'],
  ['axis', '--mi-dashboard-line'],
  ['surface', '--mi-dashboard-surface']
] as const

const BAND_VARS = [
  '--mi-dashboard-sentiment-extreme-fear',
  '--mi-dashboard-sentiment-fear',
  '--mi-dashboard-sentiment-neutral',
  '--mi-dashboard-sentiment-greed',
  '--mi-dashboard-sentiment-extreme-greed'
] as const

/** 从宿主元素上读字号（token → 数字）；读不到就用默认两档。 */
export function readChartFonts(element: Element | null): ChartFonts {
  if (!element || typeof getComputedStyle !== 'function') return CHART_FONTS_FALLBACK
  const style = getComputedStyle(element)
  const read = (name: string, fallback: number): number => {
    const parsed = Number.parseFloat(style.getPropertyValue(name))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }
  return { body: read('--font-body', CHART_FONTS_FALLBACK.body), meta: read('--font-meta', CHART_FONTS_FALLBACK.meta) }
}

/** 从宿主元素上读色板；读不到就退回深色那组。 */
export function readChartPalette(element: Element | null): ChartPalette {
  const style = element && typeof getComputedStyle === 'function' ? getComputedStyle(element) : undefined
  const read = (name: string): string => style?.getPropertyValue(name).trim() ?? ''
  const palette = { line: '', text: '', muted: '', grid: '', axis: '', surface: '', bands: ['', '', '', '', ''] as ChartPalette['bands'] }
  for (const [key, variable] of PALETTE_VARS) palette[key] = read(variable)
  const bands = BAND_VARS.map(read)
  return { ...palette, bands: [bands[0]!, bands[1]!, bands[2]!, bands[3]!, bands[4]!] }
}

/** 少于 5 个点只画点、不连线：几个点连起来会被读成「趋势」，而方向判定恰恰说这时不够判。 */
export const CHART_LINE_MIN_POINTS = 5
const CHART_WINDOW_DAYS = 30

const FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif'

// right 留 28：最后一个日期写在轴的右端、居中对齐，留窄了会被裁掉半个。
const BASE_GRID = { left: 12, right: 28, top: 34, bottom: 26, containLabel: true } as const

function axisLabelFormatter(day: string): string {
  // 源日就是 `YYYY-MM-DD`：只印月-日，不换算时区、不带钟点。
  return day.slice(5)
}

function lineTooltip(palette: ChartPalette, fonts: ChartFonts, name: string, suffix: string): ChartOption['tooltip'] {
  return {
    trigger: 'axis',
    axisPointer: { type: 'line', lineStyle: { color: palette.muted, width: 1 } },
    backgroundColor: palette.surface,
    borderColor: palette.axis,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: palette.text, fontSize: fonts.body, fontFamily: FONT },
    extraCssText: 'border-radius: 6px;',
    formatter: (params) => {
      const first = Array.isArray(params) ? params[0] : params
      const value = first && 'value' in first ? first.value : ''
      const day = first && 'axisValue' in first ? String(first.axisValue) : ''
      return `${day}<br/>${name} ${String(value)}${suffix}`
    }
  }
}

export function fearGreedChartOption(input: {
  points: readonly FearGreedSeriesPoint[]
  axisName: string
  palette: ChartPalette
  fonts: ChartFonts
}): ChartOption {
  return lineChartOption({
    days: input.points.map(point => point.day),
    values: input.points.map(point => point.score),
    name: '恐惧与贪婪',
    axisName: input.axisName,
    suffix: '',
    palette: input.palette,
    fonts: input.fonts,
    // 指数天生 0–100：轴固定满量程，读者才知道 12 分在整条尺子上有多低。
    min: 0,
    max: 100,
    interval: 50,
    // 中性线：一条参考线比多画几条网格更能说清「现在在哪一侧」。
    markLineAt: 50
  })
}

export function skewChartOption(input: {
  points: readonly OptionSkewSeriesPoint[]
  axisName: string
  palette: ChartPalette
  fonts: ChartFonts
}): ChartOption {
  const values = input.points.map(point => point.riskReversal)
  const low = values.length > 0 ? Math.min(...values) : 0
  const high = values.length > 0 ? Math.max(...values) : 1
  // 一条水平线（或只有一个点）也要给它一圈上下限，否则坐标轴塌成一条线。
  const span = high - low < 0.1 ? 0.1 : high - low
  return lineChartOption({
    days: input.points.map(point => point.day),
    values,
    name: '偏斜',
    axisName: input.axisName,
    suffix: ' 百分点',
    palette: input.palette,
    fonts: input.fonts,
    // 偏斜没有「满量程」这回事：轴按本窗端点缩放，读者只看它自己的起伏。
    min: round1(low - span * 0.2),
    max: round1(high + span * 0.2),
    interval: niceInterval(span),
    markLineAt: undefined
  })
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** 刻度间隔跟着窗口跨度走，不让标签挤成一团。 */
function niceInterval(span: number): number {
  if (span <= 0.6) return 0.2
  if (span <= 3) return 0.5
  if (span <= 8) return 1
  return 2
}

function lineChartOption(input: {
  days: readonly string[]
  values: readonly number[]
  name: string
  axisName: string
  suffix: string
  palette: ChartPalette
  fonts: ChartFonts
  min: number
  max: number
  interval: number
  markLineAt: number | undefined
}): ChartOption {
  const { palette, fonts } = input
  const drawsLine = input.values.length >= CHART_LINE_MIN_POINTS
  return {
    animation: false,
    aria: { enabled: false },
    grid: { ...BASE_GRID },
    tooltip: lineTooltip(palette, fonts, input.name, input.suffix),
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: [...input.days].reverse(),
      axisLine: { lineStyle: { color: palette.axis } },
      axisTick: { show: false },
      axisLabel: {
        color: palette.muted,
        fontSize: fonts.meta,
        fontFamily: FONT,
        margin: 10,
        // 首尾 + 每 7 天一个，够读又不挤。
        interval: (index: number) => index === 0 || index === CHART_WINDOW_DAYS - 1 || index % 7 === 0,
        formatter: axisLabelFormatter
      }
    },
    yAxis: {
      type: 'value',
      min: input.min,
      max: input.max,
      interval: input.interval,
      // 单位进轴名、画在轴顶：不再压在刻度行上。
      name: input.axisName,
      nameLocation: 'end',
      nameGap: 14,
      nameTextStyle: { color: palette.muted, fontSize: fonts.meta, fontFamily: FONT, align: 'left' },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: palette.muted, fontSize: fonts.meta, fontFamily: FONT, margin: 8 },
      splitLine: { lineStyle: { color: palette.grid, type: 'dashed' } }
    },
    series: [{
      type: 'line',
      name: input.name,
      data: [...input.values].reverse(),
      // 点少时把线隐掉（只留点），一个点都不编。
      smooth: 0.22,
      symbol: 'circle',
      symbolSize: 4,
      showSymbol: true,
      lineStyle: { width: drawsLine ? 1.6 : 0, opacity: drawsLine ? 1 : 0, color: palette.line },
      itemStyle: { color: palette.line, borderColor: palette.surface, borderWidth: 1 },
      // 淡面积：同一个线色加透明度，不另造一份品牌色的 rgba。
      areaStyle: drawsLine ? { color: palette.line, opacity: 0.22 } : undefined,
      ...(input.markLineAt === undefined ? {} : {
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: palette.axis, type: 'dashed' as const, width: 1 },
          label: { show: true, position: 'insideEndTop' as const, formatter: '中性', color: palette.muted, fontSize: fonts.meta, fontFamily: FONT },
          data: [{ yAxis: input.markLineAt }]
        }
      })
    }]
  }
}

/** 仪表：五段弧 + 指针 + 圆盘里的分数；没有档位词（档位词是那一列的读数行）。 */
export function gaugeChartOption(input: {
  score: number | undefined
  width: number
  height: number
  palette: ChartPalette
  fonts: ChartFonts
}): ChartOption {
  const { palette, fonts } = input
  const pointer = input.score !== undefined
  const radius = Math.max(24, Math.min(input.width / 2 - 10, input.height - 22))
  return {
    animation: false,
    aria: { enabled: false },
    series: [{
      type: 'gauge',
      startAngle: 180,
      endAngle: 0,
      min: 0,
      max: 100,
      center: ['50%', '88%'],
      radius,
      axisLine: {
        lineStyle: {
          width: 10,
          color: [
            [0.2, palette.bands[0]], [0.4, palette.bands[1]], [0.6, palette.bands[2]],
            [0.8, palette.bands[3]], [1, palette.bands[4]]
          ]
        }
      },
      pointer: { show: pointer, length: '52%', width: 3, itemStyle: { color: palette.text } },
      anchor: { show: pointer, size: 8, itemStyle: { color: palette.surface, borderColor: palette.text, borderWidth: 2 } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      detail: {
        show: pointer,
        valueAnimation: false,
        offsetCenter: [0, '-42%'],
        fontSize: fonts.body * 2,
        fontWeight: 650,
        fontFamily: FONT,
        color: palette.text,
        formatter: '{value}'
      },
      data: [{ value: input.score ?? 0 }]
    }]
  }
}