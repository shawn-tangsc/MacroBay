import { useEffect, type ReactElement, type ReactNode } from 'react'

import { SidePanel } from '@platform/ui/components/side-panel'

import { useProductTextKey } from '../../../shared/i18n/productTextKey'

/**
 * The detail is a **side panel**, not a drawer: it takes its own column and leaves the calendar
 * beside it. A reader who opens an event wants the days around it, so the board must not be covered.
 *
 * One form only — the component's `flex` tier (480), the same width the floating card had. What
 * changed is where that width comes from: the calendar gives it up instead of being covered.
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
