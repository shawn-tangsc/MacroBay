import { Popover as AntPopover } from 'antd'
import {
  cloneElement,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement
} from 'react'

/**
 * 多行说明浮层（界面设计 2026-11-02 定的五条能力）。
 *
 * 与 `Tooltip` 的分工：`Tooltip` 只放一行帮助句，读者扫一眼就走；需要**读一段**、
 * 需要**钉住对照**、或者有 3 行以上说明的，用这里。两者都只收键——句子由调用方解析，
 * 组件内零文案零 i18n。
 *
 * 五条能力写进行为与用例，不靠评审：
 * 1. **悬停与聚焦都触发**：读者用 Tab 指过来就该看到，不用鼠标去碰；
 * 2. **点击触发器钉住**，再点别处或按 Esc 关闭——钉住是为了边看边对照，只靠悬停撑不住；
 * 3. **有最大宽度**，长说明换行，不把页面撑开；
 * 4. **定位跟随触发器、不遮住被说明的内容**：在下方，空间不足时向上翻；定位与翻转交给 antd，
 *    本组件不自己算坐标（同 `Tooltip` 的理由）；
 * 5. **Esc 关闭后焦点回到触发器**：不然焦点掉到 `body`，键盘读者就丢了位置。
 *
 * 点击别处关闭时**不抢焦点**：读者点的那个地方就是他要去的地方，焦点跟着他走。
 *
 * 为什么不用 antd 的 `trigger` 列表而要自己管开合：`['hover','focus','click']` 三件一起给，
 * 鼠标移开就关，**钉不住**；只在「读者自己点了」的时候钉住，需要一个别人不知道的状态。
 */

const MAX_WIDTH = 320
const PLACEMENT = 'bottom' as const

type TriggerHandlers = {
  onClick?: (event: ReactMouseEvent<HTMLElement>) => void
  onMouseEnter?: (event: ReactMouseEvent<HTMLElement>) => void
  onMouseLeave?: (event: ReactMouseEvent<HTMLElement>) => void
  onFocus?: (event: ReactMouseEvent<HTMLElement>) => void
  onBlur?: (event: ReactMouseEvent<HTMLElement>) => void
}

export type PopoverProps<K extends string = string> = {
  /** 说明文案的 i18n 键；解析器带键联合时只收联合内的键。 */
  labelKey: K
  /** 调用方的文案解析入口；未知键返回空串时整块浮层不渲染。 */
  resolveText: (key: K) => string
  /** 触发器：必须是可聚焦元素。 */
  children: ReactElement<TriggerHandlers>
}

export function Popover<K extends string = string>({ labelKey, resolveText, children }: PopoverProps<K>): ReactElement {
  const text = resolveText(labelKey)
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const trigger = useRef<HTMLElement | null>(null)
  const content = useRef<HTMLDivElement | null>(null)
  const open = pinned || hovered || focused

  // 没有句子就不存在浮层：空框比没有框更糟，键名更糟。
  const resolved = text.trim() !== ''

  const close = (): void => {
    setPinned(false)
    setHovered(false)
    setFocused(false)
  }

  // Esc 关闭，焦点回到触发器。只在开着的时候挂监听。
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      close()
      trigger.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  // 点别处关闭。点进浮层自己不算别处（长说明里将来放链接也一样）。
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: Event): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (trigger.current?.contains(target) === true) return
      if (content.current?.contains(target) === true) return
      close()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  if (!resolved) return children

  const childHandlers: TriggerHandlers = children.props
  const trigger_ = cloneElement(children, {
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      childHandlers.onClick?.(event)
      trigger.current = event.currentTarget
      setPinned((previous) => !previous)
    },
    onMouseEnter: (event: ReactMouseEvent<HTMLElement>) => {
      childHandlers.onMouseEnter?.(event)
      trigger.current = event.currentTarget
      setHovered(true)
    },
    onMouseLeave: (event: ReactMouseEvent<HTMLElement>) => {
      childHandlers.onMouseLeave?.(event)
      setHovered(false)
    },
    onFocus: (event: ReactMouseEvent<HTMLElement>) => {
      childHandlers.onFocus?.(event)
      trigger.current = event.currentTarget
      setFocused(true)
    },
    onBlur: (event: ReactMouseEvent<HTMLElement>) => {
      childHandlers.onBlur?.(event)
      setFocused(false)
    }
  })

  return (
    <AntPopover
      content={
        <div
          className="platform-popover__content"
          data-popover-content
          ref={content}
          style={{ maxWidth: MAX_WIDTH }}>
          {text}
        </div>
      }
      open={open}
      placement={PLACEMENT}
      trigger={[]}>
      {trigger_}
    </AntPopover>
  )
}
