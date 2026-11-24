import { useEffect, useRef } from 'react'

import { wheelGesture, type WheelSession } from './analysisDrawerDrag'

/**
 * 触摸板两指横向滑：往左滑弹出右侧抽屉，开着时反向滑收起。
 *
 * 只做监听与生命周期判定，判据在 `analysisDrawerDrag.ts` 的 `wheelGesture`（纯函数）。
 * 三条不抢：**起点在横向可滚区域里**（那一片自己管横滑）、**抽屉正在被拖动**、
 * **底部聊天框开着**（两个面互斥，先关它）。
 */

/** 起点是否落在横向可滚的区域里：那种容器自己管横滑，我们不许抢。 */
function startsInHorizontalScroller(target: EventTarget | null, root: HTMLElement | undefined): boolean {
  let node = target instanceof HTMLElement ? target : null
  while (node && node !== root) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflowX = window.getComputedStyle(node).overflowX
      if (overflowX === 'auto' || overflowX === 'scroll') return true
    }
    node = node.parentElement
  }
  return false
}

export function useAnalysisDrawerWheel(input: Readonly<{
  /** 窄档才接：宽档一行不动。 */
  enabled: boolean
  open: boolean
  /** 底部聊天框开着：两个面互斥，这时横滑不抢。 */
  blocked: boolean
  /** 抽屉正在被拖动：拖动跟手优先。 */
  dragging: boolean
  /** 舞台（布局根），用来判断起点是否在横向可滚区域里。 */
  root: () => HTMLElement | undefined
  onOpenChange: (open: boolean) => void
}>): void {
  const latest = useRef(input)
  latest.current = input
  useEffect(() => {
    if (!input.enabled) return
    let session: WheelSession | undefined
    const onWheel = (event: WheelEvent) => {
      const now = latest.current
      if (now.dragging || now.blocked) return
      if (startsInHorizontalScroller(event.target, now.root())) { session = undefined; return }
      const decision = wheelGesture(session, { deltaX: event.deltaX, deltaY: event.deltaY, now: Date.now() })
      session = decision.session
      if (!decision.fired || decision.session === undefined) return
      const direction = decision.session.direction
      session = undefined
      // 按**手指方向**：往左滑（自然滚动下 deltaX < 0）→ 右侧抽屉弹出；开着时反向滑 → 收起。
      if (direction < 0 && !now.open) { event.preventDefault(); now.onOpenChange(true) }
      else if (direction > 0 && now.open) { event.preventDefault(); now.onOpenChange(false) }
    }
    // `passive: false`：到阈值那一发要 `preventDefault()`，别让页面跟着横滚。
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [input.enabled])
}
