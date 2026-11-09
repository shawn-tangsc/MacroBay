import type { ReactElement } from 'react'

import { StateView } from '@platform/ui/components/state'

import type { EconomicCalendarText } from './economicCalendarText'

/**
 * A month with nothing in it.
 *
 * **No action on purpose** (product, 2026-11-09): this page has no range to widen — it draws one
 * month at a time, and what changes which month is the page header's previous/next/this-month
 * controls, which are on screen already. A second entry in the empty state would be the same screen
 * offering the same move twice.
 *
 * The product's own sentence ("本月没有已发布事件") rides the reason slot through the
 * product-sentence entry, so the specific wording survives the shared surface.
 */
export function CalendarEmptyMonthState({ text }: { text: EconomicCalendarText }): ReactElement {
  return <StateView
    className="mi-economic-calendar__empty-state"
    state="empty"
    reasonCode="nothing-in-window"
    size="lg"
    productReason={{ key: 'mi.calendar.empty-month', resolve: () => text.status.empty }}
  />
}
