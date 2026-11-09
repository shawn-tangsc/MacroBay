import { instantForWallClock, wallClockAt } from '@platform/time/timeZoneClock'

import type { MacroEconomicCalendarEventView } from '../../../../contracts/macro/economicCalendarQueryContracts'
import { macroEconomicCalendarCaveatPolicy } from '../../../shared/macroEconomicCalendarCaveatPolicy'

export type EconomicCalendarPublicEvent = MacroEconomicCalendarEventView
export type EconomicCalendarCategory = 'inflation' | 'employment' | 'growth' | 'monetary-policy' | 'consumption'
export type EconomicCalendarTitleKey = 'fomc' | 'cpi' | 'core-cpi' | 'nonfarm-payrolls' | 'unemployment' | 'average-hourly-earnings' | 'pce' | 'core-pce' | 'gdp' | 'unknown'
export type EconomicCalendarSourceKey = 'federalReserve' | 'bea' | 'blsManualIcs' | 'blsAutomaticSchedule'

export type EconomicCalendarEventView = Pick<
  EconomicCalendarPublicEvent,
  'eventKey' | 'eventFamily' | 'titleKey' | 'periodKey' | 'lifecycleState' | 'coverage' | 'scheduledDate' |
  'scheduledAt' | 'releaseTimeSource' | 'publishedAt' | 'detectedAt' | 'createdAt' | 'actualDetectedAt' | 'actual' | 'previous' | 'caveats'
> & {
  category: EconomicCalendarCategory
  labelKey: EconomicCalendarTitleKey
  sources: EconomicCalendarSourceKey[]
}

export type EconomicCalendarDayView = {
  dateKey: string
  day: number
  month: 'current' | 'outside'
  events: EconomicCalendarEventView[]
}

export type EconomicCalendarProjection = {
  month: string
  asOf: string
  events: EconomicCalendarEventView[]
  days: EconomicCalendarDayView[]
}

export const economicCalendarPresentationPolicy = {
  dayEventLimit: 6,
  calendarWeeks: 6,
  weekdaysPerWeek: 7,
  undatedTimeSortValue: '99:99:99.999Z',
  monthPattern: /^\d{4}-(?:0[1-9]|1[0-2])$/,
  datePattern: /^\d{4}-\d{2}-\d{2}$/,
  familyCategories: {
    fomc: 'monetary-policy',
    cpi: 'inflation',
    'core-cpi': 'inflation',
    'consumer-price-index': 'inflation',
    'employment-situation': 'employment',
    pce: 'consumption',
    'core-pce': 'consumption',
    gdp: 'growth'
  },
  providerSourceMappings: [
    { providerId: 'macro-calendar-fed', sourceKey: 'federalReserve' },
    { providerId: 'macro-calendar-bea', sourceKey: 'bea' },
    { providerId: 'macro-calendar-bls', sourceKey: 'blsManualIcs' }
  ],
  titleKeys: ['fomc', 'cpi', 'core-cpi', 'nonfarm-payrolls', 'unemployment', 'average-hourly-earnings', 'pce', 'core-pce', 'gdp']
} as const

export const EconomicCalendarCompactPrimaryValuePolicy = Object.freeze({
  priority: ['actual', 'scheduled-time', 'date-only']
} as const)

export function createEconomicCalendarQuery(now: Date): { month: string; asOf: string } {
  const asOf = now.toISOString()
  return { month: asOf.slice(0, 7), asOf }
}

export function createEconomicCalendarMonthQuery(month: string, asOf: string): { month: string; asOf: string } {
  return { month, asOf }
}

/** True for a canonical `YYYY-MM` month the calendar queries accept. */
export function isEconomicCalendarMonth(value: string): boolean {
  return economicCalendarPresentationPolicy.monthPattern.test(value)
}

/**
 * The month a clock instant belongs to, for the page the reader keeps open.
 *
 * One owner for "which month is current": the initial query, the month-follow effect and
 * the "back to this month" button all read it, so a month boundary moves them together.
 * The month is the query/storage month (UTC), not the display zone's month.
 */
export function economicCalendarCurrentMonth(instant: string): string {
  return instant.slice(0, 7)
}

