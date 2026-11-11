import {
  DEFAULT_PERIOD_ID,
  dailyBriefingGenerationPolicy,
  isDailyBriefingGenerationTime,
  isDailyBriefingWindowHours,
  type DailyBriefingWindowHours
} from '../../../contracts/dailyBriefing'

/**
 * One edition period: **when it runs and how far back it looks** — nothing else.
 *
 * Language is not here on purpose (it is global, and it lives in its own settings file): a period
 * with its own language would let one morning be Chinese and the evening be English, which no
 * reader can predict, and the interface language changing would move both.
 *
 * Nothing derived is stored either. `generationTimeZone` holds **the reader's raw value**, never a
 * verdict about it: "is this a zone we can parse" is computed at the read site by
 * `generationTimeZoneIssue`, so a stored flag cannot contradict the value it describes.
 */
export type DailyBriefingPeriod = Readonly<{
  id: string
  name?: string
  generationTime: string
  /** Raw as the reader saved it (or as an older file carried it); empty means "follow the reader". */
  generationTimeZone?: string
  windowHours: DailyBriefingWindowHours
}>

/** The stored shape: one or more periods. A save is the only thing that writes it. */
export type DailyBriefingPeriodsSettings = Readonly<{
  periods: readonly DailyBriefingPeriod[]
  updatedAt: string
}>

/**
 * What one edition needs from a period: the time it runs and the interval it covers.
 *
 * Kept as its own type because the window arithmetic (and the services that call it) must not learn
 * about period lists just to read two numbers. A period is assignable to it.
 */
export type DailyBriefingGenerationSettings = Readonly<{
  generationTime: string
  windowHours: DailyBriefingWindowHours
}>

export const dailyBriefingGenerationSettingsPolicy = Object.freeze({
  generationTimeInvalidError: 'daily-briefing-generation-time-invalid',
  generationTimeZoneInvalidError: 'daily-briefing-generation-time-zone-invalid',
  windowHoursInvalidError: 'daily-briefing-window-hours-invalid'
})

export function createDefaultDailyBriefingPeriodsSettings(
  now = new Date().toISOString()
): DailyBriefingPeriodsSettings {
  return Object.freeze({
    periods: Object.freeze([createDefaultDailyBriefingPeriod()]),
    updatedAt: now
  })
}

export function createDefaultDailyBriefingPeriod(): DailyBriefingPeriod {
  return Object.freeze({
    id: DEFAULT_PERIOD_ID,
    generationTime: dailyBriefingGenerationPolicy.defaultGenerationTime,
    windowHours: dailyBriefingGenerationPolicy.defaultWindowHours
  })
}

