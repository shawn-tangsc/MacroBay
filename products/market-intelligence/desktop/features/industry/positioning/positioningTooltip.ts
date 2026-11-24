import { tooltipLeft } from '../../../shared/chart/tooltipPlacement'

/**
 * 持仓图那块悬停读数浮层落在哪。
 *
 * **横向只有一条规则**，就是 `shared/chart/tooltipPlacement`：右边放得下放右边、放不下翻到左边、
 * 两边都放不下才兜底。这里不再写自己的 clamp/翻边——旧写法在本文件里手抄过一份，它和另两张卡
 * 各抄一遍，改阈值只会改一处。
 *
 * 纵向（贴着光标垂直居中、再夹进框内）仍归这张图：它只跟浮层高度有关，没有翻边语义，不进共享函数。
 *
 * 尺寸是这张图自己的估量：浮层内容自适应宽度（CSS 里没有写死 width），所以这里只有一份数，
 * 不存在与样式表对账的问题。
 */
export const POSITIONING_TOOLTIP = { width: 214, height: 76, offset: 14, inset: 4 } as const

export type PositioningTooltipPosition = Readonly<{ left: number; top: number }>

export function placePositioningTooltip(input: Readonly<{ x: number; y: number; boxWidth: number; boxHeight: number }>): PositioningTooltipPosition {
  const { x, y, boxWidth, boxHeight } = input
  const { width, height, offset, inset } = POSITIONING_TOOLTIP
  const left = tooltipLeft({ x, boxWidth, width, offset, inset })
  // 纵向：以光标为中心，上下都夹进框内。这一条不进共享函数。
  const top = Math.min(Math.max(inset, y - height / 2), Math.max(inset, boxHeight - height - inset))
  return { left, top }
}