import { useId, useRef } from 'react'
import type { KeyboardEvent, ReactElement, ReactNode } from 'react'

import type { ChoiceItem } from '../choice/choiceItem'
import { CHOICE_GLYPH_PX } from '../choice/choiceItem'
import { resolveActiveValue, useChoiceFallback } from '../choice/useChoiceValue'

import './tabs.css'
import { fillLabelParams } from '../textKeyParams'

/**
 * 页内标签（规格：`docs-private/05-desktop/ui-audit/2026-11-02-tabs-segmented.html`；契约 §7）。
 *
 * 判据只有一条：**切换后换了一整块内容 → `Tabs`**；同一块内容换一个取值归 `Segmented`。
 * 两者不合并、不用 `mode` 开关——交互、ARIA、键盘都不同，合并只能靠布尔，而布尔是被禁的。
 *
 * 写进结构、不靠评审：
 * - `value` 是稳定标识，不是下标；下标会随排序漂移；
 * - `aria-controls` / `aria-labelledby` 由组件用 `useId` 生成，**调用方不传 id**——两边各写一套必然对不上；
 * - 键盘：←→ 即时切换（这道交互本来就是「切过去就看」），Home/End 到首尾；
 * - 禁用项不进 Tab 序列、也不参与方向键；面板里的加载/空/出错由 `LoadingState` / `StateView` 承担，
 *   标签条自己永远不显示转圈。
 */

export type TabsProps = {
  items: readonly ChoiceItem[]
  /** 当前选中项的 `value`。 */
  value: string
  onChange: (value: string) => void
  /** tablist 可访问名（键），必填：读屏要靠它知道这是哪一组标签。 */
  ariaLabelKey: string
  resolveText: (key: string) => string
  /**
   * 每个页签的面板，按 `value` 取。**全部渲染**，非活动的只加原生 `hidden`。
   *
   * 为什么不是「只渲染选中那块」：切走再切回时，另一半里的会话、选中项、拖拽宽度都会丢。
   * 键盘对了、状态没了，比不做更糟。所以这里换成「每个 key 一块、全部挂载」。
   *
   * 划清职责：**保持挂载 ≠ 继续运行**。组件不替调用方暂停计时器、轮询或订阅，也不提供可见性回调——
   * 调用方手里已经有 `value`，自己判断就够了。组件一旦「猜哪个面板该停」，就会有人以为不需要自己判断。
   */
  panels: Readonly<Record<string, ReactNode>>
}

export function Tabs({ items, value, onChange, ariaLabelKey, resolveText, panels }: TabsProps): ReactElement {
  const baseId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const tabId = (index: number): string => `${baseId}-tab-${index}`
  const panelId = (index: number): string => `${baseId}-panel-${index}`

  const enabled = items.map((item, index) => ({ item, index })).filter(({ item }) => item.disabled !== true)
  // 选中值失效时兜底首个可用项：只兜显示不回调，就会「看着是 A、动起来是 B」。
  useChoiceFallback(items, value, onChange)
  // 「哪一项是选中」只有这一个来源：aria-selected、选中样式、面板的 aria-labelledby 全看它。
  // 只改 tabIndex 会让 tablist 里一个选中项都没有——键盘进得来，但看不出落在哪。
  const activeValue = resolveActiveValue(items, value)
  const activeIndex = items.findIndex((item) => item.value === activeValue)

  function move(from: number, delta: 1 | -1): void {
    if (enabled.length === 0) return
    const position = enabled.findIndex(({ index }) => index === from)
    const next = enabled[(position + delta + enabled.length) % enabled.length]
    if (!next) return
    onChange(next.item.value)
    // 即时切换后把焦点带到新选中的标签上，读屏才会跟着念。
    listRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(next.index))}`)?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>, index: number): void {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      move(index, 1)
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      move(index, -1)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      const first = enabled[0]
      if (first) {
        onChange(first.item.value)
        listRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(first.index))}`)?.focus()
      }
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      const last = enabled[enabled.length - 1]
      if (last) {
        onChange(last.item.value)
        listRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(last.index))}`)?.focus()
      }
    }
  }

  return (
    <div className="tabs">
      <div aria-label={resolveText(ariaLabelKey)} className="tabs__list" ref={listRef} role="tablist">
        {items.map((item, index) => {
          const selected = item.value === activeValue
          return (
            <button
              aria-controls={panelId(index)}
              aria-selected={selected}
              className={['tabs__tab', selected ? 'tabs__tab--selected' : ''].filter(Boolean).join(' ')}
              disabled={item.disabled === true}
              id={tabId(index)}
              key={item.value}
              onClick={() => onChange(item.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
              role="tab"
              tabIndex={item.value === activeValue ? 0 : -1}
              type="button">
              {item.icon === undefined ? null : (
                <item.icon aria-hidden="true" className="choice-item__glyph" size={CHOICE_GLYPH_PX} />
              )}
              {fillLabelParams(resolveText(item.labelKey), item.labelParams)}
            </button>
          )
        })}
      </div>
      {items.map((item, index) => (
        <div
          aria-labelledby={tabId(index)}
          className="tabs__panel"
          hidden={item.value !== activeValue}
          id={panelId(index)}
          key={item.value}
          role="tabpanel">
          {panels[item.value]}
        </div>
      ))}
    </div>
  )
}