export function shiftEconomicCalendarMonth(month: string, offset: -1 | 1): string {
  const bounds = monthBounds(month)
  if (!bounds) return month
  const [year, monthNumber] = month.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + offset, 1))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`
}

export function selectEconomicCalendarMonth(candidate: string | undefined, selectedMonth: string): string {
  return candidate && monthBounds(candidate) ? candidate : selectedMonth
}

export function createEconomicCalendarProjection(input: {
  month: string
  asOf: string
  events: readonly EconomicCalendarPublicEvent[]
}): EconomicCalendarProjection {
  const bounds = monthBounds(input.month)
  if (!bounds) return { month: input.month, asOf: input.asOf, events: [], days: [] }
  const events = input.events
    .filter((event) => event.detectedAt <= input.asOf && event.scheduledDate >= bounds.start && event.scheduledDate < bounds.end)
    .map(toEventView)
    .filter((event): event is EconomicCalendarEventView => Boolean(event))
    .sort(compareEvents)
  const byDate = new Map<string, EconomicCalendarEventView[]>()
  for (const event of events) byDate.set(event.scheduledDate, [...(byDate.get(event.scheduledDate) ?? []), event])
  return { month: input.month, asOf: input.asOf, events, days: monthGrid(bounds.start, input.month, byDate) }
}

/**
 * The months one month's grid actually draws.
 *
 * The grid is six fixed weeks, so its first and last rows can hold days of the months on either
 * side. Reading exactly these months is what lets a cell show its own day instead of a blank that
 * means "outside the month we asked for". Chronological order, the given month always included.
 */
export function economicCalendarGridMonths(month: string): readonly string[] {
  const bounds = monthBounds(month)
  if (!bounds) return []
  const start = new Date(`${bounds.start}T00:00:00.000Z`)
  start.setUTCDate(start.getUTCDate() - start.getUTCDay())
  const months: string[] = []
  for (let index = 0; index < economicCalendarPresentationPolicy.calendarWeeks * economicCalendarPresentationPolicy.weekdaysPerWeek; index += 1) {
    const date = new Date(start)
    date.setUTCDate(start.getUTCDate() + index)
    const key = date.toISOString().slice(0, 7)
    if (!months.includes(key)) months.push(key)
  }
  return months
}

export function economicCalendarEventCategory(eventFamily: string): EconomicCalendarCategory | undefined {
  return economicCalendarPresentationPolicy.familyCategories[eventFamily as keyof typeof economicCalendarPresentationPolicy.familyCategories]
}

export function economicCalendarEventLabelKey(event: Pick<EconomicCalendarPublicEvent, 'titleKey'>): EconomicCalendarTitleKey {
  return (economicCalendarPresentationPolicy.titleKeys as readonly string[]).includes(event.titleKey)
    ? event.titleKey as EconomicCalendarTitleKey
    : 'unknown'
}

export function economicCalendarCaveats(event: Pick<EconomicCalendarEventView, 'caveats'>): string[] {
  return event.caveats.filter((caveat) => macroEconomicCalendarCaveatPolicy.isVisible(caveat))
}

export function formatEconomicCalendarMonth(month: string, locale: string): string {
  const bounds = monthBounds(month)
  return bounds
    ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${bounds.start}T00:00:00.000Z`))
    : month
}

export function formatEconomicCalendarTime(isoTimestamp: string, timezone: string, timezoneLabel: string): string {
  const formatted = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone }).format(new Date(isoTimestamp))
  return `${formatted} ${timezoneLabel}`
}

export function economicCalendarCompactPrimaryValue(
  event: Pick<EconomicCalendarEventView, 'actual' | 'scheduledAt'>,
  text: { timezone: string; timezoneLabel: string; dateOnly: string }
): string {
  if (event.actual?.displayValue) return event.actual.displayValue
  return event.scheduledAt
    ? formatEconomicCalendarTime(event.scheduledAt, text.timezone, text.timezoneLabel)
    : text.dateOnly
}

/** The four provenances the contract admits; anything else is not a source and is normalised away. */
export function isReleaseTimeSource(value: unknown): value is EconomicCalendarEventView['releaseTimeSource'] {
  return value === 'official' || value === 'convention-default' || value === 'user-edited' || value === 'date-only'
}

