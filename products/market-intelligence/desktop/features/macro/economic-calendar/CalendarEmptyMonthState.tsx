import type { ReactElement } from 'react'

import { StateView, STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state'

import { openIntelligenceSourcesSettings } from '../../../shared/navigation/productShellNavigation'
import type { EconomicCalendarText } from './economicCalendarText'

/**
 * A month with nothing in it.
 *
 * One action: the state's action slot answers "what does the reader do next", and only one thing
 * can be that. The manual ICS import used to sit here beside it, competing for the same slot; it
 * is a page-level tool and now lives in the header toolbar, where it stays visible whether or not
 * the month is empty.
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
    action={{ labelKey: STATE_VIEW_ACTION_KEYS.open_settings, onSelect: openIntelligenceSourcesSettings }}
    productReason={{ key: 'mi.calendar.empty-month', resolve: () => text.emptyState.title }}
  />
}
