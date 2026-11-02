import { useCallback, useEffect, useState } from 'react'

import { handoffFocusAfterNavigation } from '@platform/workspace/navigation/navigationRequest'

/**
 * 导航后的焦点交接（契约 §14），从 `AppShell` 抽出来的一个 hook。
 *
 * 触发导航的空态按钮随即被卸载，不交接焦点就会掉回 `body`，读屏一声不响——而「点了有反应」
 * 还会被当成通过。调用方在导航成功后调一次 `scheduleHandoff()`；effect 在本轮渲染之后执行，
 * 目标元素此时已存在，所以**不需要 `setTimeout`**。
 *
 * 目标容器的取法只有两处，顺序固定：显式标记 `[data-nav-container]`，否则主内容区 `main`。
 */
export function useNavigationFocusHandoff(): () => void {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (tick === 0) return
    const container =
      document.querySelector<HTMLElement>('[data-nav-container]') ?? document.querySelector<HTMLElement>('main')
    handoffFocusAfterNavigation(container)
  }, [tick])

  return useCallback(() => setTick((current) => current + 1), [])
}
