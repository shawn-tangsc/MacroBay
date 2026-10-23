import { useEffect, useRef, useState, type KeyboardEventHandler, type PointerEventHandler } from 'react'

import type { WorkspaceSize } from '@platform/workspace/contracts'
import { clampPanelSize, WorkspaceUiPolicy, type DockedMode, type DockedRegion } from './workspacePresentation'

/**
 * Owner: apps/desktop-shell renderer / workspace 分隔条输入生命周期。
 * 权威：P1-03 纠偏裁决 §2（命中区、pointer 生命周期、clamp、键盘轴限制）。
 *
 * 约束：
 *  - 只在自己这个分隔条元素上处理对应轴的键盘方向键，绝不劫持正文输入；
 *  - pointer capture / pointerId 校验 / cancel / lostpointercapture / idle pointerup / 卸载后迟到事件全部收敛；
 *  - 拖动过程只上报预览尺寸，提交只在 pointerup 或键盘步进时发生一次；
 *  - 步长与上下限来自 WorkspaceUiPolicy 与注入的 pageMinSize，无匿名默认值。
 *
 * 回归：WorkspacePanelHost.test.tsx。
 */

export type WorkspaceSplitterInput = {
  /** 非停靠区域（embedded/detached）时为 null，钩子必须仍然无条件调用。 */
  mode: DockedMode | null
  /** 当前权威提交尺寸。 */
  size: WorkspaceSize
  pageSize: WorkspaceSize
  pageMinSize: WorkspaceSize
  panelMinSize: WorkspaceSize
  onPreview: (size: WorkspaceSize | null) => void
  onCommit: (size: WorkspaceSize) => void
}

export type WorkspaceSplitterHandle = {
  dragging: boolean
  previewSize: WorkspaceSize | null
  separatorProps: {
    onPointerDown: PointerEventHandler<HTMLDivElement>
    onPointerMove: PointerEventHandler<HTMLDivElement>
    onPointerUp: PointerEventHandler<HTMLDivElement>
    onPointerCancel: PointerEventHandler<HTMLDivElement>
    onLostPointerCapture: PointerEventHandler<HTMLDivElement>
    onKeyDown: KeyboardEventHandler<HTMLDivElement>
  }
}

export function useWorkspaceSplitter(input: WorkspaceSplitterInput): WorkspaceSplitterHandle {
  const inputRef = useRef(input)
  inputRef.current = input
  const [previewSize, setPreviewSize] = useState<WorkspaceSize | null>(null)
  const [dragging, setDragging] = useState(false)
  const activePointerId = useRef<number | null>(null)
  const lastCoordinate = useRef<number | null>(null)
  const rawSize = useRef<WorkspaceSize | null>(null)
  const captureTarget = useRef<HTMLElement | null>(null)

  const clampFor = (size: WorkspaceSize, current: WorkspaceSplitterInput): WorkspaceSize =>
    current.mode ? clampPanelSize(current.mode, size, current.pageSize, current.panelMinSize, current.pageMinSize) : size

  const regionFor = (mode: DockedMode): DockedRegion => (mode === 'docked-right' ? 'right' : 'bottom')
  const coordinateOf = (event: { clientX: number; clientY: number }, region: DockedRegion): number =>
    region === 'right' ? event.clientX : event.clientY

  const abort = (notify: boolean) => {
    activePointerId.current = null
    lastCoordinate.current = null
    rawSize.current = null
    captureTarget.current = null
    setDragging(false)
    setPreviewSize(null)
    if (notify) inputRef.current.onPreview(null)
  }

  // 纠偏 R3：拖动中卸载必须清掉未提交的预览，否则重开会把预览尺寸当成显示尺寸。
  useEffect(() => () => {
    activePointerId.current = null
    lastCoordinate.current = null
    rawSize.current = null
    captureTarget.current = null
    inputRef.current.onPreview(null)
  }, [])

  const handlePointerDown: PointerEventHandler<HTMLDivElement> = (event) => {
    const current = inputRef.current
    if (!current.mode || activePointerId.current !== null || event.button !== 0) return
    const region = regionFor(current.mode)
    activePointerId.current = event.pointerId
    lastCoordinate.current = coordinateOf(event, region)
    rawSize.current = current.size
    captureTarget.current = event.currentTarget
    setDragging(true)
    setPreviewSize(null)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // 环境不支持 pointer capture 时保留拖动能力，后续事件按 pointerId 校验。
    }
    event.preventDefault()
  }

  const handlePointerMove: PointerEventHandler<HTMLDivElement> = (event) => {
    const current = inputRef.current
    const previous = lastCoordinate.current
    if (!current.mode || activePointerId.current !== event.pointerId || previous === null) return
    const region = regionFor(current.mode)
    const coordinate = coordinateOf(event, region)
    const base = rawSize.current ?? current.size
    const delta = previous - coordinate
    const raw = region === 'right' ? { ...base, width: base.width + delta } : { ...base, height: base.height + delta }
    lastCoordinate.current = coordinate
    rawSize.current = raw
    const next = clampFor(raw, current)
    setPreviewSize(next)
    current.onPreview(next)
  }

  const finish = (commit: boolean) => {
    const raw = rawSize.current
    const current = inputRef.current
    const target = captureTarget.current
    const pointerId = activePointerId.current
    abort(false)
    if (target && pointerId !== null) {
      try {
        target.releasePointerCapture(pointerId)
      } catch {
        // capture 可能已被环境自动释放。
      }
    }
    current.onPreview(null)
    if (commit && raw) current.onCommit(clampFor(raw, current))
  }

  const handlePointerUp: PointerEventHandler<HTMLDivElement> = (event) => {
    if (activePointerId.current === null || activePointerId.current !== event.pointerId) return
    finish(true)
  }

  const handlePointerCancel: PointerEventHandler<HTMLDivElement> = (event) => {
    if (activePointerId.current === null || activePointerId.current !== event.pointerId) return
    finish(false)
  }

  const handleLostPointerCapture: PointerEventHandler<HTMLDivElement> = (event) => {
    if (activePointerId.current === null || activePointerId.current !== event.pointerId) return
    finish(false)
  }

  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    const current = inputRef.current
    if (!current.mode) return
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const region = regionFor(current.mode)
    const allowed = region === 'right' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
    if (!allowed.includes(event.key)) return
    const grow = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
    const step = grow ? WorkspaceUiPolicy.keyboardStep : -WorkspaceUiPolicy.keyboardStep
    const next = region === 'right'
      ? { ...current.size, width: current.size.width + step }
      : { ...current.size, height: current.size.height + step }
    event.preventDefault()
    current.onCommit(clampFor(next, current))
  }

  return {
    dragging,
    previewSize,
    separatorProps: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
      onLostPointerCapture: handleLostPointerCapture,
      onKeyDown: handleKeyDown
    }
  }
}
