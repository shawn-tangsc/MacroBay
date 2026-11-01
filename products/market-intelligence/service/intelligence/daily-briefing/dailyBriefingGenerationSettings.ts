import {
  dailyBriefingGenerationPolicy,
  isDailyBriefingGenerationTime,
  isDailyBriefingWindowHours,
  type DailyBriefingWindowHours
} from '../../../contracts/dailyBriefing'

/**
 * When the automatic edition runs and how far back it looks.
 *
 * These two numbers are the whole setting: the job trigger is derived from `generationTime`, and so
 * is the edition cutoff, so "generate at 07:30" and "cover the 07:30 cutoff" cannot disagree. The
 * window is the length of the statistical interval ending at that cutoff.
 */
export type DailyBriefingGenerationSettings = Readonly<{
  generationTime: string
  /**
   * The IANA zone the time is written in. Absent on settings saved before the zone existed; the
   * first read fills it in from the reader's display zone (see the settings service) — a bare
   * 08:05 otherwise moves whenever the display zone changes, which is how one day produced two
   * editions and three runs.
   */
  generationTimeZone?: string
  /**
   * The zone the reader saved when it was not a usable id (`Asia/Shangai`). Kept, never repaired
   * to something plausible: the reader has to see which value is wrong, and the schedule pauses
   * until it is fixed.
   */
  generationTimeZoneInvalid?: string
  windowHours: DailyBriefingWindowHours
  updatedAt: string
}>

export type DailyBriefingGenerationSettingsPatch = Readonly<{
  generationTime?: string
  /** The zone the reader is seeing the time in; a save re-anchors the schedule to it. */
  generationTimeZone?: string
  windowHours?: number
}>

export const dailyBriefingGenerationSettingsPolicy = Object.freeze({
  generationTimeInvalidError: 'daily-briefing-generation-time-invalid',
  generationTimeZoneInvalidError: 'daily-briefing-generation-time-zone-invalid',
  windowHoursInvalidError: 'daily-briefing-window-hours-invalid'
})

export function createDefaultDailyBriefingGenerationSettings(
  now = new Date().toISOString()
): DailyBriefingGenerationSettings {
  return {
    generationTime: dailyBriefingGenerationPolicy.defaultGenerationTime,
    windowHours: dailyBriefingGenerationPolicy.defaultWindowHours,
    updatedAt: now
  }
}

/**
 * The stored zone as either a usable id or the value that could not be read, never both: a reader
 * who typed `Asia/Shangai` has to see that exact string, and a repaired one would hide the typo.
 */
function zoneFields(value: unknown): Readonly<{ generationTimeZone?: string; generationTimeZoneInvalid?: string }> {
  if (typeof value !== 'string' || value.trim().length === 0) return {}
  const trimmed = value.trim()
  return isDailyBriefingTimeZoneId(trimmed) ? { generationTimeZone: trimmed } : { generationTimeZoneInvalid: trimmed }
}

/**
 * Stored or patched values are repaired to the defaults instead of failing a read: an old settings
 * file without these keys is simply the default schedule. Writing a patch is strict — see
 * `applyDailyBriefingGenerationSettingsPatch`.
 */
export function normalizeDailyBriefingGenerationSettings(
  input: Partial<DailyBriefingGenerationSettings> | undefined,
  now = new Date().toISOString()
): DailyBriefingGenerationSettings {
  const defaults = createDefaultDailyBriefingGenerationSettings(now)
  return {
    generationTime: isDailyBriefingGenerationTime(input?.generationTime)
      ? input.generationTime
      : defaults.generationTime,
    ...zoneFields(input?.generationTimeZone),
    windowHours: isDailyBriefingWindowHours(input?.windowHours)
      ? input.windowHours
      : defaults.windowHours,
    updatedAt: typeof input?.updatedAt === 'string' && input.updatedAt ? input.updatedAt : defaults.updatedAt
  }
}

/** A save is a reader action: an unsupported time or window must be rejected, not repaired. */
export function applyDailyBriefingGenerationSettingsPatch(
  current: DailyBriefingGenerationSettings,
  patch: DailyBriefingGenerationSettingsPatch,
  now: string
): DailyBriefingGenerationSettings {
  if (patch.generationTime !== undefined && !isDailyBriefingGenerationTime(patch.generationTime)) {
    throw new Error(dailyBriefingGenerationSettingsPolicy.generationTimeInvalidError)
  }
  if (patch.generationTimeZone !== undefined && !isDailyBriefingTimeZoneId(patch.generationTimeZone)) {
    throw new Error(dailyBriefingGenerationSettingsPolicy.generationTimeZoneInvalidError)
  }
  if (patch.windowHours !== undefined && !isDailyBriefingWindowHours(patch.windowHours)) {
    throw new Error(dailyBriefingGenerationSettingsPolicy.windowHoursInvalidError)
  }
  return normalizeDailyBriefingGenerationSettings({
    generationTime: patch.generationTime ?? current.generationTime,
    ...(patch.generationTimeZone ?? current.generationTimeZone
      ? { generationTimeZone: (patch.generationTimeZone ?? current.generationTimeZone)! }
      : {}),
    windowHours: patch.windowHours ?? current.windowHours,
    updatedAt: now
  }, now)
}

/**
 * The scheduler trigger. Derived from the same value that decides the cutoff, so a reader who moves
 * generation to 09:30 gets a 30 9 cron and a 09:30 cutoff in one save.
 */
export function dailyBriefingGenerationCronExpression(settings: Pick<DailyBriefingGenerationSettings, 'generationTime'>): string {
  const [hour, minute] = settings.generationTime.split(':').map(Number)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    const [fallbackHour, fallbackMinute] = dailyBriefingGenerationPolicy.defaultGenerationTime.split(':').map(Number)
    return `${fallbackMinute} ${fallbackHour} * * *`
  }
  return `${minute} ${hour} * * *`
}

/** The local cutoff a generation time names: minutes after local midnight. */
/**
 * A zone id is usable when the platform can format a clock in it. Anything else (a mistyped
 * `Asia/Shangai`, a blank, an old numeric offset) is not stored: the reader gets the one sentence
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

/** The wall-clock cutoff a generation time names: minutes after midnight in its own zone. */
export function dailyBriefingCutoffMinutes(generationTime: string): number {
  const [hour, minute] = generationTime.split(':').map(Number)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    const [fallbackHour, fallbackMinute] = dailyBriefingGenerationPolicy.defaultGenerationTime.split(':').map(Number)
    return fallbackHour! * 60 + fallbackMinute!
  }
  return hour * 60 + minute
}
