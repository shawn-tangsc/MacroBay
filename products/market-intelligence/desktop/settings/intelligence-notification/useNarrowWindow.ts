import { useEffect, useState } from 'react'

/**
 * 三列版式的宽度策略（界面规范 v2.40 §9f），数字全部来自规范，不许自选：
 *
 * - 导航列 236 固定（外壳的，不在本页）；
 * - **列表列 232 固定（最小 220）**——固定列被压缩就是「模块信 / 号触发」那种逐字换行；
 * - **详情列吃掉剩余宽度，且 `min-width: 0`**（没有它，长内容会把栅格撑破）；
 * - 断点 **1080**（规范 §9f 定值）：236（导航）+ 220（列表最小）+ 48（内边距）+ 560（详情下限）
 *   = 1064，向上取 1080。低于它就换控件（列表 → 顶部下拉），**不是继续挤压**。
 *
 * 一处如实说明：这页量的是**自己**的宽度（导航不在其中），按同一批数字，本页自身的最小需求
 * 其实是 48 + 220 + 20（间隙）+ 560 = 848 → 860；沿用 1080 会让 860–1080 这段明明排得下三列
 * 却切下拉。规范定的是 1080，这里照规范执行，并把差值记在这里，等规范复核后再动一个数。
 *
 * 为什么量「这一页」而不是「窗口」：这一页挂在三列里，窗口 1280 时它可能只剩 600——
 * 按窗口判会把三列继续挤在一起。
 */
export const SECTION_COLUMNS_MIN_WIDTH = 1080
export const LIST_COLUMN_WIDTH = 232
export const DETAIL_COLUMN_MIN_WIDTH = 560
const COLUMN_GAP = 20

export type NotificationLayout = Readonly<{
  mode: 'columns' | 'dropdown'
  listWidth: number
  detailWidth: number
}>

export function resolveNotificationLayout(sectionWidth: number): NotificationLayout {
  if (sectionWidth > 0 && sectionWidth < SECTION_COLUMNS_MIN_WIDTH) {
    return { mode: 'dropdown', listWidth: 0, detailWidth: sectionWidth }
  }
  const width = sectionWidth > 0 ? sectionWidth : SECTION_COLUMNS_MIN_WIDTH
  return { mode: 'columns', listWidth: LIST_COLUMN_WIDTH, detailWidth: width - LIST_COLUMN_WIDTH - COLUMN_GAP }
}

export function useNotificationLayout(): Readonly<{
  /** 回调 ref：加载态与就绪态是两个不同的节点，用 RefObject 只会量到第一个（空）就再也不看。 */
  setSectionRef: (element: HTMLElement | null) => void
  layout: NotificationLayout
}> {
  const [width, setWidth] = useState(0)
  const [element, setElement] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!element) return
    const measure = (): void => {
      // `clientWidth` 在测试环境里常是 0；那时退回窗口宽度，保证「宽窗」是默认形态。
      setWidth(element.clientWidth > 0 ? element.clientWidth : window.innerWidth)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return { setSectionRef: setElement, layout: resolveNotificationLayout(width) }
}
