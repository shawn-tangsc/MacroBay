import { useEffect, useState } from 'react'

/**
 * 窄窗口判定（界面规范 v2.39 §9f：< 1180 时左列表收成顶部下拉）。
 *
 * 为什么不只用 CSS：窄窗下**要换控件**（列表 → 下拉），换的是结构不是样式；
 * 而「名字与状态都进选项文本」也只有选项文本能做到——图标墙认不出是哪一条。
 */
export const NARROW_WINDOW_MAX_WIDTH = 1179

export function isNarrowWindow(width: number): boolean {
  return width <= NARROW_WINDOW_MAX_WIDTH
}

export function useNarrowWindow(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window === 'undefined' ? false : isNarrowWindow(window.innerWidth)
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = (): void => setNarrow(isNarrowWindow(window.innerWidth))
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return narrow
}
