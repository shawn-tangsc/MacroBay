import {
  assessMarketCalendarSurprise,
  exceedsSurpriseTrigger,
  toCalendarSurpriseView,
  type MarketCalendarSurpriseAssessment,
  type MarketCalendarSurpriseReason
} from '../../../contracts/macro/marketCalendarSurprise'
import { providerAwaitingData } from '../../shared/marketCalendarEventLifecycle'
import type { CalendarCardReaction } from './calendarCardReaction'
import { calendarUpcomingPolicy } from './calendarUpcomingPolicy'

/**
 * Projects calendar events into the right column's card.
 *
 * Pure and read-only: it decides what is worth watching from events the page already
 * queried, and never fetches anything. Two sections come out — what is still scheduled
 * inside the policy window, and what was released today with a value that actually moved
 * against its own previous or consensus — because a release that did not move is not news.
 */

export type CalendarCardImportance = 'high' | 'medium' | 'low'
/** The provider's own categories; the card colours them so the reader can tell them apart. */
export type CalendarCardCategory = 'economic-indicator' | 'financial-event' | 'central-bank-activity'

/** The subset of an official or provider event view the card needs. */
export type CalendarCardEvent = Readonly<{
  eventKey: string
  titleKey: string
  /** The 0xRouter route's country for this event, already localised; absent on the official route. */
  countryName?: string
  importance: CalendarCardImportance
  lifecycleState: 'scheduled' | 'released' | 'cancelled'
  category: CalendarCardCategory
  scheduledDate: string
  scheduledAt?: string
  detectedAt: string
  actual?: Readonly<{ displayValue: string }> | null
  previous?: Readonly<{ displayValue: string }> | null
  consensus?: Readonly<{ displayValue: string }> | null
}>

export type CalendarCardRow = Readonly<{
  eventKey: string
  titleKey: string
  /** The 0xRouter route's country, already localised; absent on the official route. */
  countryName?: string
  month: string
  /** `scheduledDate`, so a date-only event can still show when it is. */
  date: string
  at: string | null
  importance: CalendarCardImportance
  category: CalendarCardCategory
  kind: 'upcoming' | 'released-changed'
  /** 计划时刻已过、值还没到：卡片在这一行上说明它在等，而不是让读者以为什么都没发生。 */
  awaitingData: boolean
  /** What was published, plus the reference points the reader compares against. */
  actual: string | null
  previous: string | null
  consensus: string | null
  /**
   * The expected difference, judged once by the contract module.
   *
   * `direction` is the calendar view enum (four values); `reason` separates "no expectation" from
   * "cannot compare", which is what the two sentences on the card depend on. `value`/`unit` are the
   * presentation the contract chose, so the card never picks a different number than a fact does.
   */
  surprise: CalendarCardSurprise
  /**
   * 「这次发布前后各 30 分钟，三条线各自走了多少」（原型 ④）。
   *
   * 不在投影里算：它要一次跨资产读，投影是纯的。`useCalendarCardData` 读回来之后用
   * `attachReactions` 贴上去；读不到的行**不带这个字段**，卡片据此决定画不画那一行。
   */
  reaction?: CalendarCardReaction
}>

export type CalendarCardState = 'available' | 'empty' | 'unavailable'
export type CalendarCardSurprise = Readonly<{
  direction: 'beat' | 'miss' | 'inline' | 'consensus-unavailable'
  value: number | null
  unit: 'pp' | 'relative-percent' | null
  reason: MarketCalendarSurpriseReason | null
}>
export type CalendarCardProjection = Readonly<{ today: readonly CalendarCardRow[]; upcoming: readonly CalendarCardRow[]; state: CalendarCardState }>

/** The instant an event happens at, for ordering and for the window test. */
function instantOf(event: CalendarCardEvent): string {
  return event.scheduledAt ?? `${event.scheduledDate}T00:00:00.000Z`
}

/**
 * The window is seven *calendar* days inclusive, not seven times twenty-four hours: an event
 * on the seventh day still counts even when it lands later in the day than `asOf` did.
 */
function lastDayOfWindow(asOf: string, windowDays: number): string {
  return new Date(Date.parse(asOf) + windowDays * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10)
}

function withinWindow(event: CalendarCardEvent, asOf: string, policy: typeof calendarUpcomingPolicy): boolean {
  const lastDay = lastDayOfWindow(asOf, policy.upcomingWindowDays)
  const grace = policy.pendingGraceHours * 60 * 60 * 1_000
  // An event still waiting for its value keeps its row for the grace period; one that already
  // published belongs to the released section the moment it does.
  const lowerBound = Date.parse(asOf) - (event.actual ? 0 : grace)
  const day = (event.scheduledAt ?? event.scheduledDate).slice(0, 10)
  if (event.scheduledAt === undefined) return day >= asOf.slice(0, 10) && day <= lastDay
  const at = Date.parse(event.scheduledAt)
  return at >= lowerBound && at <= Date.parse(`${lastDay}T23:59:59.999Z`)
}

