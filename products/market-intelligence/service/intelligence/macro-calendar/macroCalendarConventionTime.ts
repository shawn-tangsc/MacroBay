import { toUtcIsoFromOfficialEasternTime } from './macroCalendarTimeZone'

/**
 * The release time a family is *expected* to use, when the source itself does not state one.
 *
 * This exists because some official schedules genuinely publish a date and nothing else: the Fed's
 * FOMC calendar lists meeting days (`October 27-28`), and the BLS annual page that our automatic
 * schedule sync reads carries no clock time, which is why those rows were stored date-only on
 * purpose. That is honest, but it is also unhelpful — a reader cannot say when the number lands.
 *
 * The line this module must not cross: a convention is **not** an official time. It is this
 * product's expectation, and it travels with its own provenance (`convention-default`) so no screen
 * and no model can read it as something the source published. It is also the lowest-precedence
 * source there is: an official time, or the reader's own edit, always wins.
 *
 * Times are the long-standing publication conventions in US Eastern local time, converted through
 * the product's existing Eastern-time helper so daylight saving is handled once, in one place. The
 * values match what the official feeds already carry where they do state a time (BEA's own rows sit
 * at 12:30Z in summer and 13:30Z in winter — both 08:30 Eastern).
 */
export const macroCalendarConventionTimePolicy = Object.freeze({
  /** The reader's local time the conventions are written in; never a fixed UTC offset. */
  localZone: 'America/New_York',
  /** Per release family, `HH:MM` in `localZone`. Families absent here get no convention default. */
  byEventFamily: Object.freeze({
    'consumer-price-index': '08:30',
    'employment-situation': '08:30',
    // BEA's own released rows already carry 08:30 Eastern; the convention only fills its gaps.
    pce: '08:30',
    'core-pce': '08:30',
    gdp: '08:30',
    // The FOMC statement and press conference: the calendar publishes days, the convention is 14:00.
    fomc: '14:00'
  } as const),
  /** Provenance labels. `convention` is deliberately distinct from anything a source published. */
  provenance: Object.freeze({
    official: 'official', conventionDefault: 'convention-default', userEdited: 'user-edited', dateOnly: 'date-only'
  } as const)
})

export type MacroCalendarTimeProvenance = typeof macroCalendarConventionTimePolicy.provenance[keyof typeof macroCalendarConventionTimePolicy.provenance]

const localTimes: Readonly<Record<string, string>> = macroCalendarConventionTimePolicy.byEventFamily

/**
 * The convention instant for a family on a given date, or `undefined` when the family has no
 * convention (or the date is not a real calendar date). `undefined` is not an error: it is the
 * honest answer for a family nobody has a defensible expectation about.
 */
export function conventionReleaseInstant(eventFamily: string, scheduledDate: string): string | undefined {
  const time = localTimes[eventFamily]
  if (time === undefined) return undefined
  return toUtcIsoFromOfficialEasternTime(scheduledDate, time)
}

/**
 * The time a row should display, with the provenance of whichever source supplied it. Precedence is
 * the whole point: a reader's edit beats a published time, a published time beats our expectation,
 * and with none of the three the row stays date-only rather than borrowing a number.
 */
export function resolveDisplayedReleaseTime(input: Readonly<{
  eventFamily: string
  scheduledDate: string
  officialScheduledAt?: string
  userEditedAt?: string
}>): Readonly<{ scheduledAt?: string; provenance: MacroCalendarTimeProvenance; conventionAt?: string }> {
  const conventionAt = conventionReleaseInstant(input.eventFamily, input.scheduledDate)
  if (input.userEditedAt !== undefined) {
    return { scheduledAt: input.userEditedAt, provenance: macroCalendarConventionTimePolicy.provenance.userEdited, ...(conventionAt === undefined ? {} : { conventionAt }) }
  }
  if (input.officialScheduledAt !== undefined) {
    return { scheduledAt: input.officialScheduledAt, provenance: macroCalendarConventionTimePolicy.provenance.official, ...(conventionAt === undefined ? {} : { conventionAt }) }
  }
  if (conventionAt !== undefined) {
    return { scheduledAt: conventionAt, provenance: macroCalendarConventionTimePolicy.provenance.conventionDefault, conventionAt }
  }
  return { provenance: macroCalendarConventionTimePolicy.provenance.dateOnly }
}
