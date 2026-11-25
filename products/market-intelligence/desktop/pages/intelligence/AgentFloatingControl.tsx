import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ConfigProvider } from 'antd'
import { Bot, X } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'

/**
 * The market agent, behind a floating control in the bottom-right corner.
 *
 * The conversation used to occupy a permanent column and push the analysis timeline down; it
 * now opens over whatever the reader is looking at, so the calendar card can take the space the
 * conversation held. State is per window and session-local: nothing here is persisted, and the
 * panel is scoped to the window that opened it.
 *
 * Esc closes it, the button carries `aria-expanded`, and focus lands on the close button when
 * it opens so a keyboard reader is not stranded behind an overlay.
 *
 * The control is fixed to the window's bottom-right corner rather than placed in the column, so
 * it never takes layout space, and it can be dragged anywhere inside the viewport — a reader may
 * want it out of the way of a chart. Dragging never eats the click: the button only toggles when
 * the pointer did not actually move.
 *
 * **窄档是底部上滑抽屉，不是这颗浮窗面板**（用户 2026-11-24，原型
 * `2026-11-24-pad-agent-drawer.html`）：960 宽里开一个 710 宽的浮窗，等于在看板上面再压一层
 * 「两栏共存」的错觉；底部抽屉只拿走下方 84%（800 档 88%），上面仍露着结论卡，读者知道自己从哪儿来。
 *
 * 抽屉的三条硬约束：
 * - 开着时**不渲染圆钮**（不是压在上面）——它已经被抽屉整个盖住，再放一颗就成了第二层入口；
 * - 关掉后**焦点回圆钮**：圆钮在开着时不渲染，所以等它回到 DOM 之后再聚焦；
 * - **常挂载、只是不可见**：关掉不卸载会话（会话本身在 workspace 的 hook 里，面板卸载也不会丢，
 *   但输入框的草稿会），所以抽屉第一次打开后一直留在树上，用 `display` 收起来。
 *
 * **键盘**：抽屉开着时，布局根给「看板那一层」设 `inert`（`MarketAnalysisDashboardLayout`），
 * 于是 Tab 与指针都走不进去；遮罩只负责变暗和「点它关闭」，不是键盘的拦法。
 *
 * **组件表达不了，登记在这里**：平台 `Drawer` 只有四个**宽度**档、只有右侧呈现，没有 placement、
 * 也没有高度档——底部上滑 ＋ 百分比高度（84% / 800 档 88%）它表达不了。所以抽屉的结构与样式留在
 * 本组件里，没有去改平台 `Drawer`（那会同时动 16 个调用点的契约），也没有直接 import antd `Drawer`。
 */

/** The button's box size, which the drag clamp needs as a number. */
const buttonSize = 56
const margin = 16
/** The gap between the button and the panel that opens beside it. */
const panelGap = 12
const dragThreshold = 3

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

/**
 * Places the panel against the button using viewport edges rather than the panel's size: a
 * measured size would drift from the CSS (`78vh` is not the constant the code can know), and that
 * drift is what left the panel floating away from its button.
 */
function panelPlacement(position: { x: number; y: number }): React.CSSProperties {
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const lowerHalf = position.y > viewport.height / 2
  const rightHalf = position.x > viewport.width / 2
  return {
    ...(lowerHalf
      ? { bottom: viewport.height - position.y + panelGap, top: 'auto' }
      : { top: position.y + buttonSize + panelGap, bottom: 'auto' }),
    ...(rightHalf
      ? { right: viewport.width - (position.x + buttonSize), left: 'auto' }
      : { left: position.x, right: 'auto' })
  }
}

function defaultPosition(): { x: number; y: number } {
  const width = typeof window === 'undefined' ? 1280 : window.innerWidth
  const height = typeof window === 'undefined' ? 800 : window.innerHeight
  return { x: width - buttonSize - margin, y: height - buttonSize - margin }
}

export type AgentFloatingControlText = Readonly<{ open: string; close: string; title: string; clear: string }>