function toEventView(event: EconomicCalendarPublicEvent): EconomicCalendarEventView | undefined {
  try {
    const category = economicCalendarEventCategory(event.eventFamily)
    const sources = mapEconomicCalendarProviderIds(event.providerIds, event.caveats)
    if (!category || !sources || !isDate(event.scheduledDate)) return undefined
    return {
      eventKey: event.eventKey, eventFamily: event.eventFamily, titleKey: event.titleKey, periodKey: event.periodKey,
      lifecycleState: event.lifecycleState, coverage: event.coverage, scheduledDate: event.scheduledDate,
      ...(event.scheduledAt ? { scheduledAt: event.scheduledAt } : {}),
      releaseTimeSource: isReleaseTimeSource(event.releaseTimeSource) ? event.releaseTimeSource : 'official',
      detectedAt: event.detectedAt,
      ...(event.publishedAt ? { publishedAt: event.publishedAt } : {}),
      ...(event.createdAt ? { createdAt: event.createdAt } : {}),
      ...(event.actualDetectedAt ? { actualDetectedAt: event.actualDetectedAt } : {}),
      ...(event.actual ? { actual: event.actual } : {}), ...(event.previous ? { previous: event.previous } : {}),
      caveats: [...event.caveats], category, labelKey: economicCalendarEventLabelKey(event), sources
    }
  } catch {
    return undefined
  }
}

function mapEconomicCalendarProviderIds(value: unknown, caveats: readonly string[]): EconomicCalendarSourceKey[] | undefined {
  const providerIds = readExactProviderIds(value)
  if (!providerIds) return undefined
  const sourceByProviderId = new Map<string, EconomicCalendarSourceKey>(economicCalendarPresentationPolicy.providerSourceMappings.map((entry) => [entry.providerId, entry.sourceKey]))
  if (providerIds.some((providerId) => !sourceByProviderId.has(providerId))) return undefined
  return economicCalendarPresentationPolicy.providerSourceMappings
    .filter((entry) => providerIds.includes(entry.providerId))
    .map((entry) => entry.providerId === 'macro-calendar-bls' && caveats.includes('bls-python-schedule') ? 'blsAutomaticSchedule' : entry.sourceKey)
}

function readExactProviderIds(value: unknown): string[] | undefined {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length !== 0) return undefined
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value
    const names = Object.getOwnPropertyNames(value)
    if (!Number.isSafeInteger(length) || length < 1 || names.length !== length + 1 || !names.every((name) => name === 'length' || /^(?:0|[1-9]\d*)$/.test(name))) return undefined
    const providerIds: string[] = []
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string' || providerIds.includes(descriptor.value)) return undefined
      providerIds.push(descriptor.value)
    }
    return providerIds
  } catch {
    return undefined
  }
}

