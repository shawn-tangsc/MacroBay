import type { ChartPalette } from './defensivePremiumChartOptions'

/**
 * **只给用例用的**色板样例。
 *
 * 生产代码里不存任何颜色字面量——选项文件从宿主的 CSS 变量读色（深浅主题各自 remap）。
 * 用例需要一个已知的值来断「选项把色板原样带进去了」，所以在这里放一份；
 * 这 11 项与门户色板逐个对账的那条断言在 `defensivePremiumChartStack.test.ts` 里，
 * 谁改了样式表而忘了这里，那条会红。
 */
export const CHART_PALETTE_FIXTURE: ChartPalette = {
  line: '#d4ff58',
  text: '#edf0ed',
  muted: 'rgba(237, 240, 237, .56)',
  grid: 'rgba(237, 240, 237, .07)',
  axis: 'rgba(237, 240, 237, .14)',
  surface: '#15191d',
  bands: ['#e05a63', '#f08b57', '#f4ba4b', '#9fcf62', '#55d69b']
}
