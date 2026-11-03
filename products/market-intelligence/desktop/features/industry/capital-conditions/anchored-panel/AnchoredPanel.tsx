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

type AnchorTarget = HTMLElement | RefObject<HTMLElement | null>

export type AnchoredPanelProps = {
  trigger: (props: AnchoredPanelTriggerProps) => ReactElement
  /** 面板的可访问名；只收键，句子由调用方解析。 */
  labelKey: string
  resolveText: (key: string) => string
  children: ReactNode
  /**
   * 位置锚，**必填**：这个组件的唯一用法是「按钮在标题、面板从图表下方出来」，位置与触发器
   * 是两回事。默认锚在触发器上那一档（贴着触发器翻转、指针离开就收）没有消费点，留着只会
   * 让下一个人以为有两种模式。
   */
  anchor: AnchorTarget
}

type Placement = { left: number; top: number; width: number; maxHeight: number; visible: boolean }

const GAP = 4
const VIEWPORT_INSET = 8
const MAX_HEIGHT = 320
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const hiddenPlacement: Placement = { left: 0, top: 0, width: 0, maxHeight: MAX_HEIGHT, visible: false }

export function AnchoredPanel({ trigger, labelKey, resolveText, children, anchor }: AnchoredPanelProps): ReactElement {
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<Placement>(hiddenPlacement)
  const triggerRef = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  /** 锚点出现过没有：从有到 null 说明 React 卸载了锚，面板不能跳到触发器上继续开着。 */
  const anchorWasPresent = useRef(false)

  const close = useCallback((returnFocus: boolean): void => {
    setOpen(false)
    setPlacement(hiddenPlacement)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  const anchorElement = useCallback((): HTMLElement | null => {
    return anchor instanceof HTMLElement ? anchor : anchor.current
  }, [anchor])

  // 定位：只读锚点矩形，向下放；分离档不翻上，空间不够就截高、面板内部滚。
  useLayoutEffect(() => {
    if (!open) return undefined
    const measure = (): void => {
      const panel = panelRef.current
      if (!panel) return
      const anchorNode = anchorElement()
      if (anchorNode) anchorWasPresent.current = true
      if (!anchorNode && anchorWasPresent.current) {
        // React 把 ref 置成 null 就是卸载：面板不能跳到触发器上继续开着。
        setOpen(false)
        setPlacement(hiddenPlacement)
        return
      }
      const target = anchorNode ?? triggerRef.current
      if (!target || !target.isConnected) {
        setOpen(false)
        setPlacement(hiddenPlacement)
        return
      }
      const rect = target.getBoundingClientRect()
      const fallback = triggerRef.current
      const box = rect.width === 0 && rect.height === 0 && fallback ? fallback.getBoundingClientRect() : rect
      const width = Math.min(panel.getBoundingClientRect().width, window.innerWidth - VIEWPORT_INSET * 2)
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

  /** Focus the panel itself first: the reader hears its name before the table's own announcement. */
  const focusPanel = (): void => {
    panelRef.current?.focus()
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


  const triggerProps: AnchoredPanelTriggerProps = {
    ref: (node) => { triggerRef.current = node },
    onSelect: (event) => {
      const keyboard = event.detail === 0
      if (open) {
        close(true)
        return
      }
      setOpen(true)
      if (keyboard) requestAnimationFrame(focusPanel)
    },
    onKeyDown: (event) => {
      if (event.key === 'Tab' && open && !event.shiftKey) {
        event.preventDefault()
        focusPanel()
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