export function AgentFloatingControl({ children, text, onOpenChange, onClear, compact = false, suppressed = false, open: controlledOpen, closeKey, resolveText }: Readonly<{
  children: ReactNode
  text: AgentFloatingControlText
  onOpenChange?: (open: boolean) => void
  /** Empties the conversation; the panel leaves what to do about history to the caller. */
  onClear?: () => void
  /** 窄档（看板侧容器 ≤1303）：打开的是底部上滑聊天框，不是浮窗面板。 */
  compact?: boolean
  /** 另有模态层开着（时间轴、事件详情、设置、整幅档的左抽屉）：圆钮不渲染——它 z 比那些层高，压在上面就是第二层入口。 */
  suppressed?: boolean
  /**
   * 受控开关：窄档的两个面互斥，**布局根**要知道聊天框开着没有（开抽屉就关它），也要能关它。
   * 不传就是本组件自己管（宽档的浮窗面板一直如此）。
   */
  open?: boolean
  /** 抽屉关闭控件的读屏名（i18n 键，由调用方给；平台 `IconButton` 只收键）。 */
  closeKey: string
  resolveText: (key: string) => string
}>): React.ReactElement {
  const [ownOpen, setOwnOpen] = useState(false)
  const open = controlledOpen ?? ownOpen
  const [position, setPosition] = useState(defaultPosition)
  // 抽屉第一次打开之后就一直留在树上（关掉只是不可见），别让关一次就把会话界面卸载掉。
  const [everOpened, setEverOpened] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  // 关闭后要把焦点送回圆钮，而圆钮在开着时不渲染——所以等它回到 DOM 再聚焦。
  const [returnFocus, setReturnFocus] = useState(false)
  // Set while a drag actually moved, so the trailing click does not toggle the panel.
  const dragged = useRef(false)
  const grab = useRef<{ dx: number; dy: number } | null>(null)
  /**
   * 窄档的圆钮可以拖：**没拖过就是 CSS 的右下默认位**（转屏、改窗口都跟边），
   * 一旦拖过就改像素坐标，并夹在视口里（整体不出界、至少留 8px）。
   */

  const change = (next: boolean) => {
    if (controlledOpen === undefined) setOwnOpen(next)
    if (compact && next) setEverOpened(true)
    if (!next) setReturnFocus(true)
    onOpenChange?.(next)
  }
  const move = (event: React.PointerEvent<HTMLButtonElement>) => {
    const held = grab.current
    if (!held) return
    const next = {
      x: clamp(event.clientX - held.dx, margin, window.innerWidth - buttonSize - margin),
      y: clamp(event.clientY - held.dy, margin, window.innerHeight - buttonSize - margin)
    }
    if (Math.abs(next.x - position.x) > dragThreshold || Math.abs(next.y - position.y) > dragThreshold) dragged.current = true
    setPosition(next)
  }
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') change(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  // 打开：焦点落到抽屉的关闭上（读者马上能关掉，不用在遮罩里找路）。
  useEffect(() => {
    if (compact && open) closeButton.current?.focus()
  }, [compact, open])
  useEffect(() => {
    if (open || !returnFocus) return
    button.current?.focus()
    setReturnFocus(false)
  }, [open, returnFocus])

  if (compact) {
    return <>
      {/* 遮罩：变暗 + 点它关闭。看板「点不动、聚焦不了」由布局根那一层的 `inert` 管，遮罩不承担键盘。 */}
      {open ? <div aria-hidden="true" className="mi-agent-sheet__scrim" data-agent-sheet-scrim onClick={() => change(false)} /> : null}
      {open || everOpened ? <section aria-label={text.title} aria-modal="true" className="mi-agent-sheet" data-agent-sheet data-open={open} role="dialog">
        <div aria-hidden="true" className="mi-agent-sheet__handle"><i /></div>
        <header className="mi-agent-sheet__head">
          <h2>{text.title}</h2>
          <IconButton ariaLabelKey={closeKey} icon={X} onSelect={() => change(false)} ref={closeButton} resolveText={resolveText} size="md" />
        </header>
        <div className="mi-agent-sheet__body">{children}</div>
      </section> : null}
      {/* 窄档**没有圆形悬浮钮**（用户 2026-11-24 改口）：底部居中一颗小胶囊，只换形态不换语意——
          点开底部聊天框。24 的 `IconButton` 外套 8px 内距的胶囊（外径约 40），距底 12、水平居中。
          开着时不渲染（它本来就被挡住）；抽屉开着仍显示（两件事互不相干）。 */}
      {open || suppressed ? null : <span className="mi-agent-capsule">
        <IconButton ariaLabelKey="pages.intelligence.portal.analysisWorkspace.openChat"
          dataAttributes={{ 'data-agent-floating-button': '' }}
          icon={Bot}
          onSelect={() => change(true)}
          ref={button}
          resolveText={resolveText}
          size="md" />
      </span>}
    </>
  }
  return <>
    {open ? <section aria-label={text.title} className="mi-agent-floating" role="dialog"
      style={panelPlacement(position)}>
      {/* The panel floats above antd's drawers, so its own popovers (model menu, tool list, hints)
          must be raised above the panel too — otherwise clicking them opens them behind it. */}
      <ConfigProvider theme={{ token: { zIndexPopupBase: 1300 } }}>
        <header>
          <h2>{text.title}</h2>
          {onClear ? <button className="mi-agent-floating__clear" onClick={onClear} type="button">{text.clear}</button> : null}
          <button aria-label={text.close} autoFocus className="mi-agent-floating__close" onClick={() => change(false)} type="button"><X aria-hidden="true" size={16} /></button>
        </header>
        <div className="mi-agent-floating__body">{children}</div>
      </ConfigProvider>
    </section> : null}
    <button aria-expanded={open} aria-label={open ? text.close : text.open} className="mi-agent-floating__button"
      data-agent-floating-button
      ref={button}
      onPointerDown={event => { grab.current = { dx: event.clientX - position.x, dy: event.clientY - position.y }; dragged.current = false }}
      onPointerMove={move}
      onPointerUp={() => { grab.current = null }}
      onPointerCancel={() => { grab.current = null }}
      onClick={() => { if (dragged.current) { dragged.current = false; return } change(!open) }}
      style={{ left: position.x, top: position.y }}
      type="button">
      {open ? <X aria-hidden="true" size={18} /> : <Bot aria-hidden="true" size={18} />}
    </button>
  </>
}
