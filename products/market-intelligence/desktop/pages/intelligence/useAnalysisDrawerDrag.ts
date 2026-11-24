import { useEffect, useRef, useState } from 'react'

import { ANALYSIS_DRAWER_DRAG, dragDecision, dragOffsetFor, dragOriginAt, snapsOpen, type DrawerRect } from './analysisDrawerDrag'

/**
 * 抽屉拖动的状态机：按下 → 判门槛 → 跟手 → 松手吸附/回弹。
 *
 * 判据全在 `analysisDrawerDrag.ts`（纯函数、可单测）；这里只管生命周期与 DOM 监听。
 *
 * 三条必须守住：
 * - **拖动中 0ms 过渡、松手才 160ms ease-out**：跟手时加过渡就是延迟，回弹不加过渡就是瞬移。
 * - **交回滚动后不再抢**：竖直占优那一刻丢掉手势，后续位移只当滚动。
 * - **拖出后不自动收回**：这里没有 `pointerleave`，收回只有 X 与 Esc（整幅档也没有遮罩可点）。
 */

export type AnalysisDrawerDragState = 'idle' | 'dragging' | 'settling'

type Gesture = {
  x: number
  y: number
  origin: 'edge' | 'stage'
  pointerId: number
  dragging: boolean
}

export function useAnalysisDrawerDrag(input: Readonly<{
  /** 抽屉靠哪一边（与样式同一个常量）。 */
  edge: 'left' | 'right'
  /** 窄档才接：宽档一行不动。 */
  enabled: boolean
  /** 抽屉宽（并排 340、整幅页宽）：跟手 1:1 与吸附线都按它算。 */
  width: number
  /** 已经稳定开着：这时不接新的拖动（只能 X / Esc 关）。 */
  open: boolean
  /** 底部聊天框开着：两个面互斥，这时右缘拖也不动。 */
  blocked: boolean
  /** 舞台矩形＝布局根（页内容区）。 */
  stage: () => DrawerRect | undefined
  /** 圆钮命中矩形：起拖条要刨掉它。 */
  button: () => DrawerRect | undefined
  onOpenChange: (open: boolean) => void
}>): Readonly<{ offset: number; state: AnalysisDrawerDragState; onPointerDown: (event: React.PointerEvent<HTMLElement>) => void }> {
  const [offset, setOffset] = useState(0)
  const [state, setState] = useState<AnalysisDrawerDragState>('idle')
  const gesture = useRef<Gesture | null>(null)
  const offsetNow = useRef(0)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // 每次渲染都换一份最新输入：监听只绑一次，读的是这一份，不会读到旧闭包。
  const latest = useRef(input)
  latest.current = input

  useEffect(() => {
    if (!input.enabled) return
    const onMove = (event: PointerEvent) => {
      const current = gesture.current
      if (!current || event.pointerId !== current.pointerId) return
      const { edge, width } = latest.current
      const dx = (edge === 'right' ? -1 : 1) * (event.clientX - current.x)
      const dy = Math.abs(event.clientY - current.y)
      if (!current.dragging) {
        const decision = dragDecision({ origin: current.origin, dx, dy })
        // 竖直占优：整次手势交回滚动，中途不再抢。
        if (decision === 'handoff') { gesture.current = null; return }
        if (decision !== 'drag') return
        current.dragging = true
        setState('dragging')
      }
      // 拖动期间禁止选中文字（也不让图的框选/双击吃到这一下）。
      event.preventDefault()
      const next = dragOffsetFor(dx, width)
      offsetNow.current = next
      setOffset(next)
    }
    const onEnd = () => {
      const current = gesture.current
      gesture.current = null
      if (!current?.dragging) return
      const { width, onOpenChange } = latest.current
      const snapped = snapsOpen(offsetNow.current, width)
      offsetNow.current = 0
      setOffset(0)
      setState('settling')
      onOpenChange(snapped)
      settleTimer.current = setTimeout(() => setState('idle'), ANALYSIS_DRAWER_DRAG.settleMs)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      if (settleTimer.current !== undefined) clearTimeout(settleTimer.current)
    }
  }, [input.enabled])

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    const { enabled, open, blocked, edge, stage, button } = latest.current
    if (!enabled || open || blocked) return
    if (event.button !== 0) return
    // 抽屉与聊天框自己里面不起拖（那里的话是选中文字、点按钮）。
    const target = event.target as HTMLElement
    if (typeof target.closest === 'function' && target.closest('[data-analysis-drawer], [data-agent-sheet]')) return
    const stageRect = stage()
    if (!stageRect) return
    const origin = dragOriginAt({ x: event.clientX, y: event.clientY, stage: stageRect, edge, button: button() })
    // 圆钮矩形：那块优先归圆钮（位移 ≥ 8px 取消点击由按钮自己管），这里不许起拖。
    if (origin === 'button') return
    gesture.current = { x: event.clientX, y: event.clientY, origin, pointerId: event.pointerId, dragging: false }
  }

  return { offset, state, onPointerDown }
}
