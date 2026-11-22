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

/**
 * 图的字号也从 token 派生，不写死数字：
 * `--font-body`（读数与提示框）、`--font-meta`（轴与刻度）、`--font-metric-sm`（仪表圆盘里的分数）。
 */
export type ChartFonts = { body: number; meta: number; metricSm: number }

/** 拿不到 CSS 变量时用：与 `tokens.css` 的这三档一致。 */
export const CHART_FONTS_FALLBACK: ChartFonts = { body: 12, meta: 11, metricSm: 24 }

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
  return {
    body: read('--font-body', CHART_FONTS_FALLBACK.body),
    meta: read('--font-meta', CHART_FONTS_FALLBACK.meta),
    metricSm: read('--font-metric-sm', CHART_FONTS_FALLBACK.metricSm)
  }
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

/**
 * 图从第 3 个点起才画：1–2 个点连不成线，坐标轴还会塌成一条（实测刻度竖排、网格铺满整格）。
 * 同一个数也决定「连线」的门槛：3 个点起就画折线。
 */
export const CHART_MIN_POINTS = 3

/** 恐惧贪婪那条线的门槛维持原值：这一半不改。 */
const CHART_LINE_MIN_POINTS = 5
const CHART_WINDOW_DAYS = 30

const FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif'

/** 偏斜：图位 168 下真正能画的区域——扣掉上面 26（单位名）、下面 24（日期），中间 118。 */
const SKEW_GRID = { left: 8, right: 28, top: 26, bottom: 24, containLabel: true } as const

/** 恐惧贪婪维持改造前那套留白（top 34 / bottom 26），一个字不动。 */
const FEAR_GREED_GRID = { left: 12, right: 28, top: 34, bottom: 26, containLabel: true } as const

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

/**
 * 恐惧贪婪这张图**维持改造前的样子**：数据驱动的横轴、0/100 固定量程、50 那条参考线与「中性」。
 * 2026-11-22 用户指出这一半本来就是现成的，不该被新规矩带着改——所以它和偏斜**不共用**
 * 任何坐标轴配置，将来改偏斜也不会再碰到它。
 */
export function fearGreedChartOption(input: {
  points: readonly FearGreedSeriesPoint[]
  axisName: string
  palette: ChartPalette
  fonts: ChartFonts
}): ChartOption {
  const { palette, fonts } = input
  const days = input.points.map(point => point.day)
  const values = input.points.map(point => point.score)
  const drawsLine = values.length >= CHART_LINE_MIN_POINTS
  return {
    animation: false,
    aria: { enabled: false },
    grid: { ...FEAR_GREED_GRID },
    tooltip: lineTooltip(palette, fonts, '恐惧与贪婪', ''),
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: [...days].reverse(),
      axisLine: { lineStyle: { color: palette.axis } },
      axisTick: { show: false },
      axisLabel: {
        color: palette.muted,
        fontSize: fonts.meta,
        fontFamily: FONT,
        margin: 10,
        interval: (index: number) => index === 0 || index === CHART_WINDOW_DAYS - 1 || index % 7 === 0,
        formatter: axisLabelFormatter
      }
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      interval: 50,
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
      name: '恐惧与贪婪',
      data: [...values].reverse(),
      smooth: 0.22,
      symbol: 'circle',
      symbolSize: 4,
      showSymbol: true,
      lineStyle: { width: drawsLine ? 1.6 : 0, opacity: drawsLine ? 1 : 0, color: palette.line },
      itemStyle: { color: palette.line, borderColor: palette.surface, borderWidth: 1 },
      areaStyle: drawsLine ? { color: palette.line, opacity: 0.22 } : undefined,
      markLine: {
        silent: true,
        symbol: 'none',
        lineStyle: { color: palette.axis, type: 'dashed' as const, width: 1 },
        label: { show: true, position: 'insideEndTop' as const, formatter: '中性', color: palette.muted, fontSize: fonts.meta, fontFamily: FONT },
        data: [{ yAxis: 50 }]
      }
    }]
  }
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
  const fit = fitSkewAxis(low, high)
  return lineChartOption({
    days: input.points.map(point => point.day),
    values,
    name: '偏斜',
    axisName: input.axisName,
    suffix: ' 百分点',
    palette: input.palette,
    fonts: input.fonts,
    min: fit.min,
    max: fit.max,
    interval: fit.interval
  })
}

