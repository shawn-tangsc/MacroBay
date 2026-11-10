import type { ReactElement } from 'react'

/**
 * 来源列表顶部的**六筛选条**（全部 + 日历 / 看板 / 舆情 / 待接入 / 进阶）。
 *
 * 受控组件：`tab` / `onTab` 都由宿主给，组件**不持有状态**——筛选是页面的状态，
 * 组件里再存一份就会出现「点了、列表没变」的第二种真相。
 *
 * 文案零字面量：标签与分组名都由宿主解析好传进来（`labels.group` + `labels.items`），
 * 六项与宿主现有 `FILTERS` 一一对应（顺序、可访问名都跟它）。
 *
 * 形状照 C5 原型：一排 chip，当前项用 `aria-pressed` 表达选中，不用第二套 `aria-current`。
 */
export type SourceFilterTabItem = Readonly<{
  value: string
  /** 已解析的读者用词。 */
  label: string
}>

export function SourceFilterTabs(props: Readonly<{
  /** 当前筛选（宿主状态）。 */
  tab: string
  onTab: (value: string) => void
  labels: Readonly<{
    /** 这一组的可访问名（「来源筛选」之类），由宿主解析。 */
    group: string
    items: readonly SourceFilterTabItem[]
  }>
}>): ReactElement {
  return <div
    aria-label={props.labels.group}
    className="intelligence-filter-tabs"
    role="group">
    {props.labels.items.map((item) => <button
      aria-pressed={item.value === props.tab}
      className="intelligence-filter-tabs__chip"
      key={item.value}
      onClick={() => props.onTab(item.value)}
      type="button">
      {item.label}
    </button>)}
  </div>
}
