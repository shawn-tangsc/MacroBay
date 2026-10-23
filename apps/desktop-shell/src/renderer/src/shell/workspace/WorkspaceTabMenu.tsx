import { useEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * Owner: apps/desktop-shell renderer / workspace Tab 菜单（P2-02）。
 * 权威：A-T08「控件可发现、ARIA 正确」。
 *
 * 纯表现层：只渲染调用方给的可访问项，不解析业务状态、不读注册表、不自己发命令。
 * 可见文案（含禁用原因）全部由调用方从 `platformText` 取，组件内不出现字面文案。
 */

export type WorkspaceTabMenuItem = {
  id: string
  label: string
  icon?: LucideIcon
  /** 禁用项必须给出可见原因（`disabledReason`），绝不静默灰掉一个入口。 */
  disabled?: boolean
  disabledReason?: string
}

/** 上下文菜单锚点（**视口坐标**，来自 `contextmenu` 事件或 Tab 的 `getBoundingClientRect()`）。 */
export type WorkspaceTabMenuAnchor = { x: number; y: number }

export type WorkspaceTabMenuProps = {
  /** 触发器的可访问名（已 i18n）。 */
  label: string
  icon: LucideIcon
  items: readonly WorkspaceTabMenuItem[]
  onSelect: (id: string) => void
  /** 诊断/测试锚点（不参与可访问名）。 */
  triggerAttributes?: Readonly<Record<string, string>>
  menuLabel?: string
  /**
   * 外部打开请求（P2-15）：每次收到**新值**即打开菜单，且在**挂载时**的新值同样生效。
   * 用于 Tab 右键 / Shift+F10 的上下文菜单 —— 复用本组件的呈现与键盘语义，不另写第二套菜单。
   */
  openRequest?: number
  /**
   * 上下文菜单模式：触发器在组件**外部**（Tab 元素自己带 `aria-haspopup/aria-expanded`），
   * 因此不渲染内置触发器，并把菜单**固定**在锚点上（`position:fixed`，绝不参与父级 flex/grid 布局，
   * 也不被 tablist 的 `overflow-x:auto` 裁剪）。
   */
  contextMenu?: boolean
  anchor?: WorkspaceTabMenuAnchor | null
  /** 菜单被关闭（Esc / 外部点击 / 选中项）时通知调用方，调用方据此卸载并复位 `aria-expanded`。 */
  onClose?: () => void
  /** 关闭时把焦点还给谁：上下文菜单的触发器是外部 Tab，不能沿用内部 `triggerRef`。 */
  returnFocusTarget?: () => HTMLElement | null
}

export function WorkspaceTabMenu(props: WorkspaceTabMenuProps): React.ReactElement {
  const contextMenu = props.contextMenu === true
  const [open, setOpen] = useState(contextMenu)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const TriggerIcon = props.icon
  const onClose = props.onClose
  const openRequest = props.openRequest

  // 右键/Shift+F10 的**每一次**打开都是一个新的 openRequest：同一实例被反复右键也必须重新打开
  useEffect(() => {
    if (openRequest === undefined) return
    setOpen(true)
  }, [openRequest])

  /**
   * 上下文菜单必须把键盘焦点**移入**菜单：否则 Esc/方向键仍落在 Tab 上（菜单形同虚设）。
   * 指针打开的菜单不抢焦点（保持 P2-02 的既有行为）。
   */
  useEffect(() => {
    if (!contextMenu || !open) return
    const first = itemRefs.current.find((item) => item !== null && !item.disabled)
    first?.focus()
  }, [contextMenu, open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: Event): void => {
      if (containerRef.current?.contains(event.target as Node)) return
      setOpen(false)
      onClose?.()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [open, onClose])

  const close = (returnFocus: boolean): void => {
    setOpen(false)
    onClose?.()
    if (!returnFocus) return
    // 上下文菜单的触发器是外部 Tab 元素；内置触发器路径仍用 triggerRef
    const target = props.returnFocusTarget?.() ?? triggerRef.current
    target?.focus()
  }

  const focusItem = (index: number): void => {
    const enabled = itemRefs.current.filter((item) => item !== null && !item.disabled)
    if (enabled.length === 0) return
    const bounded = ((index % enabled.length) + enabled.length) % enabled.length
    enabled[bounded]?.focus()
  }

  const renderMenu = (): React.ReactElement => {
    const anchor = props.anchor ?? null
    return (
      <div
        ref={contextMenu ? containerRef : undefined}
        className={anchor === null ? 'workspace-tab-menu' : 'workspace-tab-menu workspace-tab-menu-floating'}
        role="menu"
        aria-label={props.menuLabel ?? props.label}
        {...(anchor === null ? {} : { style: { left: anchor.x, top: anchor.y } })}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            close(true)
            return
          }
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          const enabled = itemRefs.current.filter((item) => item !== null && !item.disabled)
          const activeIndex = enabled.findIndex((item) => item === document.activeElement)
          focusItem(activeIndex + (event.key === 'ArrowDown' ? 1 : -1))
        }}>
        {props.items.map((item, index) => {
          const ItemIcon = item.icon
          return (
            <button
              key={item.id}
              ref={(node) => { itemRefs.current[index] = node }}
              type="button"
              role="menuitem"
              className="workspace-tab-menu-item"
              disabled={item.disabled === true}
              aria-disabled={item.disabled === true}
              // 禁用原因必须可见（title 与可访问名同源），否则用户只看到一个灰色入口
              {...(item.disabled === true && item.disabledReason !== undefined
                ? { title: item.disabledReason, 'aria-description': item.disabledReason }
                : {})}
              data-menu-item={item.id}
              onClick={() => {
                if (item.disabled === true) return
                props.onSelect(item.id)
                close(true)
              }}>
              {ItemIcon ? <ItemIcon size={14} strokeWidth={1.8} /> : null}
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>
    )
  }


  return (
    <>
      {contextMenu ? null : (
        <div className="workspace-tab-menu-root" ref={containerRef}>
          <button
            ref={triggerRef}
            type="button"
            className="workspace-tab-menu-trigger"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={props.label}
            title={props.label}
            onClick={() => setOpen((current) => !current)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown') return
              event.preventDefault()
              setOpen(true)
              focusItem(0)
            }}
            {...props.triggerAttributes}>
            <TriggerIcon size={14} strokeWidth={1.8} />
          </button>
          {open ? renderMenu() : null}
        </div>
      )}
      {contextMenu && open ? renderMenu() : null}
    </>
  )
}
