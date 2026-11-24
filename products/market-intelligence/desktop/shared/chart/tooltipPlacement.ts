/**
 * 悬停读数浮层（光字牌）放在光标的哪一边：**右边放得下就放右边，放不下翻到左边，两边都放不下才兜底**。
 *
 * 规则只有这一份。两个图表各写一遍，下一个人改阈值就只会改一处——旧写法「永远放右边、越界夹到
 * 右内边距」正是这么长出来的：最右边那几天是读者要看的那一列，210 宽的浮层被夹在那里正好盖住它。
 * 翻边不是夹边：夹边把浮层压在光标上，翻边让它落在光标左侧、把被读的那一列让出来。
 *
 * 参数全部由调用方给，不写死：`width` 是浮层宽度，`offset` 是它离光标的间距，`inset` 是离框边的
 * 安全距。三个派生量都从这里算，CALLER 只报三个数：
 * `FIT = offset + width + inset`、`FLIP = offset + width`、`SPAN = width + inset`。
 *
 * 闭环不等式（「含等号」在哪一边是刻意的，改阈值前先读这一段）：
 * - 右放得下 ⇔ `x ≤ boxWidth − FIT`：那一点 `left = boxWidth − SPAN`，右边缘正好 `boxWidth − inset`；
 * - 转左 ⇔ `x > boxWidth − FIT`，最小转左点 `x = boxWidth − FIT + 1` → `left = x − FLIP`；
 * - 左放得下 ⇔ `x ≥ FIT`（`left = inset` 那一点就在 `x = FIT`）；它只在右侧放不下时才轮到——
 *   两边都放得下取右侧，免得浮层在还能放右边时先跳到左边；
 * - 都不满足只在框宽小于 `2·FIT` 时出现 → 先取剩余更宽的一侧，再夹进 `[inset, boxWidth − SPAN]`，
 *   这一档允许压住光标。
 *
 * 兜底不缩窄、不换行：浮层是几行读数、数值列右对齐，一缩窄同一份数据在两个宽度下就成了两种排法。
 */
export type TooltipPlacement = Readonly<{
  /** 光标（十字线）在框内的横坐标，不是指针像素——否则线还没走到右边，浮层就先翻了。 */
  x: number
  /** 框宽（图表容器宽度）。 */
  boxWidth: number
  /** 浮层宽度。 */
  width: number
  /** 浮层与光标之间的间距。 */
  offset: number
  /** 浮层与框边之间的安全距。 */
  inset: number
}>

export function tooltipLeft({ x, boxWidth, width, offset, inset }: TooltipPlacement): number {
  const fit = offset + width + inset
  const flip = offset + width
  const span = width + inset
  if (boxWidth - x >= fit) return x + offset
  if (x >= fit) return x - flip
  const preferred = boxWidth - x >= x ? x + offset : x - flip
  const ceiling = Math.max(inset, boxWidth - span)
  return Math.min(Math.max(inset, preferred), ceiling)
}
