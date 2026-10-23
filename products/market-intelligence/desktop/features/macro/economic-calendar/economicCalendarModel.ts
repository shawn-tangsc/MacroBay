import type { MacroEconomicCalendarEventView } from '../../../../contracts/macro/economicCalendarQueryContracts'
import { macroEconomicCalendarCaveatPolicy } from '../../../shared/macroEconomicCalendarCaveatPolicy'

export type EconomicCalendarPublicEvent = MacroEconomicCalendarEventView
export type EconomicCalendarCategory = 'inflation' | 'employment' | 'growth' | 'monetary-policy' | 'consumption'
export type EconomicCalendarTitleKey = 'fomc' | 'cpi' | 'core-cpi' | 'nonfarm-payrolls' | 'unemployment' | 'average-hourly-earnings' | 'pce' | 'core-pce' | 'gdp' | 'unknown'
export type EconomicCalendarSourceKey = 'federalReserve' | 'bea' | 'blsManualIcs' | 'blsAutomaticSchedule'

export type EconomicCalendarEventView = Pick<
  EconomicCalendarPublicEvent,
  'eventKey' | 'eventFamily' | 'titleKey' | 'periodKey' | 'lifecycleState' | 'coverage' | 'scheduledDate' |
  'scheduledAt' | 'releaseTimeSource' | 'publishedAt' | 'detectedAt' | 'actual' | 'previous' | 'caveats'
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
 * `toWallClock` is what a `<input type="datetime-local">` must be given, and `fromWallClock` is what
 * it hands back. The conversion cannot use `Date.UTC` with the parsed parts: UTC is itself just
 * another zone here, and only the Intl database knows what the zone was on that date — which is the
 * whole point, since a release time in New York moves by an hour twice a year.
 *
 * `fromWallClock` returns `undefined` rather than a guessed instant when the text names no real
 * moment or does not survive the round trip (a time inside a daylight-saving gap, for instance).
 * Refusing is correct: an hour that does not exist must not be silently moved to one that does.
 */
export function toWallClock(instant: string, timeZone: string): string | undefined {
  const at = Date.parse(instant)
  if (!Number.isFinite(at)) return undefined
  const parts = zoneParts(at, timeZone)
  return parts === undefined ? undefined : `${parts.date}T${parts.time}`
}

export function fromWallClock(text: string, timeZone: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text)
  if (!match) return undefined
  const [, year, month, day, hour, minute] = match
  const naive = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
  if (!Number.isFinite(naive)) return undefined
  // The first guess is off by the zone's offset; correcting once lands on the instant unless the
  // guess crossed a transition, in which case the second correction settles it.
  let instant = naive
  for (let attempt = 0; attempt < 2; attempt++) {
    const parts = zoneParts(instant, timeZone)
    if (parts === undefined) return undefined
    const shown = Date.UTC(Number(parts.date.slice(0, 4)), Number(parts.date.slice(5, 7)) - 1, Number(parts.date.slice(8, 10)), Number(parts.time.slice(0, 2)), Number(parts.time.slice(3, 5)))
    instant += naive - shown
  }
  const settled = zoneParts(instant, timeZone)
  return settled !== undefined && settled.date === `${year}-${month}-${day}` && settled.time === `${hour}:${minute}`
    ? new Date(instant).toISOString()
    : undefined
}

/**
 * Whether the text a reader typed names exactly one instant in that zone.
 *
 * Twice a year a wall clock is not a function: on the autumn change-over `01:00` in New York happens
 * twice, once at each offset. A time that happens twice is not an error to hide — the reader is
 * asked to disambiguate rather than being given whichever hour we happened to pick.
 */
export function wallClockIsAmbiguous(text: string, timeZone: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text)
  if (!match) return false
  const naive = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]))
  // A repeated wall clock has one instant in each of the two offsets that were in force around it,
  // and **both** of them must still render back to the text the reader wrote.
  const offsets = new Set<number>()
  for (const probe of [naive - 36 * 3_600_000, naive, naive + 36 * 3_600_000]) {
    const parts = zoneParts(probe, timeZone)
    if (parts !== undefined) offsets.add(offsetBetweenWallClockAndInstant(parts, probe))
  }
  // Each offset that was in force near this wall clock yields its own candidate instant.
  const candidates = new Set<number>()
  for (const offset of offsets) candidates.add(naive - offset)
  return new Set([...candidates].filter((at) => {
    const parts = zoneParts(at, timeZone)
    return parts !== undefined && parts.date === `${match[1]}-${match[2]}-${match[3]}` && parts.time === `${match[4]}:${match[5]}`
  })).size > 1
}

function offsetBetweenWallClockAndInstant(parts: { date: string; time: string }, at: number): number {
  const shown = Date.UTC(Number(parts.date.slice(0, 4)), Number(parts.date.slice(5, 7)) - 1, Number(parts.date.slice(8, 10)), Number(parts.time.slice(0, 2)), Number(parts.time.slice(3, 5)))
  return shown - at
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>()

function zoneParts(at: number, timeZone: string): { date: string; time: string } | undefined {
  let formatter = zoneFormatters.get(timeZone)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    zoneFormatters.set(timeZone, formatter)
  }
  const parts = formatter.formatToParts(new Date(at))
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value
  const year = read('year'); const month = read('month'); const day = read('day'); const hour = read('hour'); const minute = read('minute')
  return year === undefined || month === undefined || day === undefined || hour === undefined || minute === undefined
    ? undefined
    : { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` }
}
