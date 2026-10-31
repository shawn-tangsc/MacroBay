/**
 * Which day a closing observation belongs to, and when the next one is expected.
 *
 * The daily brief compares a reading with the *previous observation*, which is not the same thing
 * as "24 hours ago". The dollar, gold, the ten-year and the ETF flows only print on a US trading
 * day: on a weekend or a market holiday there is no new close to compare against, and the honest
 * baseline is the close of the last session that actually traded. This module owns that calendar.
 *
 * The rules are the NYSE's published observance rules, computed rather than tabulated so they do
 * not expire: weekends, New Year's Day, Martin Luther King Jr. Day, Washington's Birthday, Good
 * Friday, Memorial Day, Juneteenth, Independence Day, Labor Day, Thanksgiving and Christmas, with
 * a Saturday holiday observed on the preceding Friday and a Sunday holiday on the following
 * Monday. Special one-off closings (a national day of mourning) are deliberately not modelled:
 * they move one session, and the brief's tolerance for a missing session covers them.
 *
 * All day arithmetic is in UTC civil dates. The calendar's own time zone only decides when a US
 * cash session has finished for a real instant (`lastCompletedUsSession`); the day keys this
 * module compares are the UTC dates the sources stamp, never a local midnight shifted across a
 * time zone.
 */
export const tradingDayCalendarPolicy = Object.freeze({
  /** The exchange calendar the closing observations belong to. */
  timeZone: 'America/New_York',
  /** The regular US cash close, in local time. Early closes are treated as a later finish. */
  regularCloseHour: 16,
  calendarDatePattern: /^\d{4}-\d{2}-\d{2}$/,
  /** How far back a previous trading day is searched; no exchange closure is longer. */
  maximumLookbackDays: 10
})

export type UsEquityHolidayKey =
  | 'new-year'
  | 'martin-luther-king'
  | 'washington-birthday'
  | 'good-friday'
  | 'memorial-day'
  | 'juneteenth'
  | 'independence-day'
  | 'labor-day'
  | 'thanksgiving'
  | 'christmas'

const DAY_MS = 24 * 60 * 60 * 1_000

/** The holiday a US trading date is closed for, or `undefined` on a session day. */
export function usEquityHoliday(day: string): UsEquityHolidayKey | undefined {
  const instant = dayMs(day)
  if (instant === undefined) return undefined
  const weekday = new Date(instant).getUTCDay()
  if (weekday === 0 || weekday === 6) return undefined
  const year = new Date(instant).getUTCFullYear()
  // New Year's Day alone can be observed in the preceding December, so both neighbours count.
  for (const candidateYear of [year - 1, year, year + 1]) {
    const holiday = holidaysOf(candidateYear).find((entry) => entry.day === day)
    if (holiday) return holiday.key
  }
  return undefined
}

/** Whether a US cash session traded on this civil date. */
export function isUsEquityTradingDay(day: string): boolean {
  const instant = dayMs(day)
  if (instant === undefined) return false
  const weekday = new Date(instant).getUTCDay()
  return weekday !== 0 && weekday !== 6 && usEquityHoliday(day) === undefined
}

/** The last trading day strictly before `day`; `undefined` only for an unreadable date. */
export function previousUsEquityTradingDay(day: string): string | undefined {
  const instant = dayMs(day)
  if (instant === undefined) return undefined
  for (let offset = 1; offset <= tradingDayCalendarPolicy.maximumLookbackDays; offset += 1) {
    const candidate = iso(instant - offset * DAY_MS)
    if (isUsEquityTradingDay(candidate)) return candidate
  }
  return undefined
}

/** The next trading day strictly after `day`; `undefined` only for an unreadable date. */
export function nextUsEquityTradingDay(day: string): string | undefined {
  const instant = dayMs(day)
  if (instant === undefined) return undefined
  for (let offset = 1; offset <= tradingDayCalendarPolicy.maximumLookbackDays; offset += 1) {
    const candidate = iso(instant + offset * DAY_MS)
    if (isUsEquityTradingDay(candidate)) return candidate
  }
  return undefined
}

/**
 * Trading days in `(after, through]`.
 *
 * This is the distance between an observed session and the session the brief expects: zero means
 * the observation is the newest close that could exist, one means a single session is missing.
 * A value at or after `through` is zero rather than negative — an observation stamped later than
 * the expected session (an ETF row stamped when it was published) is not "ahead" of the calendar.
 */
export function tradingDaysBetween(after: string, through: string): number {
  const start = dayMs(after)
  const end = dayMs(through)
  if (start === undefined || end === undefined || end <= start) return 0
  let count = 0
  for (let instant = start + DAY_MS; instant <= end; instant += DAY_MS) {
    if (isUsEquityTradingDay(iso(instant))) count += 1
  }
  return count
}

