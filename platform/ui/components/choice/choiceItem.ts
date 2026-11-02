import type { LucideIcon } from 'lucide-react'

/**
 * 项内图标的字形尺寸，`Tabs` 与 `Segmented` 共用这一个值。
 *
 * 14 与 `IconButton` 的 `sm` 档一致：这两件组件常出现在同一行页签/分组里，差 1px 就看得出来。
 * 字号是 12.5 / 12，图标比字大一号是刻意的——字形自己带内边距。
 *
 * 尺寸必须落在 SVG 的 `width`/`height` 属性上（`lucide` 的字形靠属性缩放）：只在 CSS 里给
 * 类名，SVG 会按 24 的默认尺寸撑开容器。
 */
export const CHOICE_GLYPH_PX = 14

/**
 * 一组互斥选项（契约 §7）：`Tabs` 与 `Segmented` 共用这一个类型，组件不合并、类型不各写一套。
 *
 * `value` 是**稳定标识**，不是下标：下标会随排序和增删漂移，存进设置里就成了错项。验收时判
 * `value` 是否来自 `items`。
 */
export type ChoiceItem = {
  /** 稳定标识；不接受下标。 */
  value: string
  /** 文案的 i18n 键；不收字面量。**必填**：图标不能替代文字，见 `icon`。 */
  labelKey: string
  /**
   * 填标签模板里 `{name}` 的值，**只收已经格式化好的字符串**（`3`、`3/5`）。
   *
   * 有些标签天生带计数（「内置工具 3/5」「MCP 2」）。没有它，调用点只能自己拼好句子塞进
   * `resolveText`，而「只收键」这条会立刻变成空话。与 `Drawer.titleParams`、`Popover.labelParams`
   * 同形，共用 `fillLabelParams` 一份实现。
   */
  labelParams?: Readonly<Record<string, string>>
  /**
   * 项前的图标。**只在「用户靠图标认项」时给**——例如主题切换的调色板/太阳/月亮。
   *
   * 两条边界：
   * - **`labelKey` 仍然必填，图标不能替代文字。** 读屏、页面内搜索、窄屏都只靠文字；一个只有
   *   图标的选项，对这三种读者等于不存在。
   * - **不给就不占位。** 图标是行内元素，没有固定宽度的包裹槽——否则没图标的那几项文字会整体
   *   后移，一排选项参差不齐，看着像漏渲染。
   *
   * 图标对读屏是 `aria-hidden`：它是文字的冗余辅助，不是第二个名字。真需要图标单独说话，
   * 那说明文字本身没写清，该改文案。
   */
  icon?: LucideIcon
  /** 禁用项：不进 Tab 序列、不响应方向键、也不挂提示。 */
  disabled?: boolean
}
