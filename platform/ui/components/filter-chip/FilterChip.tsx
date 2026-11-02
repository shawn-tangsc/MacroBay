import { Button } from 'antd'
import type { ReactElement, ReactNode } from 'react'

import './filterChip.css'

/**
 * 筛选胶囊（契约 §13；规格：界面设计 2026-11-02 三条）。
 *
 * 只做**可多选的筛选**：模型分类/协议、模型能力、协议筛选。它是「按下一个条件，列表缩小」，
 * 不是页内切换（那是 `Segmented`）、不是状态（那是 `StatusPill`）、不是分类展示（那是 `MetaChip`）。
 *
 * 四条写进结构、不靠评审：
 * - **选中态只由 `aria-pressed` 驱动**，样式选择器写 `[aria-pressed='true']`——「按下长什么样」
 *   和「读屏听到什么」同源，不可能分叉；不收 `.on` 类名、不收 `data-active`；
 * - **`opacity` 只表示禁用**，不许拿来画「未选中」：把「没选」和「不可用」画成同一种灰，
 *   读者会把可选项当成灰掉的；
 * - **计数收已格式化的字符串**（`3`、`1.2k` 由调用方格式化），显示在文字右侧；组件不做第二次格式化；
 * - **不收图标、不收系列色块**：图标会引出「这个图代表什么」的第二次解释；系列色块是数据语义，
 *   留在图例自己身上。禁用时必须有**看得见的说明**，本组件不提供 Tooltip——禁用元素接不到焦点，
 *   悬停提示对键盘用户等于不存在。
 *
 * 基础：包 antd `Button`。键盘、`type="button"`、禁用、焦点由它提供；外观仍是我们自己的
 * （高 24、胶囊、`aria-pressed` 驱动的选中态），覆盖清单见 `filterChip.css`。
 */

type FilterChipBase = {
  /** 筛选名的 i18n 键；不收字面量。 */
  labelKey: string
  /** 已格式化好的计数（`3`、`1.2k`）；省略即不渲染计数。组件不二次格式化。 */
  count?: string
  /** 当前是否按下。 */
  pressed: boolean
  /** 点击后给出**下一个值**，不是「请自己取反」——取反只许组件做一次。 */
  onPressedChange: (pressed: boolean) => void
  /** 禁用；旁边必须有看得见的说明，不能用 Tooltip 代替。 */
  disabled?: boolean
  /** 文案解析入口，由调用方注入。 */
  resolveText: (key: string) => string
  /**
   * 测试钩子与状态属性（`data-model-picker-category` 这类）。只收 `data-*` 键——
   * 与 `IconButton` 同一先例：独立 prop 而不是任意属性直传，避免 `width` 这类口子混进来。
   */
  dataAttributes?: Readonly<Record<`data-${string}`, string | number | boolean | undefined>>
}

export type FilterChipProps = FilterChipBase

/** 一组筛选胶囊的可访问名容器；多选/单选由调用点的组语义决定，本组件不猜。 */
export type FilterChipGroupProps = {
  /** 这一组筛选的名字（`aria-label`），收键。 */
  ariaLabelKey: string
  resolveText: (key: string) => string
  children: ReactNode
}

/** 只放 `data-*` 键进 DOM；传错当场抛错，不静默过滤（同 `IconButton`）。 */
function dataOnly(
  dataAttributes: FilterChipProps['dataAttributes']
): Record<string, string | number | boolean | undefined> {
  if (dataAttributes === undefined) return {}
  for (const key of Object.keys(dataAttributes)) {
    if (!key.startsWith('data-')) {
      throw new Error(`FilterChip dataAttributes accepts only data-* keys; received "${key}"`)
    }
  }
  return dataAttributes
}

export function FilterChip({
  labelKey,
  count,
  pressed,
  onPressedChange,
  disabled,
  resolveText,
  dataAttributes
}: FilterChipProps): ReactElement {
  return (
    <Button
      {...dataOnly(dataAttributes)}
      aria-pressed={pressed}
      className="filter-chip"
      disabled={disabled === true}
      onClick={() => onPressedChange(!pressed)}
      size="small"
      type="text">
      <span className="filter-chip__label">{resolveText(labelKey)}</span>
      {count === undefined || count === '' ? null : <span className="filter-chip__count">{count}</span>}
    </Button>
  )
}

export function FilterChipGroup({ ariaLabelKey, resolveText, children }: FilterChipGroupProps): ReactElement {
  return (
    <div aria-label={resolveText(ariaLabelKey)} className="filter-chip-group" role="group">
      {children}
    </div>
  )
}