/**
 * Released inside the recent window, in the same UTC terms the rest of the product stores
 * instants in. Not "today only": a release the reader has not seen yet is still news the next
 * morning, and restricting it to the current date left the section empty most of the time.
 */
function releasedRecently(event: CalendarCardEvent, asOf: string, windowDays: number): boolean {
  const day = event.scheduledDate <= asOf.slice(0, 10) ? event.scheduledDate : instantOf(event).slice(0, 10)
  const earliest = new Date(Date.parse(asOf) - windowDays * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10)
  return day >= earliest && day <= asOf.slice(0, 10)
}

function moved(event: CalendarCardEvent): boolean {
  const actual = event.actual?.displayValue ?? null
  if (actual === null) return false
  // A release that landed far enough from the expectation is news even when the printed value
  // equals its previous value: the headline is the surprise, not the revision.
  if (exceedsSurpriseTrigger(assessMarketCalendarSurprise(event.actual, event.consensus))) return true
  const previous = event.previous?.displayValue ?? null
  const consensus = event.consensus?.displayValue ?? null
  return (previous !== null && previous !== actual) || (consensus !== null && consensus !== actual)
}

function cardSurprise(assessment: MarketCalendarSurpriseAssessment): CalendarCardSurprise {
  return {
    direction: toCalendarSurpriseView(assessment),
    value: assessment.presentation?.value ?? null,
    unit: assessment.presentation?.unit ?? null,
    reason: assessment.reason
  }
}

function toRow(event: CalendarCardEvent, kind: CalendarCardRow['kind'], asOf: string): CalendarCardRow {
  return {
    eventKey: event.eventKey, titleKey: event.titleKey,
    ...(event.countryName ? { countryName: event.countryName } : {}),
    month: instantOf(event).slice(0, 7),
    date: event.scheduledDate, at: event.scheduledAt ?? null, importance: event.importance, category: event.category, kind,
    actual: event.actual?.displayValue ?? null,
    previous: event.previous?.displayValue ?? null,
    consensus: event.consensus?.displayValue ?? null,
    surprise: cardSurprise(assessMarketCalendarSurprise(event.actual, event.consensus)),
    awaitingData: providerAwaitingData({ scheduledAt: event.scheduledAt ?? null, actual: event.actual ?? null }, asOf)
  }
}

/**
 * Picks the upcoming rows by the hour they land in, as the product owner specified: hour groups
 * are atomic, so a busy hour is never cut in half, and a quiet nearest hour is topped up with the
 * next-nearest hours until the card has at least `target` rows. The target is therefore a floor
 * the busy case raises, not a hard cut.
 *
 * Grouping uses the stored instant, so it does not shift with the reader's display zone.
 */
function selectUpcomingRows(rows: readonly CalendarCardEvent[], target: number): readonly CalendarCardEvent[] {
  const byHour = new Map<string, CalendarCardEvent[]>()
  for (const row of rows) {
    const hour = instantOf(row).slice(0, 13)
    const bucket = byHour.get(hour)
    if (bucket) bucket.push(row)
    else byHour.set(hour, [row])
  }
  const selected: CalendarCardEvent[] = []
  for (const bucket of byHour.values()) {
    selected.push(...bucket)
    if (selected.length >= target) break
  }
  return selected
}

export function projectUpcomingCalendarCard(
  events: readonly CalendarCardEvent[],
  asOf: string,
  policy: typeof calendarUpcomingPolicy = calendarUpcomingPolicy
): CalendarCardProjection {
  const topImportance = events.filter(event => policy.visibleImportance.includes(event.importance))
  const candidates = topImportance
    .filter(event => event.lifecycleState === 'scheduled' && withinWindow(event, asOf, policy))
    .sort((left, right) => instantOf(left).localeCompare(instantOf(right)) || left.eventKey.localeCompare(right.eventKey))
  const upcoming = selectUpcomingRows(candidates, policy.maximumUpcomingRows).map(event => toRow(event, 'upcoming', asOf))
  const today = topImportance
    .filter(event => event.lifecycleState === 'released' && releasedRecently(event, asOf, policy.releasedWindowDays) && moved(event))
    // Newest first: the reader wants the latest print at the top of this section.
    .sort((left, right) => instantOf(right).localeCompare(instantOf(left)) || left.eventKey.localeCompare(right.eventKey))
    .slice(0, policy.maximumTodayRows)
    .map(event => toRow(event, 'released-changed', asOf))
  return { today, upcoming, state: today.length > 0 || upcoming.length > 0 ? 'available' : 'empty' }
}
