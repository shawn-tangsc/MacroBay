import type { ComposeOption } from 'echarts/core'
import type { GaugeSeriesOption, LineSeriesOption } from 'echarts/charts'
import type { GridComponentOption, TooltipComponentOption } from 'echarts/components'

import type { FearGreedSeriesPoint, OptionSkewSeriesPoint } from '../../../../contracts/intelligenceQueryContracts'
import { CHART_FONT_FAMILY as FONT } from './defensivePremiumChartTheme'
import type { ChartFonts, ChartPalette } from './defensivePremiumChartTheme'
import { fitSkewAxis } from './skewAxisFit'

// 主题（字号/色板读取）与刻度拟合各自单独一份：这个文件贴着 500 行硬线，公共面仍从这里转出。
export { CHART_FONTS_FALLBACK, readChartFonts, readChartPalette } from './defensivePremiumChartTheme'
export type { ChartFonts, ChartPalette, ChartTheme } from './defensivePremiumChartTheme'

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
 * 图从第 3 个点起才画：1–2 个点连不成线，坐标轴还会塌成一条（实测刻度竖排、网格铺满整格）。
 * 同一个数也决定「连线」的门槛：3 个点起就画折线。
 */
export const CHART_MIN_POINTS = 3

/** 超过这个点数就不画圆点：点挨得太密会连成「虚线」，读者以为那是另一种线型。 */
export const CHART_SYMBOL_MAX_POINTS = 7

/** 恐惧贪婪那条线的门槛维持原值：这一半不改。 */
const CHART_LINE_MIN_POINTS = 5
/** 偏斜的连线门槛：2 个真实读数之间那段就是事实，画出来；1 个点只画点（Chief 2026-11-23）。 */
const CHART_LINE_MIN_SKEW_POINTS = 2
const CHART_WINDOW_DAYS = 30


/** 偏斜：图位 168 里扣掉上面 12、下面 24（日期），中间 132 给曲线。
 *  单位名 2026-11-22 起重排：不再画在图里，改由读数字与行名带出（`10.9 百分点`）。 */
// 左 32：偏斜格是最右一格、紧挨仪表列，`10.4` 这种四字符标签在 left 8 时会画到框外压到仪表上
// （ECharts 6 不认 containLabel，只能显式留窝；界面 2026-11-22 要求复核的就是这里）。
const SKEW_GRID = { left: 32, right: 28, top: 12, bottom: 24, containLabel: true } as const

/**
 * 恐惧贪婪的留白：左右下三项维持改造前那套，上 34 → 12（量程 `指数 0–100` 挪到行名后缀，图里不再有那行字）。
 *
 * 用户 2026-11-22 的截图里中列的 `100/50/0` 与首个日期被左列压住：这版 ECharts 6 不认
 * `containLabel`（会警告并要求改用 outerBounds），所以只能显式留出刻度与日期的落脚处——
 * 三个字符的 `100` 加 8 的间距约 32。左列自己也限宽 176，两头一起保证不越界。
 */
// 右留白 16（界面 2026-11-24）：这张图右边没有刻度、只剩末位日期居中要约 15，28 那一截是白留的。
// 右图（偏斜）的 32 不动——`10.4` 这种四字符标签加 8 间距就是 32，再收会裁字。
const FEAR_GREED_GRID = { left: 32, right: 16, top: 12, bottom: 24, containLabel: true } as const

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
        // 末点那个日期必须印出来：读数写「截至 X」，轴上却停在 X 的前一天，读者只会读成「数据停在昨天」。
        // 和偏斜同一套索引——离末尾不足 2 天的 7 倍序号丢掉，给最后一天腾位置（ECharts 会为避让隐掉挤在一起的那个）。
        // 网格、0/100/50、「中性」那条线一概不动（Chief 2026-11-22 点头只改标签索引）。
        interval: (index: number) => dayLabelIndexes(days.length).has(index),
        formatter: axisLabelFormatter
      }
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      interval: 50,
      // 量程说明（`指数 0–100`）是行名后缀的一行字，不再画在轴顶（用户 2026-11-22 重排）。
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
      // 点数一多，每个点都画出来会连成「虚线」；>7 只留线，≤7 才逐点画（用户 2026-11-22）。
      showSymbol: values.length <= CHART_SYMBOL_MAX_POINTS,
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
  palette: ChartPalette
  fonts: ChartFonts
}): ChartOption {
  const values = input.points.map(point => point.riskReversal)
  const low = values.length > 0 ? Math.min(...values) : 0
  const high = values.length > 0 ? Math.max(...values) : 1
  // 1–2 个读数：点不贴轴底、也不贴刻度线（Chief 2026-11-23）；3 个点起维持原来那套刻度。
  const fit = fitSkewAxis(low, high, input.points.length < CHART_MIN_POINTS)
  return lineChartOption({
    days: input.points.map(point => point.day),
    values,
    name: '偏斜',
    suffix: ' 百分点',
    palette: input.palette,
    fonts: input.fonts,
    min: fit.min,
    max: fit.max,
    interval: fit.interval,
    gridLines: fit.gridLines,
    areaOpacity: 0.12
  })
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

const NICE_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10] as const

