import { useRef } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'

import type { ChoiceItem } from '../choice/choiceItem'

import './segmented.css'

/**
 * 分段选择（规格同 `Tabs`；契约 §7）。判据：**同一块内容换一个取值 → `Segmented`**；
 * 切换后换一整块内容归 `Tabs`。两者不合并、不用 `mode` 开关。
 *
 * 与 `Tabs` 的差别全在语义上，不在外观上：这里是**一组互斥取值**，不是页签。所以
 * - 容器是 `role="group"`，按下的那个是 `aria-pressed="true"`（不是 `aria-selected`）；
 * - 键盘 ←→ 只**移动焦点**，Enter / Space 才选中——移动即生效在这里是错的：
 *   同一块内容换取值，读者往往要先看两三个再定；
 * - 禁用项不进 Tab 序列、不参与方向键，也不挂提示。
 */

export type SegmentedProps = {
  items: readonly ChoiceItem[]
  value: string
  onChange: (value: string) => void
  /** 这一组取值的可访问名（键），必填。 */
  ariaLabelKey: string
  resolveText: (key: string) => string
}

export function Segmented({ items, value, onChange, ariaLabelKey, resolveText }: SegmentedProps): ReactElement {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const enabled = items.map((item, index) => ({ item, index })).filter(({ item }) => item.disabled !== true)

  function focusAt(index: number, delta: 1 | -1): void {
    if (enabled.length === 0) return
    const position = enabled.findIndex(({ index: candidate }) => candidate === index)
    const next = enabled[(position + delta + enabled.length) % enabled.length]
    if (next) refs.current[next.index]?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>, index: number): void {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusAt(index, 1)
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusAt(index, -1)
      return
    }
    const item = items[index]
    if ((event.key === 'Enter' || event.key === ' ') && item && item.disabled !== true) {
      event.preventDefault()
      onChange(item.value)
    }
  }

  return (
    <div aria-label={resolveText(ariaLabelKey)} className="segmented" role="group">
      {items.map((item, index) => {
        const selected = item.value === value
        return (
          <button
            aria-pressed={selected}
            className={['segmented__item', selected ? 'segmented__item--selected' : ''].filter(Boolean).join(' ')}
            disabled={item.disabled === true}
            key={item.value}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            ref={(node) => {
              refs.current[index] = node
            }}
            tabIndex={selected ? 0 : -1}
            type="button">
            {resolveText(item.labelKey)}
          </button>
        )
      })}
    </div>
  )
}
