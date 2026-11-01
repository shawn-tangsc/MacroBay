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
  windowHours: DailyBriefingWindowHours
  updatedAt: string
}>

export type DailyBriefingGenerationSettingsPatch = Readonly<{
  generationTime?: string
  windowHours?: number
}>

export const dailyBriefingGenerationSettingsPolicy = Object.freeze({
  generationTimeInvalidError: 'daily-briefing-generation-time-invalid',
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
  if (patch.windowHours !== undefined && !isDailyBriefingWindowHours(patch.windowHours)) {
    throw new Error(dailyBriefingGenerationSettingsPolicy.windowHoursInvalidError)
  }
  return normalizeDailyBriefingGenerationSettings({
    generationTime: patch.generationTime ?? current.generationTime,
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
export function dailyBriefingCutoffMinutes(generationTime: string): number {
  const [hour, minute] = generationTime.split(':').map(Number)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    const [fallbackHour, fallbackMinute] = dailyBriefingGenerationPolicy.defaultGenerationTime.split(':').map(Number)
    return fallbackHour! * 60 + fallbackMinute!
  }
  return hour * 60 + minute
}
