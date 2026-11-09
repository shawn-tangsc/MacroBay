import { useEffect, type ReactElement, type ReactNode } from 'react'

import { SidePanel } from '@platform/ui/components/side-panel'

import { useProductTextKey } from '../../../shared/i18n/productTextKey'

/**
 * The detail is an **overlay layer**, not a column beside the calendar.
 *
 * It was briefly a flex sibling that took its own 480px column, which narrowed the month grid every
 * time an event was opened — the opposite of what a detail is for: the reader opens it to read the
 * event *against* the month, so the month must stay exactly where it was. `size: 'flex'` is still
 * the panel's own tier (480); the page positions it out of flow (see `economicCalendar.css`) so the
 * width never comes out of the calendar.
 *
 * One form only, so the page and the market dashboard card cannot drift to two widths.
 */
export const CalendarDetailPanelPolicy = Object.freeze({ size: 'flex' as const })

/** One title for both entry points (this page and the dashboard's calendar card). */
const DETAIL_TITLE_KEY = 'pages.intelligence.portal.calendar.details.title'

/**
 * A reader picks event after event without leaving the list, so the panel **must not** steal focus
 * (`focusPolicy="stay"`). That has one cost: nothing announces that the content changed. The panel
 * covers it — it announces "showing {title}, {when}" once per `contentId`, which is also why `when`
 * is required: two FOMC rows on one day share a title, and a title alone would read as "nothing
 * happened".
 *
 * Escape stays here rather than in the panel: `SidePanel` deliberately does not take the key (the
 * reader is meant to walk between both sides), but a detail opened from a list still has to be
 * dismissable from the keyboard, and it was before this change.
 */
export function CalendarInspector({ open, contentId, when, onClose, children }: {
  open: boolean
  contentId?: string
  when?: string
  onClose: () => void
  children: ReactNode
}): ReactElement | null {
  const resolveText = useProductTextKey()
  useEffect(() => {
    if (!open) return
    // On the document: with focus policy `stay` the reader's focus stays on the row they picked,
    // which is outside the panel, so a handler bound inside it would never see the key.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])
  // No identity, no panel: without these two the announcement cannot say which row changed, and a
  // panel that silently swaps content is the very failure this policy exists to prevent.
  if (!open || contentId === undefined || when === undefined) return null
  return (
    <SidePanel
      className="mi-calendar-detail"
      contentId={contentId}
      focusPolicy="stay"
      onClose={onClose}
      open
      resolveText={resolveText}
      size={CalendarDetailPanelPolicy.size}
      titleKey={DETAIL_TITLE_KEY}
      when={when}
    >
      <div className="mi-calendar-detail-container" data-calendar-detail-container>{children}</div>
    </SidePanel>
  )
}
