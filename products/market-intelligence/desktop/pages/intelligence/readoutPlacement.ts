/**
 * 读数面板的落位——**唯一一处**决定它放哪边、翻不翻、夹不夹。
 *
 * 规则（按优先级）：
 * 1. 优先放光标右侧、上方；右侧放不下翻左侧；上方放不下翻下方（用户 2026-11-13 的「右边显示不下换左边」）。
 * 2. 每一边都要整块落在绘图区内（留 `MARGIN` 的内缩），**不许被容器裁掉**。
 * 3. 任何位置都**尽力不压住光标那一点**：横向留 `OFFSET` 的空隙，空隙做不到时换到另一侧或另一方向。
 *    **优先级是「在图内」高于「不压点」**：面板比图还宽/还高时（极窄窗口），几何上没有能同时满足两者的位置，
 *    这时保住「不被裁」——被裁是丢信息，压点是挡视线，前者更糟。
 * 键盘模式没有光标可跟，面板落在选中点上方居中；上方不够再翻到下方。
 *
 * 把这件事提成纯函数而不是留在组件里，是因为「翻边/夹边/不压点」三条各有个边界，
 * 用 DOM 量像素既慢又量不真；这里只要矩形和光标就能把四种边角逐条钉住。
 */
export const READOUT_OFFSET = 8
export const READOUT_MARGIN = 4

export type ReadoutRect = Readonly<{ left: number; top: number; width: number; height: number }>

export function placeReadout(input: Readonly<{
  stage: Readonly<{ width: number; height: number }>
  tip: Readonly<{ width: number; height: number }>
  point: Readonly<{ x: number; y: number }>
  /** 鼠标位置；键盘模式没有鼠标，靠 `point` 落位。 */
  pointer?: Readonly<{ x: number; y: number }>
}>): ReadoutRect {
  const { stage, tip } = input
  const maxLeft = Math.max(READOUT_MARGIN, stage.width - tip.width - READOUT_MARGIN)
  const maxTop = Math.max(READOUT_MARGIN, stage.height - tip.height - READOUT_MARGIN)
  const clampLeft = (left: number): number => Math.min(Math.max(left, READOUT_MARGIN), maxLeft)
  const clampTop = (top: number): number => Math.min(Math.max(top, READOUT_MARGIN), maxTop)
  const rectAt = (left: number, top: number): ReadoutRect => ({ left: clampLeft(left), top: clampTop(top), width: tip.width, height: tip.height })

  if (input.pointer === undefined) {
    // 键盘：没有光标可跟，面板落在选中点上方居中；上方不够翻到下方。
    const above = input.point.y - READOUT_OFFSET - tip.height
    return rectAt(input.point.x - tip.width / 2, above >= READOUT_MARGIN
      ? above
      : input.point.y + READOUT_OFFSET)
  }

  const { pointer, point } = input
  const right = pointer.x + READOUT_OFFSET
  const left = pointer.x - READOUT_OFFSET - tip.width
  const above = pointer.y - READOUT_OFFSET - tip.height
  const below = pointer.y + READOUT_OFFSET
  // 依次试四个组合：右/上、右/下、左/上、左/下。第一个「整块在图内且不压光标」的胜出。
  const candidates: ReadoutRect[] = []
  for (const x of [right, left]) {
    for (const y of [above, below]) {
      // 未夹边之前的原始矩形用来判「这一侧放不放得下」；夹边只用于最终保底。
      const fitsHorizontally = x >= READOUT_MARGIN && x + tip.width <= stage.width - READOUT_MARGIN
      const fitsVertically = y >= READOUT_MARGIN && y + tip.height <= stage.height - READOUT_MARGIN
      if (fitsHorizontally && fitsVertically) candidates.push(rectAt(x, y))
    }
  }
  const clear = candidates.find((rect) => !containsPoint(rect, pointer))
  if (clear) return clear
  // 一侧都放不下（很窄的图）：夹回图内，再尽量把光标那一点挪到面板外面去。
  const fallback = rectAt(right, below)
  if (!containsPoint(fallback, pointer)) return fallback
  const mirrored = rectAt(left, above)
  if (!containsPoint(mirrored, pointer)) return mirrored
  // 面板比图还高/还宽时几何上无解：保证「在图内」这条硬约束，压不压点让位。
  const awayFromPoint = rectAt(
    pointer.x < stage.width / 2 ? maxLeft : READOUT_MARGIN,
    point.y < stage.height / 2 ? maxTop : READOUT_MARGIN
  )
  return containsPoint(awayFromPoint, pointer) ? rectAt(left, above) : awayFromPoint
}

/** 矩形是否包含这个点（含 1px 容差：压着边也算压住）。 */
export function containsPoint(rect: ReadoutRect, point: Readonly<{ x: number; y: number }>): boolean {
  return point.x >= rect.left - 1 && point.x <= rect.left + rect.width + 1
    && point.y >= rect.top - 1 && point.y <= rect.top + rect.height + 1
}
