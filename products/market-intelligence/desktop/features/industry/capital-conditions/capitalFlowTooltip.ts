import { tooltipLeft } from '../../../shared/chart/tooltipPlacement'

/**
 * 资金流图上那块悬停读数浮层落在哪。
 *
 * **横向只有一条规则**，就是 `shared/chart/tooltipPlacement`：右边放得下放右边、放不下翻到左边、
 * 两边都放不下才兜底。这里不再写 clamp——旧写法「永远放右边、越界夹到右内边距」正是把浮层压在
 * 最右那几天上，而那几天恰好是读者要读的那一列。
 *
 * 纵向（放光标上方还是下方）仍归这张图：它只跟浮层高度有关，没有任何翻边语义。
 *
 * 尺寸与间距是这张图自己的数：`estimatedWidth` 必须与 `--mi-dashboard-etf-flow-tooltip-width`
 * 相等（有用例对账），`estimatedHeight` 与 CSS 里那四行内容大致同高。
 */
export const FLOW_TOOLTIP = { offset: 14, inset: 4, estimatedWidth: 176, estimatedHeight: 86 } as const

export type FlowTooltipPosition = Readonly<{ tooltipLeft: number; tooltipTop: number }>

export function placeFlowTooltip(input: Readonly<{ x: number; y: number; boxWidth: number; boxHeight: number }>): FlowTooltipPosition {
  const { x, y, boxWidth, boxHeight } = input
  const left = tooltipLeft({
    x,
    boxWidth,                          // 图表容器宽
    width: FLOW_TOOLTIP.estimatedWidth, // 浮层自身宽
    offset: FLOW_TOOLTIP.offset,
    inset: FLOW_TOOLTIP.inset
  })
  const maxTop = Math.max(FLOW_TOOLTIP.inset, boxHeight - FLOW_TOOLTIP.estimatedHeight - FLOW_TOOLTIP.inset)
  const above = y - FLOW_TOOLTIP.estimatedHeight - FLOW_TOOLTIP.offset
  const below = y + FLOW_TOOLTIP.offset
  const top = Math.min(maxTop, Math.max(FLOW_TOOLTIP.inset, above >= FLOW_TOOLTIP.inset ? above : below))
  return { tooltipLeft: left, tooltipTop: top }
}