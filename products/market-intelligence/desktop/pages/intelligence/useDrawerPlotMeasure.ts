import { useCallback, useEffect, useRef, useState } from 'react'

import { nextMeasuredSize } from './macroIndicatorDrawerMeasure'

/**
 * 抽屉里两张图（读数曲线、政策卡）的尺寸：0 表示**还没量到**。
 *
 * 结构约定（这块已经三次跑出格子：横条、面板被裁、整张图压到右边的卡上）：
 * **图、读数面板、事件标注，任何一部分都不许出现在自己的盒子之外。**
 * 所以尺寸只认量到的值，量不到就不画；不要用「先给一个默认宽高」「给个地板」
 * 「用 overflow 裁掉」这三种方式兜底——前两种会画到格子外，第三种会把面板一起裁掉。
 *
 * 单拉成 hook 是为了让视图那层只剩「把量到的数字交给图」，测量这条链（回调 ref、ResizeObserver、
 * 卸载时断开）在一处讲完。
 */
export type DrawerPlotMeasure = Readonly<{
  plotWidth: number
  plotHeight: number
  /** 图表格子的回调 ref。 */
  attachPlot: (node: HTMLDivElement | null) => void
  /** 政策卡槽位的回调 ref（行高由卡的内容决定）。 */
  attachHero: (node: HTMLDivElement | null) => void
}>

export function useDrawerPlotMeasure(): DrawerPlotMeasure {
  const [plotWidth, setPlotWidth] = useState(0)
  const [plotHeight, setPlotHeight] = useState(0)
  const plotRef = useRef<HTMLDivElement | null>(null)
  const heroRef = useRef<HTMLDivElement | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)

  const measure = useCallback(() => {
    // 写回值永远来自「量到的那个数」：量不到（首帧 clientWidth=0）就保持上一次的值，
    // 不给自己任何地板宽度/高度——地板正是「量 340 写 380」这种自激的入口。
    const host = plotRef.current
    setPlotWidth((previous) => nextMeasuredSize(previous, host ? Math.floor(host.clientWidth) : 0))
    // 行高由卡片内容决定：量卡本身（它的第一个子元素），不是量被拉伸过的槽位。
    const card = heroRef.current?.firstElementChild ?? heroRef.current
    if (card) setPlotHeight((previous) => nextMeasuredSize(previous, Math.ceil(card.getBoundingClientRect().height)))
  }, [])

  /**
   * 用**回调 ref** 量尺寸，而不是挂在组件上的 `useLayoutEffect`。
   *
   * 抽屉的内容是 antd 在打开后挂进来的：组件的 layout effect 第一次跑时 `.mk-plot` 还没挂上
   * （实测 `plotRef.current === null`），于是尺寸一直是 0；以前用 560/264 的初始值掩盖了这件事，
   * 而那个假尺寸正是「整张图比格子宽、压到右边卡片」的来源。回调 ref 在节点真正挂上时触发，
   * 量到的就是真实盒子；ResizeObserver 跟上后续的尺寸变化。
   */
  const attachPlot = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    plotRef.current = node
    if (!node) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    if (heroRef.current) observer.observe(heroRef.current)
    observerRef.current = observer
  }, [measure])

  const attachHero = useCallback((node: HTMLDivElement | null) => {
    heroRef.current = node
    measure()
    if (node && observerRef.current) observerRef.current.observe(node)
  }, [measure])

  useEffect(() => () => observerRef.current?.disconnect(), [])

  return { plotWidth, plotHeight, attachPlot, attachHero }
}
