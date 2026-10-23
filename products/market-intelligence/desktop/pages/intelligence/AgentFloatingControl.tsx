import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ConfigProvider } from 'antd'
import { Bot, X } from 'lucide-react'

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

export function AgentFloatingControl({ children, text, onOpenChange, onClear }: Readonly<{
  children: ReactNode
  text: AgentFloatingControlText
  onOpenChange?: (open: boolean) => void
  /** Empties the conversation; the panel leaves what to do about history to the caller. */
  onClear?: () => void
}>): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(defaultPosition)
  // Set while a drag actually moved, so the trailing click does not toggle the panel.
  const dragged = useRef(false)
  const grab = useRef<{ dx: number; dy: number } | null>(null)
  const change = (next: boolean) => { setOpen(next); onOpenChange?.(next) }
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