function monthBounds(month: string): { start: string; end: string } | undefined {
  if (!economicCalendarPresentationPolicy.monthPattern.test(month)) return undefined
  const [year, monthNumber] = month.split('-').map(Number)
  const next = new Date(Date.UTC(year, monthNumber, 1))
  return { start: `${month}-01`, end: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01` }
}

function monthGrid(monthStart: string, month: string, byDate: ReadonlyMap<string, EconomicCalendarEventView[]>): EconomicCalendarDayView[] {
  const start = new Date(`${monthStart}T00:00:00.000Z`)
  start.setUTCDate(start.getUTCDate() - start.getUTCDay())
  return Array.from({ length: economicCalendarPresentationPolicy.calendarWeeks * economicCalendarPresentationPolicy.weekdaysPerWeek }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(start.getUTCDate() + index)
    const dateKey = date.toISOString().slice(0, 10)
    return { dateKey, day: date.getUTCDate(), month: dateKey.startsWith(month) ? 'current' : 'outside', events: byDate.get(dateKey) ?? [] }
  })
}

function compareEvents(left: EconomicCalendarEventView, right: EconomicCalendarEventView): number {
  return `${left.scheduledDate}\n${left.scheduledAt ?? economicCalendarPresentationPolicy.undatedTimeSortValue}\n${left.eventKey}`.localeCompare(
    `${right.scheduledDate}\n${right.scheduledAt ?? economicCalendarPresentationPolicy.undatedTimeSortValue}\n${right.eventKey}`
  )
}

function isDate(value: string): boolean {
  return economicCalendarPresentationPolicy.datePattern.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
}

/**
 * Wall-clock text in a zone ⇄ the instant it names.
 *
 * One conversion, and it lives in `platform/time/timeZoneClock`. This file used to carry its own
 * `Intl` arithmetic, which is how the editor ended up with two sources for the same wall clock: the
 * picker formatted the instant on the reader's machine and the save path read it back in the
 * display zone. `wallClockAt` fills the picker, `instantForWallClock` reads it back — both speaking
 * the display zone, so the reader's machine never enters the result.
 *
 * The picker itself only ever holds `YYYY-MM-DDTHH:mm` text and interprets no zone.
 */
export function toWallClock(instant: string, timeZone: string): string | undefined {
  const at = Date.parse(instant)
  if (!Number.isFinite(at)) return undefined
  const wall = wallClockAt(at, timeZone)
  return wall === null ? undefined : `${pad(wall.year, 4)}-${pad(wall.month, 2)}-${pad(wall.day, 2)}T${pad(wall.hour, 2)}:${pad(wall.minute, 2)}`
}

/**
 * The instant a wall clock names in that zone, or `undefined` when the zone is unknown to the
 * runtime. A spring gap is resolved forward by the platform conversion — the caller must write the
 * corrected wall clock back into the picker, or the reader keeps seeing a time that was not stored.
 */
export function fromWallClock(text: string, timeZone: string): string | undefined {
  const parsed = parseWallClock(text)
  if (parsed === undefined) return undefined
  const instant = instantForWallClock({ timeZone, ...parsed })
  return instant === null ? undefined : instant.toISOString()
}

/**
 * Whether the text a reader typed names exactly one instant in that zone.
 *
 * Twice a year a wall clock is not a function: on the autumn change-over `01:00` in New York happens
 * twice. The check is built from the platform conversion rather than its own arithmetic — one
 * conversion, one multiplicity check on top of it.
 */
export function wallClockIsAmbiguous(text: string, timeZone: string): boolean {
  const parsed = parseWallClock(text)
  if (parsed === undefined) return false
  const base = instantForWallClock({ timeZone, ...parsed })
  if (base === null) return false
  const baseMs = base.getTime()
  const matches = new Set<number>()
  // Offsets in force around this wall clock differ by at most a couple of hours; a quarter-hour
  // step finds both candidates without re-deriving the zone's rules here.
  for (let minutes = -120; minutes <= 120; minutes += 15) {
    const at = baseMs + minutes * 60_000
    const wall = wallClockAt(at, timeZone)
    if (wall === null) continue
    if (wall.year === parsed.year && wall.month === parsed.month && wall.day === parsed.day &&
      wall.hour === parsed.hour && wall.minute === parsed.minute) {
      matches.add(at)
    }
  }
  return matches.size > 1
}

/**
 * What a save should write, and what the picker must show afterwards.
 *
 * The component used to decide this inline, which left the correction untested: a spring gap is
 * written forward, and `correctedWallClock` is the text the picker has to show instead of what the
 * reader typed. Returning it here is what makes "the screen never shows a time that was not stored"
 * checkable without driving a picker.
 */
export type ReleaseTimeWrite =
  | Readonly<{ kind: 'ambiguous' }>
  | Readonly<{ kind: 'invalid' }>
  | Readonly<{ kind: 'write'; instant: string; scheduledDate: string; correctedWallClock?: string }>

export function resolveReleaseTimeWrite(wallClock: string, timeZone: string): ReleaseTimeWrite {
  if (wallClockIsAmbiguous(wallClock, timeZone)) return { kind: 'ambiguous' }
  const instant = fromWallClock(wallClock, timeZone)
  if (instant === undefined) return { kind: 'invalid' }
  const stored = toWallClock(instant, timeZone)
  return {
    kind: 'write',
    instant,
    scheduledDate: wallClock.slice(0, 10),
    ...(stored !== undefined && stored !== wallClock ? { correctedWallClock: stored } : {})
  }
}

function parseWallClock(text: string): { year: number; month: number; day: number; hour: number; minute: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text)
  if (!match) return undefined
  const [, year, month, day, hour, minute] = match
  const parts = { year: Number(year), month: Number(month), day: Number(day), hour: Number(hour), minute: Number(minute) }
  // The platform conversion normalises out-of-range parts (month 13 becomes January), so the text
  // has to be a real date before it is asked about — otherwise "the 13th month" would be answered
  // as if it meant something.
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return undefined
  if (parts.hour > 23 || parts.minute > 59) return undefined
  const asUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  if (asUtc.getUTCMonth() !== parts.month - 1 || asUtc.getUTCDate() !== parts.day) return undefined
  return parts
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}
