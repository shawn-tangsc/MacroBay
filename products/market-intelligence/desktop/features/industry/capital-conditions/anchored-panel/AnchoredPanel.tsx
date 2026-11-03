import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'

import { overlayContainer } from '@platform/ui/components/overlayContainer'

import './anchoredPanel.css'

/**
 * 锚定内容面板：点触发器开，面板浮在触发器（或指定锚点）下方，装得下可交互内容。
 *
 * 与平台 `Popover` 的分工：`Popover` 只放分行文字、焦点不进内容；要放表格这种能 Tab 进去的
 * 东西就得有这里。定位、关闭、焦点全部只在本文件实现一次 —— 调用点不许再写一份，否则第三个
 * 消费点会照抄第三遍（这正是这个组件存在的理由）。
 *
 * 契约要点：
 * - 触发器由调用方渲染，这里只交属性；面板内容走 `children`。
 * - 挂 `body`（`overlayContainer`），不随祖先裁切；`position: fixed`。
 * - 锚点可与触发器分离（按钮在标题、面板要从图下方出来）：`anchor` 给节点或 ref，缺省用触发器。
 *   分离模式下**只向下、不翻上**（翻上会盖住用户要截图的内容），也没有指针离开关闭。
 * - 关闭：再点触发器 / Esc / 点外部；分离模式不按指针离开关。Esc 把焦点还给触发器，点外部不抢焦点。
 * - 焦点：键盘打开进面板；鼠标打开留触发器，按 Tab 时把焦点送进面板（面板在 body 上，DOM 顺序
 *   里够不着，这道桥必须有）。焦点离开面板/表 → 关并回触发器。
 * - 宽按内容、上限视口减 16；高上限 320、超了面板内纵向滚；调用点不收像素。
 * - 角色是非模态 `dialog`：不带遮罩、不锁焦点，但有名字。
 */

export type AnchoredPanelTriggerProps = {
  ref: (node: HTMLElement | null) => void
  onSelect: (event: ReactMouseEvent<HTMLElement>) => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
  expanded: boolean
  hasPopup: 'dialog'
  controls?: string
}

type AnchorTarget = HTMLElement | RefObject<HTMLElement | null> | null | undefined

export type AnchoredPanelProps = {
  trigger: (props: AnchoredPanelTriggerProps) => ReactElement
  /** 面板的可访问名；只收键，句子由调用方解析。 */
  labelKey: string
  resolveText: (key: string) => string
  children: ReactNode
  /** 位置锚。不传就锚在触发器上；传了就把位置与触发器拆开。 */
  anchor?: AnchorTarget
}

type Placement = { left: number; top: number; width: number; maxHeight: number; visible: boolean }

const GAP = 4
const VIEWPORT_INSET = 8
const POINTER_LEAVE_DELAY = 120
const MAX_HEIGHT = 320
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const hiddenPlacement: Placement = { left: 0, top: 0, width: 0, maxHeight: MAX_HEIGHT, visible: false }

export function AnchoredPanel({ trigger, labelKey, resolveText, children, anchor }: AnchoredPanelProps): ReactElement {
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<Placement>(hiddenPlacement)
  const triggerRef = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 锚点与触发器分开时，行为按分离那一档走。 */
  const separated = anchor !== undefined

  const close = useCallback((returnFocus: boolean): void => {
    setOpen(false)
    setPlacement(hiddenPlacement)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  const anchorElement = useCallback((): HTMLElement | null => {
    if (anchor === undefined || anchor === null) return triggerRef.current
    return anchor instanceof HTMLElement ? anchor : anchor.current
  }, [anchor])

  // 定位：只读锚点矩形，向下放；分离档不翻上，空间不够就截高、面板内部滚。
  useLayoutEffect(() => {
    if (!open) return undefined
    const measure = (): void => {
      const panel = panelRef.current
      const target = anchorElement() ?? triggerRef.current
      if (!panel) return
      if (!target || !target.isConnected) {
        // 锚点连同图一起卸载了：面板不能停在旧坐标。
        setOpen(false)
        setPlacement(hiddenPlacement)
        return
      }
      const rect = target.getBoundingClientRect()
      const fallback = triggerRef.current
      const box = rect.width === 0 && rect.height === 0 && fallback ? fallback.getBoundingClientRect() : rect
      const width = Math.min(panel.scrollWidth, window.innerWidth - VIEWPORT_INSET * 2)
      const top = box.bottom + GAP
      const available = window.innerHeight - top - VIEWPORT_INSET
      const maxHeight = Math.max(80, Math.min(MAX_HEIGHT, available))
      const left = Math.min(
        Math.max(VIEWPORT_INSET, box.left),
        Math.max(VIEWPORT_INSET, window.innerWidth - width - VIEWPORT_INSET)
      )
      setPlacement({ left, top, width, maxHeight, visible: true })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [anchorElement, open])

  // 开着时：Esc 关闭并回焦；点外部用 mousedown 关闭但不抢焦点。
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close(true)
      }
    }
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (!target) return
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onMouseDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onMouseDown, true)
    }
  }, [close, open])

  useEffect(() => () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
  }, [])

  const focusFirstInPanel = (): void => {
    const panel = panelRef.current
    if (!panel) return
    const first = panel.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel).focus()
  }

  /** 焦点离开面板与触发器时关闭；在面板内写代码“移出去”不算离开。 */
  const onPanelBlur = (event: React.FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget as Node | null
    if (!next) return
    if (panelRef.current?.contains(next) || triggerRef.current?.contains(next)) return
    close(false)
  }

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return
    const panel = panelRef.current
    if (!panel) return
    const focusables = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (focusables.length === 0) return
    const active = document.activeElement
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    if (!event.shiftKey && active === last) {
      event.preventDefault()
      close(true)
    } else if (event.shiftKey && active === first) {
      event.preventDefault()
      close(true)
    }
  }

  const cancelLeave = (): void => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }
  }

  const scheduleLeave = (): void => {
    if (separated) return
    cancelLeave()
    leaveTimer.current = setTimeout(() => close(false), POINTER_LEAVE_DELAY)
  }

  const triggerProps: AnchoredPanelTriggerProps = {
    ref: (node) => { triggerRef.current = node },
    onSelect: (event) => {
      const keyboard = event.detail === 0
      if (open) {
        close(true)
        return
      }
      setOpen(true)
      if (keyboard) requestAnimationFrame(focusFirstInPanel)
    },
    onKeyDown: (event) => {
      if (event.key === 'Tab' && open && !event.shiftKey) {
        event.preventDefault()
        focusFirstInPanel()
      }
    },
    expanded: open,
    hasPopup: 'dialog',
    ...(open ? { controls: panelId } : {})
  }

  return <>
    {trigger(triggerProps)}
    {open ? createPortal(
      <div
        className="mi-anchored-panel"
        id={panelId}
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label={resolveText(labelKey)}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        onBlur={onPanelBlur}
        onMouseEnter={cancelLeave}
        onMouseLeave={scheduleLeave}
        style={{
          left: placement.left,
          top: placement.top,
          width: placement.width || undefined,
          maxHeight: placement.maxHeight,
          visibility: placement.visible ? 'visible' : 'hidden'
        }}>
        {children}
      </div>,
      overlayContainer(triggerRef.current ?? document.body)
    ) : null}
  </>
}
