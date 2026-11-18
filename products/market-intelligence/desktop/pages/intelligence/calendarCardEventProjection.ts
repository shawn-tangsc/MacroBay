import { providerLifecycleState } from '../../shared/marketCalendarEventLifecycle'
import type { CalendarCardEvent } from './projectUpcomingCalendarCard'
import { tierOfMetricKey } from '../../../service/intelligence/macro-calendar/marketCalendarReleaseGroups'

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
  eventKey: string; titleKey: string; importance?: 'high' | 'medium' | 'low'
  /** 指标码（有就给分级；官方腿的 `eventKey` 是发布行键，不是码）。 */
  eventNameKey?: string
  /** 三个官方腿的 `sourceId`；卡片按来源启停过滤时用。 */
  providerIds?: readonly string[]
  lifecycleState: 'scheduled' | 'released' | 'cancelled'
  scheduledDate: string; scheduledAt?: string; detectedAt: string
  actual?: Readonly<{ displayValue: string }> | null
  previous?: Readonly<{ displayValue: string }> | null
  consensus?: Readonly<{ displayValue: string }> | null
}>): CalendarCardEvent {
  return {
    eventKey: view.eventKey, titleKey: view.titleKey, importance: view.importance,
    // 官方腿只有经济指标：分级按指标码取；码拿不到就是 null（不在分级表里，不是没读到）。
    tier: tierOfMetricKey(view.eventNameKey ?? view.eventKey) ?? null,
    ...(view.providerIds === undefined ? {} : { sourceIds: view.providerIds }),
    // The official route only publishes economic indicators; the provider carries its own kind.
    category: 'economic-indicator',
    lifecycleState: view.lifecycleState, scheduledDate: view.scheduledDate,
    scheduledAt: view.scheduledAt, detectedAt: view.detectedAt,
    actual: view.actual ?? null, previous: view.previous ?? null, consensus: view.consensus ?? null
  }
}

/** A 0xRouter event, whose lifecycle this module derives. */
export function toCardEventFromProvider(view: Readonly<{
  eventKey: string; title: string; importance?: 'high' | 'medium' | 'low'
  /** 指标码：只有经济指标行有；事件行是 undefined，分级为 null。 */
  eventNameKey?: string
  eventType: 'economic-indicator' | 'financial-event' | 'central-bank-activity'
  countryName?: string | null
  /** 源给的国家码原值；名字查不到时显示它，而不是留空。 */
  countryCode?: string | null
  scheduledAt: string; sourceObservedAt: string
  providerActual?: Readonly<{ displayValue: string }> | null
  providerPrevious?: Readonly<{ displayValue: string }> | null
  consensus?: Readonly<{ displayValue: string }> | null
}>): CalendarCardEvent {
  return {
    eventKey: view.eventKey, titleKey: view.title, importance: view.importance,
    // 指标行按码取分级；事件行（央行活动/金融事件）不在分级表里 → null。
    tier: view.eventType === 'economic-indicator' && view.eventNameKey !== undefined
      ? (tierOfMetricKey(view.eventNameKey) ?? null)
      : null,
    ...(view.countryName ? { countryName: view.countryName } : {}),
    ...(view.countryCode === undefined || view.countryCode === null ? {} : { countryCode: view.countryCode }),
    category: view.eventType,
    lifecycleState: providerLifecycleState(view), scheduledDate: view.scheduledAt.slice(0, 10),
    scheduledAt: view.scheduledAt, detectedAt: view.sourceObservedAt,
    actual: view.providerActual ?? null, previous: view.providerPrevious ?? null, consensus: view.consensus ?? null
  }
}