/**
 * 偏斜 Y 轴贴合本窗数据（界面 2026-11-22 的判据）：
 *
 * - 轴跨度**不超过数据跨度的 2 倍**（数据跨度不足 0.5 按 0.5 算，否则几个几乎同值的点会把轴压成一条）；
 * - 刻度间隔**不超过数据跨度的 1/2**；
 * - 上下界盖住数据，但不为了「凑四档」把轴撑开——第一版取整凑四档，12.8–13.2 的数据被摊到 12–15，
 *   曲线只用了六分之一高，看着还是一条平线。
 *
 * 档数因此是**结果**不是约束：小跨度 3 档、宽跨度最多 5 档；间隔取「不超过半个数据跨度」的最大整档，
 * 所以轴跨度最多是数据跨度 + 一个间隔（≤1.5 倍），永远满足 2 倍上限。
 */
function fitSkewAxis(low: number, high: number): { min: number; max: number; interval: number } {
  const dataSpan = high - low
  const span = Math.max(dataSpan, 0.5)
  let interval: number = NICE_STEPS[0]!
  for (const step of NICE_STEPS) {
    if (step <= span / 2) interval = step
  }
  // 下界按间隔对齐，上界取到盖住最大值的最近一档：曲线铺满绘图区高度。
  // 档数**不设上限**——先保证盖住数据，再谈好不好看：12.6–13.4 配 0.2 的间隔必须到 5 档，
  // 硬压成 4 档就会把最大值裁掉（浮点误差还会让 `floor(12.6 / 0.2)` 落到 62，下界掉半格）。
  const epsilon = 1e-9
  const min = Math.floor(low / interval + epsilon) * interval
  const steps = Math.max(2, Math.ceil((high - min) / interval - epsilon))
  const max = min + steps * interval
  return { min: round1(min), max: round1(max), interval: round1(interval) }
}

/**
 * 日期轴 + 按日对齐的取值；窗口里没有数据的日子是 `null`（缺口就是缺口，不补 0）。
 *
 * 窗口**按实际数据跨度铺满**（首日…最新一天），最多 30 天：攒到 5 个读数时曲线铺满整格，
 * 而不是被钉死的 30 天挤到最右边一小条（用户 2026-11-22）。满 30 天自然就是 30 天窗口。
 * 无法解析最新一天时退回原样，让图至少能画出来。
 */
function pinnedWindow(days: readonly string[], values: readonly number[]): { days: string[]; values: Array<number | null> } {
  const newest = days[0]
  const newestMs = newest === undefined ? Number.NaN : Date.parse(`${newest}T00:00:00.000Z`)
  if (!Number.isFinite(newestMs)) return { days: [...days].reverse(), values: [...values].reverse() }
  const oldest = days[days.length - 1]
  const oldestMs = oldest === undefined ? Number.NaN : Date.parse(`${oldest}T00:00:00.000Z`)
  const spanDays = Number.isFinite(oldestMs)
    ? Math.min(CHART_WINDOW_DAYS, Math.max(1, Math.round((newestMs - oldestMs) / 86_400_000) + 1))
    : CHART_WINDOW_DAYS
  const byDay = new Map(days.map((day, index) => [day, values[index]]))
  const windowDays: string[] = []
  const windowValues: Array<number | null> = []
  for (let offset = spanDays - 1; offset >= 0; offset -= 1) {
    const day = new Date(newestMs - offset * 86_400_000).toISOString().slice(0, 10)
    windowDays.push(day)
    const value = byDay.get(day)
    windowValues.push(value === undefined ? null : value)
  }
  return { days: windowDays, values: windowValues }
}

