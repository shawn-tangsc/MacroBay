import type { ReactNode } from 'react'

/**
 * 设置行：**一行一件事**（界面规范 §8.2）。三处设置屏原来各写一套，形状相同、类名不同；
 * 这里只收**结构**，类名一律由调用方给——所以合并前后 DOM 与类名可以逐项不变。
 *
 * 固定的只有三件事，别处不许再各写一遍：
 * 1. **两列**：左边是「标签（+ ⓘ）」，右边是控件；控件**左缘对齐**标签列的右边界，
 *    不是右对齐（右对齐会让每行控件位置各不相同，整页看着就散）。
 * 2. **head 是可选的一层**：标签与 ⓘ 需要并排时由调用方给 `headClassName`，
 *    这样「标题与 ⓘ 同行」这个排版决定还在同一个地方（直接当兄弟放会掉到下一行）。
 * 3. **正文只允许字段名、当前值、控件**：整句说明只能进 ⓘ。这里**没有**放说明的槽，
 *    也不打算加——`check:body-prose` 与本组件自己的用例一起看着这条。
 *
 * 行高（44 / 60 / 84）、列宽（160）、间距（8 / 12 / 16）都在调用方的样式里，组件不写死：
 * 三处现有取值必须原样保留，合并只改结构来源，不改任何一个数。
 */
export type SettingsRowProps = {
  /** 行容器类名（调用方原样给，如 `notification-row` / `intelligence-setting-row`）。 */
  rowClassName: string
  /** 左侧「标签列」容器类名。 */
  copyClassName: string
  /** 标签与 ⓘ 并排时的那一层；不给就直接渲染标签。 */
  headClassName?: string
  /** 标签内容（含 ⓘ）。 */
  label: ReactNode
  /**
   * 右侧**控件容器**的类名。
   *
   * - **给了**：控件包一层带这个类名的容器；
   * - **没给**：控件**裸渲染，不包任何容器**——有的调用方自己渲染控件列（平台设置那处
   *   `SwitchRow` 的 DOM 里本来就没有控件容器），多包一层就是可见变化。
   *
   * 「包不包」是**调用方的事实**，不是组件的开关；所以用「有没有给这个 prop」表达，
   * 不用 `''` 与 `undefined` 两种写法打架。这条是为**保持 DOM 逐字不变**，不是偷懒。
   */
  controlWrapperClassName?: string
  /** 行容器上的额外属性（如 `data-row`）：这些必须留在**行**上，不能挪到子元素。 */
  rowAttributes?: Readonly<Record<string, string>>
  children?: ReactNode
}

export function SettingsRow({
  rowClassName,
  copyClassName,
  headClassName,
  label,
  controlWrapperClassName,
  rowAttributes,
  children
}: SettingsRowProps): React.ReactElement {
  return <div className={rowClassName} {...rowAttributes}>
    <span className={copyClassName}>
      {headClassName === undefined ? label : <span className={headClassName}>{label}</span>}
    </span>
    {controlWrapperClassName === undefined
      ? children
      : <div className={controlWrapperClassName}>{children}</div>}
  </div>
}
