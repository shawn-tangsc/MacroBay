import { providerLifecycleState } from '../../shared/marketCalendarEventLifecycle'
import type { CalendarCardEvent } from './projectUpcomingCalendarCard'

/**
 * Maps the two calendar routes onto the card's event shape.
 *
 * The routes do not describe themselves the same way. An official event view carries an
 * authoritative `lifecycleState` derived by the service, so it is passed through untouched. A
 * 0xRouter event view does not carry one, so its rule is derived from the data the view does publish
 * — named and tested on the product's shared shelf (`shared/marketCalendarEventLifecycle.ts`) rather
 * than as an inline guess inside a renderer hook, because the cross-asset chart reads the same route
 * for its event lines and the two surfaces must not disagree about what "released" means.
 */

/** An official event, which owns its lifecycle; mapped only to the card's field names. */
export function toCardEventFromOfficial(view: Readonly<{
  eventKey: string; titleKey: string; importance: 'high' | 'medium' | 'low'
  lifecycleState: 'scheduled' | 'released' | 'cancelled'
  scheduledDate: string; scheduledAt?: string; detectedAt: string
  actual?: Readonly<{ displayValue: string }> | null
  previous?: Readonly<{ displayValue: string }> | null
  consensus?: Readonly<{ displayValue: string }> | null
}>): CalendarCardEvent {
  return {
    eventKey: view.eventKey, titleKey: view.titleKey, importance: view.importance,
    // The official route only publishes economic indicators; the provider carries its own kind.
    category: 'economic-indicator',
    lifecycleState: view.lifecycleState, scheduledDate: view.scheduledDate,
    scheduledAt: view.scheduledAt, detectedAt: view.detectedAt,
    actual: view.actual ?? null, previous: view.previous ?? null, consensus: view.consensus ?? null
  }
}

/** A 0xRouter event, whose lifecycle this module derives. */
export function toCardEventFromProvider(view: Readonly<{
  eventKey: string; title: string; importance: 'high' | 'medium' | 'low'
  eventType: 'economic-indicator' | 'financial-event' | 'central-bank-activity'
  countryName?: string | null
  scheduledAt: string; sourceObservedAt: string
  providerActual?: Readonly<{ displayValue: string }> | null
  providerPrevious?: Readonly<{ displayValue: string }> | null
  consensus?: Readonly<{ displayValue: string }> | null
}>): CalendarCardEvent {
  return {
    eventKey: view.eventKey, titleKey: view.title, importance: view.importance,
    ...(view.countryName ? { countryName: view.countryName } : {}),
    category: view.eventType,
    lifecycleState: providerLifecycleState(view), scheduledDate: view.scheduledAt.slice(0, 10),
    scheduledAt: view.scheduledAt, detectedAt: view.sourceObservedAt,
    actual: view.providerActual ?? null, previous: view.providerPrevious ?? null, consensus: view.consensus ?? null
  }
}