function trimmed(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * One stored entry, repaired only where a value cannot be used at all.
 *
 * A time or a window that is not one of the supported values falls back to the policy default — an
 * older file without these keys is simply the default schedule. The zone is **not** repaired and not
 * classified here: its raw text is carried through so the reader can be told which value is wrong.
 *
 * An older file kept an unreadable zone in `generationTimeZoneInvalid` and left `generationTimeZone`
 * empty, so that field holds the reader's only copy of the value. Its **text** is carried over; the
 * verdict it stood for is not — that is what `generationTimeZoneIssue` decides now.
 */
function periodFromRecord(record: Record<string, unknown>, id: string): DailyBriefingPeriod {
  const name = trimmed(record.name)
  const zone = trimmed(record.generationTimeZone) ?? trimmed(record.generationTimeZoneInvalid)
  return Object.freeze({
    id,
    ...(name ? { name } : {}),
    generationTime: isDailyBriefingGenerationTime(record.generationTime)
      ? record.generationTime
      : dailyBriefingGenerationPolicy.defaultGenerationTime,
    ...(zone ? { generationTimeZone: zone } : {}),
    windowHours: isDailyBriefingWindowHours(record.windowHours)
      ? record.windowHours
      : dailyBriefingGenerationPolicy.defaultWindowHours
  })
}

/**
 * Read whatever is on disk as periods, **pure and without writing anything**.
 *
 * Two shapes are accepted:
 * - `{ periods: [...] }` — this version's shape;
 * - `{ generationTime, generationTimeZone?, windowHours }` — what every earlier version wrote, read
 *   as one period with the stable id `default`. Opening settings therefore upgrades nothing on disk;
 *   the file only becomes the new shape when the reader saves.
 *
 * The older `generationTimeZoneInvalid` field is no longer read as a verdict — that is asserted here
 * instead — but its text is the reader's only copy of a value we could not read, so it is carried
 * into the period's raw zone. Dropping it would silently resume automatic generation in the
 * reader's zone, which is the guess §6 forbids.
 */
export function readDailyBriefingPeriodsSettings(
  raw: unknown,
  now = new Date().toISOString()
): DailyBriefingPeriodsSettings {
  if (!isRecord(raw)) return createDefaultDailyBriefingPeriodsSettings(now)
  const updatedAt = trimmed(raw.updatedAt) ?? now

  if (Array.isArray(raw.periods)) {
    const seen = new Set<string>()
    const periods: DailyBriefingPeriod[] = []
    for (const entry of raw.periods) {
      if (!isRecord(entry)) continue
      // A blank id cannot be addressed by a schedule, so it means the one period every file has.
      const id = trimmed(entry.id) ?? DEFAULT_PERIOD_ID
      // A repeated id would make "which period does this definition belong to" ambiguous: the first
      // entry wins, deterministically, and the later one is not silently merged into it.
      if (seen.has(id)) continue
      seen.add(id)
      periods.push(periodFromRecord(entry, id))
    }
    // Zero usable periods is not a state the reader can reach; the default keeps every consumer total.
    if (periods.length === 0) return createDefaultDailyBriefingPeriodsSettings(now)
    return Object.freeze({ periods: Object.freeze(periods), updatedAt })
  }

  const looksSinglePeriod = 'generationTime' in raw || 'windowHours' in raw || 'generationTimeZone' in raw
  if (!looksSinglePeriod) return createDefaultDailyBriefingPeriodsSettings(now)
  return Object.freeze({
    periods: Object.freeze([periodFromRecord(raw, DEFAULT_PERIOD_ID)]),
    updatedAt
  })
}

/**
 * Is the stored zone value usable? The **one** judgement, shared by the scheduler and the page.
 *
 * It reads the raw value and nothing else, so it does not depend on the reader's current zone: the
 * same setting opened in two zones must reach the same verdict, otherwise "valid" would follow the
 * window. An absent or blank value is not an issue — it means "use the reader's display zone".
 */
export function generationTimeZoneIssue(value?: string): 'unparseable' | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  return isDailyBriefingTimeZoneId(value.trim()) ? undefined : 'unparseable'
}

/**
 * A zone id is usable when the platform can format a clock in it. Anything else (a mistyped
 * `Asia/Shangai`, a blank, an old numeric offset) is not a zone: the reader gets the one sentence
 * that says automatic generation is paused, and the schedule falls back to no zone rather than
 * silently pretending to be UTC.
 */
export function isDailyBriefingTimeZoneId(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date())
    return true
  } catch {
    return false
  }
}

/**
 * The scheduler trigger. Derived from the same value that decides the cutoff, so a reader who moves
 * generation to 09:30 gets a 30 9 cron and a 09:30 cutoff in one save.
 */
export function dailyBriefingGenerationCronExpression(settings: Pick<DailyBriefingPeriod, 'generationTime'>): string {
  const [hour, minute] = settings.generationTime.split(':').map(Number)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    const [fallbackHour, fallbackMinute] = dailyBriefingGenerationPolicy.defaultGenerationTime.split(':').map(Number)
    return `${fallbackMinute} ${fallbackHour} * * *`
  }
  return `${minute} ${hour} * * *`
}

/** The wall-clock cutoff a generation time names: minutes after midnight in its own zone. */
export function dailyBriefingCutoffMinutes(generationTime: string): number {
  const [hour, minute] = generationTime.split(':').map(Number)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    const [fallbackHour, fallbackMinute] = dailyBriefingGenerationPolicy.defaultGenerationTime.split(':').map(Number)
    return fallbackHour! * 60 + fallbackMinute!
  }
  return hour * 60 + minute
}
