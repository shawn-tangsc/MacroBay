import { useEffect, useRef } from 'react'

import type { ChoiceItem } from './choiceItem'

/**
 * 选中值失效时的兜底（契约 §7 第 193 行）。
 *
 * `items` 增删是常态：设置项没了、权限掉了、数据源删了，而父级状态里还留着旧值。如果这时
 * 所有项都是 `tabIndex=-1`，整组就从 Tab 序列里消失——键盘用户进不去，而且看不出原因。
 *
 * 兜底三条件缺一不可：
 * 1. 只在 `value` **不在 `items` 里**时触发；
 * 2. 只在**存在可用项**时触发；
 * 3. **只触发一次**——用 ref 记住已经上报过的过期值；父级回声回来后值已合法，不会二次触发。
 *
 * 两条实现约束：
 * - 必须在 effect 里调，不许在渲染期间调：渲染期回调会触发父级 setState，React 会报错并可能成环；
 * - 门闩按**过期值**记，不按 `items` 引用记：`items` 常常是内联数组字面量，引用每帧都变，
 *   按引用记会让 effect 每帧重跑，变成死循环。
 */
export function useChoiceFallback(
  items: readonly ChoiceItem[],
  value: string,
  onChange: (value: string) => void
): void {
  const reported = useRef<string | null>(null)

  useEffect(() => {
    if (items.some((item) => item.value === value)) {
      // 值重新合法了：门闩复位，下一次过期还能再报一次。
      reported.current = null
      return
    }
    const first = items.find((item) => item.disabled !== true)
    if (first === undefined) return
    if (reported.current === value) return
    reported.current = value
    onChange(first.value)
  }, [items, value, onChange])
}

/**
 * 「键盘入口」落在哪一项：选中且可用的那一项；它不存在时兜底首个可用项。
 * 两个组件共用，避免各自写一份兜底逻辑。
 */
export function resolveActiveValue(items: readonly ChoiceItem[], value: string): string | undefined {
  const selected = items.find((item) => item.value === value && item.disabled !== true)
  if (selected !== undefined) return selected.value
  return items.find((item) => item.disabled !== true)?.value
}
