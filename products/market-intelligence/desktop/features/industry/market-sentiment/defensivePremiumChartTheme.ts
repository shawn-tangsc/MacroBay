/**
 * 合并卡三张图的**主题**：字号与色板都从宿主元素的 CSS 变量读，生产代码里不存颜色字面量。
 * 单独一份是因为选项文件已经到 500 行硬线（`check:file-size`），这两段是纯读取、与 option 构造无关。
 */

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


/** 轴与提示框用的字体栈：三张图共用一处。 */
export const CHART_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif'
