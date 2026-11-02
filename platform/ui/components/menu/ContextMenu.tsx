import { Menu } from 'antd'
import type { MenuProps } from 'antd'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { createPortal } from 'react-dom'

import type { MenuItem } from './menuItem'

import './contextMenu.css'

/**
 * 右键 / 上下文菜单（规格：1a 定「菜单项既不是按钮基座，也不是可点击行，归 1b 菜单组件统一」）。
 *
 * 底层是 antd `Menu`：`items` 的形状、选中态、`danger` 样式和上下键 / Home / End 的键盘语义
 * 都由它承担，本组件只做它没有的三件事——**定点弹出**、**Esc / 外点关闭**、**视口内夹取**。
 *
 * 写进类型、不靠评审：
 * - 只收 `labelKey`，不收 `label`：句子由调用方注入的 `resolveText` 解析，组件内零文案零 i18n；
 * - `tone` 是闭集，危险项只给 `'danger'`，调用方传不了颜色；
 * - `onSelect` 收到的是 `key`（字符串），不是索引、不是事件对象。
 *
 * 渲染到 `document.body` 的传送门里：抽屉与列表普遍带 `overflow`，就地渲染会被裁掉半截，
 * 这正是各处另写一套定位的由来。
 */

/** 视口坐标锚点，来自 `contextmenu` 事件或触发器自己的 `getBoundingClientRect()`。 */
export type MenuAnchor = { x: number; y: number }

export type ContextMenuProps = {
  /** 菜单是否打开。关着时不渲染任何东西（不留空壳）。 */
  open: boolean
  /** 打开位置；与 `open` 同时生效。 */
  anchor: MenuAnchor | null
  items: readonly MenuItem[]
  /** 收到被选中项的 `key`；组件随后通知 `onClose`。 */
  onSelect: (key: string) => void
  /** Esc、外部点击、选中一项之后调用；调用方据此卸载并把焦点还给原触发器。 */
  onClose: () => void
  /** 菜单自己的可访问名（键）：上下文菜单没有触发器，读屏只能靠它知道这是哪个菜单。 */
  ariaLabelKey: string
  /** 文案解析入口，由调用方注入（壳层传 `t` 的包装，测试传键回显）。 */
  resolveText: (key: string) => string
  className?: string
}

/** 离视口边缘至少留这么多像素，避免菜单贴边或被裁。 */
const VIEWPORT_MARGIN = 4

/**
 * 菜单项类型取自 `MenuProps['items']`，**不走 `antd/es/menu/interface` 这种内部路径**。
 *
 * 内部路径不在 antd 的公开出口里：CI 用 `moduleResolution: Bundler`（尊重 `exports`）解析，
 * 同一个版本在本地能过、在 runner 上就报「找不到模块」——依赖内部的深层 import 迟早会在
 * 某次升级或某台机器上断掉，而它断的位置和原因都跟我们的代码无关。
 */
type AntdMenuItem = NonNullable<MenuProps['items']>[number]

function toAntdItems(items: readonly MenuItem[], resolveText: (key: string) => string): AntdMenuItem[] {
  return items.map((item) => ({
    key: item.key,
    label: resolveText(item.labelKey),
    disabled: item.disabled === true,
    ...(item.tone === 'danger' ? { danger: true } : {})
  }))
}

export function ContextMenu(props: ContextMenuProps): ReactElement | null {
  const { open, anchor, items, onSelect, onClose, ariaLabelKey, resolveText, className } = props
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<MenuAnchor | null>(anchor)

  // 先按锚点出，再按实际尺寸夹进视口：菜单宽度随文案长短变化，写死一个宽度会在长文案上溢出。
  useLayoutEffect(() => {
    if (!open || anchor === null) {
      setPosition(null)
      return
    }
    setPosition(anchor)
    const element = menuRef.current
    if (element === null) return
    const box = element.getBoundingClientRect()
    const width = box.width
    const height = box.height
    const x = Math.max(VIEWPORT_MARGIN, Math.min(anchor.x, window.innerWidth - width - VIEWPORT_MARGIN))
    const y = Math.max(VIEWPORT_MARGIN, Math.min(anchor.y, window.innerHeight - height - VIEWPORT_MARGIN))
    if (x !== anchor.x || y !== anchor.y) setPosition({ x, y })
  }, [open, anchor])

  const closeOnOutside = useCallback(
    (event: Event) => {
      const element = menuRef.current
      if (element !== null && event.target instanceof Node && element.contains(event.target)) return
      onClose()
    },
    [onClose]
  )

  useEffect(() => {
    if (!open) return undefined

    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }

    document.addEventListener('pointerdown', closeOnOutside, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, onClose, closeOnOutside])

  // 打开即把焦点送进菜单：键盘用户按 Shift+F10 之后，上/下键必须立刻可用。
  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus()
  }, [open])

  if (!open || anchor === null) return null

  const left = position?.x ?? anchor.x
  const top = position?.y ?? anchor.y

  return createPortal(
    <div
      ref={menuRef}
      className={['context-menu', className].filter(Boolean).join(' ')}
      style={{ left, top }}
      data-context-menu="">
      <Menu
        items={toAntdItems(items, resolveText)}
        selectable={false}
        aria-label={resolveText(ariaLabelKey)}
        onClick={({ key }) => {
          onSelect(key)
          onClose()
        }}
      />
    </div>,
    document.body
  )
}