/** 日期轴上要印的序号：首、尾、以及每隔 7 天（离末尾不足 2 天的那个丢掉）。 */
function dayLabelIndexes(length: number): Set<number> {
  const indexes = new Set<number>([0, length - 1])
  for (let index = 7; index < length - 2; index += 7) indexes.add(index)
  return indexes
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

const NICE_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10] as const

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
  /** 该刻度值带语义标签（目前只有恐惧贪婪的 50 = 中性）。 */
  neutralAt?: number
  neutralLabel?: string
}): ChartOption {
  const { palette, fonts } = input
  const drawsLine = input.values.length >= CHART_MIN_POINTS
  // X 轴钉住**整个 30 天窗口**：窗口首日 = 最新一天往前 29 天。跟着数据收缩会让 3 个点铺满整格，
  // 一格当 30 天读；1 个点时范围缩到 0，竖线糊满屏就是这么来的。缺的日子留空，不补值。
  const window = pinnedWindow(input.days, input.values)
  return {
    animation: false,
    aria: { enabled: false },
    grid: { ...SKEW_GRID },
    tooltip: lineTooltip(palette, fonts, input.name, input.suffix),
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: window.days,
      axisLine: { lineStyle: { color: palette.axis } },
      axisTick: { show: false },
      axisLabel: {
        color: palette.muted,
        fontSize: fonts.meta,
        fontFamily: FONT,
        margin: 10,
        // 首尾 + 每 7 天一个，够读又不挤。落在末尾两天内的那个 7 倍序号要丢掉，
        // 否则它和「最后一天」挤在一起、ECharts 会把最后一天藏起来（读者看不到截至那天）。
        interval: (index: number) => dayLabelIndexes(window.days.length).has(index),
        formatter: axisLabelFormatter
      },
      // 竖向网格线一条都不要：日期轴上的竖线只会和曲线抢注意力。
      splitLine: { show: false }
    },
    yAxis: {
      type: 'value',
      min: input.min,
      max: input.max,
      interval: input.interval,
      // 单位进轴名、画在轴顶：不再压在刻度行上。
      name: input.axisName,
      // 单位名贴在轴顶左上角：不再单独占 34 的一行。
      nameLocation: 'end',
      nameGap: 8,
      nameTextStyle: { color: palette.muted, fontSize: fonts.meta, fontFamily: FONT, align: 'left' },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: palette.muted,
        fontSize: fonts.meta,
        fontFamily: FONT,
        margin: 8,
        // 中性那一档直接把语义写进标签，避免同一件事在一张图里说两遍。
        formatter: (value: number) => input.neutralAt !== undefined && value === input.neutralAt && input.neutralLabel
          ? `${value} · ${input.neutralLabel}`
          : String(value)
      },
      splitLine: { lineStyle: { color: palette.grid, type: 'dashed' } }
    },
    series: [{
      type: 'line',
      name: input.name,
      data: window.values,
      // 点少时把线隐掉（只留点），一个点都不编。
      smooth: 0.22,
      symbol: 'circle',
      symbolSize: 4,
      showSymbol: true,
      lineStyle: { width: drawsLine ? 1.6 : 0, opacity: drawsLine ? 1 : 0, color: palette.line },
      itemStyle: { color: palette.line, borderColor: palette.surface, borderWidth: 1 },
      // 淡面积：同一个线色加透明度，不另造一份品牌色的 rgba。
      areaStyle: drawsLine ? { color: palette.line, opacity: 0.22 } : undefined
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
        fontSize: fonts.metricSm,
        fontWeight: 650,
        fontFamily: FONT,
        color: palette.text,
        formatter: '{value}'
      },
      data: [{ value: input.score ?? 0 }]
    }]
  }
}