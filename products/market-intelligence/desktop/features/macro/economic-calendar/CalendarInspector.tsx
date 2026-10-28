import { Drawer } from 'antd'
import { useEffect, type ReactNode } from 'react'

// Design 122 §2.1: one owner for the detail surface of an official or a market event.
// 480, not 320: the drawer now opens from the dashboard's calendar card as well, and at 320 the
// release title and the source/period rows wrapped on the very first line. Both entry points share
// this policy, so the card and the calendar page cannot drift to two widths.
export const CalendarDetailDrawerPolicy = Object.freeze({ width: 480 })

/**
 * The detail is a drawer from the left, and it carries no mask.
 *
 * A mask would put a grey sheet over the calendar and swallow the click that picks the next event,
 * so the drawer floats over the calendar instead: the reader reads a detail and keeps the board
 * underneath. Because there is no mask to click away, the header carries the one visible way out —
 * its close control, at the far corner — beside Escape and picking the same event again.
 */
export function CalendarInspector({ open, title, onClose, children }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode
}) {
  // Escape is read from the document, not from the drawer: with no mask the reader's focus is
  // regularly outside the drawer (they just clicked a calendar row), and a key handler on the panel
  // would never see the key.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])
  return <Drawer autoFocus={false} closable={{ placement: 'end' }} destroyOnHidden getContainer={false} keyboard mask={false}
    // `rootClassName`, not `className`: antd hands `className` to `.ant-drawer-content`, so the inset
    // below never matched anything and the reader's 12px floating card silently did not exist.
    rootClassName="mi-calendar-drawer"
    open={open} placement="left" title={title} width={CalendarDetailDrawerPolicy.width} onClose={onClose}>
    {open ? <div className="mi-calendar-detail-container" data-calendar-detail-container>{children}</div> : null}
  </Drawer>
}