/**
 * The newest US cash session whose close is complete at `asOf`.
 *
 * The brief is generated at a morning hour, before the US session opens, so the answer is the
 * previous trading day — but reading the clock instead of assuming it keeps a late regeneration
 * from treating a session that has not closed as an expected observation. Early closes are not
 * modelled: waiting for the regular close can only make the brief accept an older close, never
 * invent a newer one.
 */
export function lastCompletedUsSession(asOf: string): string | undefined {
  const instant = Date.parse(asOf)
  if (!Number.isFinite(instant)) return undefined
  const local = easternParts(new Date(instant))
  if (local === undefined) {
    return previousUsEquityTradingDay(iso(instant))
  }
  const today = isUsEquityTradingDay(local.date)
  const closed = local.hour >= tradingDayCalendarPolicy.regularCloseHour
  // A trading day whose close has passed is the answer; otherwise step back over the weekend and
  // any holiday to the last session that really finished.
  return today && closed ? local.date : previousUsEquityTradingDay(local.date)
}

/**
 * Sessions between the observation's own day and the session the brief expects at `asOf`.
 *
 * `undefined` means the calendar could not judge the observation (an unparseable instant or day);
 * the caller then keeps its own staleness rule rather than inventing a verdict.
 */
export function tradingSessionsBehind(observedAt: string, asOf: string): number | undefined {
  const observedDay = observedAt.slice(0, 10)
  if (!tradingDayCalendarPolicy.calendarDatePattern.test(observedDay)) return undefined
  const expected = lastCompletedUsSession(asOf)
  if (expected === undefined) return undefined
  return tradingDaysBetween(observedDay, expected)
}

function dayMs(day: string): number | undefined {
  if (!tradingDayCalendarPolicy.calendarDatePattern.test(day)) return undefined
  const [year, month, date] = day.split('-').map(Number)
  const instant = Date.UTC(year, month - 1, date)
  return iso(instant) === day ? instant : undefined
}

function iso(instant: number): string {
  return new Date(instant).toISOString().slice(0, 10)
}

type EasternParts = Readonly<{ date: string; hour: number }>

function easternParts(instant: Date): EasternParts | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tradingDayCalendarPolicy.timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
    }).formatToParts(instant)
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
    const date = `${value('year')}-${value('month')}-${value('day')}`
    if (!tradingDayCalendarPolicy.calendarDatePattern.test(date)) return undefined
    return Object.freeze({ date, hour: Number(value('hour')) })
  } catch {
    return undefined
  }
}

/** Every closure of one calendar year, already shifted to the weekday it is observed on. */
function holidaysOf(year: number): readonly Readonly<{ day: string; key: UsEquityHolidayKey }>[] {
  return Object.freeze([
    entry(observedFixed(year, 1, 1), 'new-year'),
    entry(nthWeekday(year, 1, 1, 3), 'martin-luther-king'),
    entry(nthWeekday(year, 2, 1, 3), 'washington-birthday'),
    entry(iso(easterSunday(year) - 2 * DAY_MS), 'good-friday'),
    entry(lastWeekday(year, 5, 1), 'memorial-day'),
    entry(observedFixed(year, 6, 19), 'juneteenth'),
    entry(observedFixed(year, 7, 4), 'independence-day'),
    entry(nthWeekday(year, 9, 1, 1), 'labor-day'),
    entry(nthWeekday(year, 11, 4, 4), 'thanksgiving'),
    entry(observedFixed(year, 12, 25), 'christmas')
  ])
}

function entry(day: string, key: UsEquityHolidayKey): Readonly<{ day: string; key: UsEquityHolidayKey }> {
  return Object.freeze({ day, key })
}

/** A fixed-date closure, observed on the nearest weekday. */
function observedFixed(year: number, month: number, date: number): string {
  const instant = Date.UTC(year, month - 1, date)
  const weekday = new Date(instant).getUTCDay()
  if (weekday === 6) return iso(instant - DAY_MS)
  if (weekday === 0) return iso(instant + DAY_MS)
  return iso(instant)
}

/** `n`th `weekday` (0 = Sunday) of a month, in UTC civil days. */
function nthWeekday(year: number, month: number, weekday: number, nth: number): string {
  const first = Date.UTC(year, month - 1, 1)
  const offset = (weekday - new Date(first).getUTCDay() + 7) % 7
  return iso(first + (offset + (nth - 1) * 7) * DAY_MS)
}

function lastWeekday(year: number, month: number, weekday: number): string {
  const last = Date.UTC(year, month, 0)
  const offset = (new Date(last).getUTCDay() - weekday + 7) % 7
  return iso(last - offset * DAY_MS)
}

/** Easter Sunday, Gregorian calendar (anonymous computus). */
function easterSunday(year: number): number {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const date = ((h + l - 7 * m + 114) % 31) + 1
  return Date.UTC(year, month - 1, date)
}