function lineChartOption(input: {
  days: readonly string[]
  values: readonly number[]
  name: string
  suffix: string
  palette: ChartPalette
  fonts: ChartFonts
  min: number
  max: number
  interval: number
  /** 填充透明度：只有偏斜传 0.12（窄量程里面积太厚，界面 2026-11-22）；恐惧贪婪维持 0.22。 */
  areaOpacity?: number
  /** 横向网格线的档位值（不含最上面那条边）：给了就用 markLine 画，Y 轴自己的 splitLine 关掉。 */
  gridLines?: readonly number[]
  /** 该刻度值带语义标签（目前只有恐惧贪婪的 50 = 中性）。 */
  neutralAt?: number
  neutralLabel?: string
}): ChartOption {
  const { palette, fonts } = input
  const drawsLine = input.values.length >= CHART_LINE_MIN_SKEW_POINTS
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
      // 少于 3 个读数时让每档占满整格（boundaryGap: true）：点落在档位中间，不贴在绘图区左右边上。
      // 只有 1 个读数时，点和它自己的日期都在中间；2 个读数时点在 1/4 与 3/4，不再像被边框裁掉
      // （用户 2026-11-23 看 2 点那张：右点正压在右下角）。3 个点起按真实跨度铺满。
      boundaryGap: window.days.length < CHART_MIN_POINTS,
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
      // 单位不进图里（用户 2026-11-22 重排）：偏斜的「百分点」在读数字，量程在行名后缀。
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
      splitLine: input.gridLines === undefined
        ? { lineStyle: { color: palette.grid, type: 'dashed' } }
        : { show: false }
    },
    series: [{
      type: 'line',
      name: input.name,
      data: window.values,
      // 点少时把线隐掉（只留点），一个点都不编。
      smooth: 0.22,
      symbol: 'circle',
      symbolSize: 4,
      // 点数一多，每个点都画出来会连成「虚线」；>7 只留线，≤7 才逐点画（用户 2026-11-22）。
      showSymbol: input.values.length <= CHART_SYMBOL_MAX_POINTS,
      lineStyle: { width: drawsLine ? 1.6 : 0, opacity: drawsLine ? 1 : 0, color: palette.line },
      itemStyle: { color: palette.line, borderColor: palette.surface, borderWidth: 1 },
      // 淡面积：同一个线色加透明度，不另造一份品牌色的 rgba。
      // 3 个点起才铺面积：2 个点的面积只是点下面一块三角，右端还会多出一条竖边（用户看图像一堵墙）。
      areaStyle: input.values.length >= CHART_MIN_POINTS
        ? { color: palette.line, opacity: input.areaOpacity ?? 0.22 }
        : undefined,
      ...(input.gridLines === undefined ? {} : {
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { color: palette.grid, type: 'dashed' as const, width: 1 },
          data: input.gridLines.map(value => ({ yAxis: value }))
        }
      })
    }]
  }
}

/** 仪表：五段弧 + 指针 + 圆盘里的分数；**图里没有任何字**（档位词在头栏中轨，用户 2026-11-24）。
 *  画布与两侧走势图同为 168、在 240 列里居中；圆心 88%（168 下 y = 147.8），半径 min(w/2 − 10, h − 22)
 *  ——240 列下是 110。弧弦 147.8、描边到约 152.8，比两侧图的轴底（168 − 24 = 144）低 3.8：
 *  「与两侧等高、三列底边齐」按画布算，不是把弧压进日期文字那一行。 */
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