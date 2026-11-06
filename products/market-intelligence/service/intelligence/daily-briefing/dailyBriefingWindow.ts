import {
  dailyBriefingGenerationPolicy,
  isDailyBriefingGenerationTime,
  isDailyBriefingWindowHours
} from '../../../contracts/dailyBriefing'
import { dailyBriefingCutoffMinutes, type DailyBriefingGenerationSettings } from './dailyBriefingGenerationSettings'

/**
 * The edition window, in one place.
 *
 * A daily edition is not a rolling read from "now": its window is [the previous generation time,
 * the current generation time), both local wall-clock. The cutoff is the reader's generation
 * setting (07:00 for a fresh install, the stored value on an upgraded machine), so moving the
 * schedule moves the cutoff with it.
 *
 * This lives beside the schedule setting rather than inside the service: the arithmetic is pure, and
 * keeping it in the service made the file carry both the run and the calendar.
 */
export type DailyBriefingZoneSource = 'settings' | 'system'

export type DailyBriefingWindow = Readonly<{
  date: string
  windowStart: string
  windowEnd: string
  windowHours: number
  /**
   * Which zone produced the wall-clock. `system` means the settings zone was empty or invalid and the
   * machine's own zone stood in — the caller must surface that, because the reader's day may differ
   * from the one they configured and nothing else on screen would say so.
   */
  zoneSource: DailyBriefingZoneSource
}>

/** What a caller may override; anything invalid falls back to the policy default. */
export type DailyBriefingWindowSettings = Partial<Pick<DailyBriefingGenerationSettings, 'generationTime' | 'windowHours'>>

/** What the reader's machine says its zone is; the last resort when the setting itself is unusable. */
export function systemTimeZone(): string {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone
    return resolved !== undefined && isValidTimeZone(resolved) ? resolved : 'UTC'
  } catch {
    return 'UTC'
  }
}

export function briefingWindow(
  asOf: string,
  timeZone: string,
  settings: DailyBriefingWindowSettings = {},
  /**
   * The zone to stand in with when the settings zone is unusable. Defaults to the machine's; a caller
   * only passes it in tests, where the machine's zone is not the one under test.
   */
  fallbackTimeZone: string = systemTimeZone()
): DailyBriefingWindow | undefined {
  const parsed = Date.parse(asOf)
  if (!Number.isFinite(parsed)) return undefined
  // A broken or empty setting must not be read as UTC: that silently moves the reader's day by whole
  // hours and says nothing. The machine's zone is a closer guess, and `zoneSource` makes it visible.
  const zoneSource: DailyBriefingZoneSource = isValidTimeZone(timeZone) ? 'settings' : 'system'
  const zone = zoneSource === 'settings' ? timeZone : (isValidTimeZone(fallbackTimeZone) ? fallbackTimeZone : 'UTC')
  const parts = localParts(parsed, zone)
  if (!parts) return undefined
  const generationTime = isDailyBriefingGenerationTime(settings.generationTime)
    ? settings.generationTime
    : dailyBriefingGenerationPolicy.defaultGenerationTime
  const windowHours = isDailyBriefingWindowHours(settings.windowHours)
    ? settings.windowHours
    : dailyBriefingGenerationPolicy.defaultWindowHours
  const cutoff = dailyBriefingCutoffMinutes(generationTime)
  // **日期只有一处来源：读者本地日历的今天**（用户 2026-11-06 拍板，`02` v2.132）。
  // 以前这里是"没过生成时刻就还算前一天那一期"，于是凌晨 01:25 的页面把 11/05 当今天、
  // 生成的新版也往昨天归档。没有"当前期"这回事了：没过点就是今天还没有，过了点由定时任务出今天这一期。
  const date = parts.date
  const scheduledEnd = zonedIso(date, Math.floor(cutoff / 60), cutoff % 60, zone)
  if (!scheduledEnd) return undefined
  // 窗口右端 = 今天配置的生成时刻；**还没到那一刻就用"现在"**——窗口绝不伸进未来
  // （一份覆盖着尚未发生的时段的日报，读者会以为它读过那些数据）。
  const endMs = Math.min(Date.parse(scheduledEnd), parsed)
  const windowEnd = new Date(endMs).toISOString()
  return Object.freeze({
    date,
    windowEnd,
    windowStart: new Date(endMs - windowHours * 60 * 60 * 1000).toISOString(),
    windowHours,
    zoneSource
  })
}

/**
 * 今天那一期的**计划截止时刻**，不管到没到点。
 *
 * `briefingWindow` 在没到点时会把右端夹到"现在"（窗口不伸进未来），所以它答不了"到点了没有"。
 * 补跑要问的正是这个：今天这一期的计划时刻已经过去了，而今天一次都没跑。
 */
export function briefingScheduledCutoff(date: string, generationTime: string, timeZone: string): string | undefined {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC'
  const cutoff = dailyBriefingCutoffMinutes(
    isDailyBriefingGenerationTime(generationTime) ? generationTime : dailyBriefingGenerationPolicy.defaultGenerationTime
  )
  return zonedIso(date, Math.floor(cutoff / 60), cutoff % 60, zone)
}

/**
 * The window for a cutoff the reader picked by hand.
 *
 * `briefingWindow` answers "which scheduled edition does this instant belong to": it keeps the
 * schedule's own wall-clock (07:00), so passing 08:00 still returns a 07:00 cutoff. That is why a
 * manual run for 08:00 produced the 07:00 edition. When a cutoff is chosen explicitly, the chosen
 * instant **is** the cutoff — the schedule only supplies the window length and the zone.
 *
 * The edition date is the local date of that instant, so a 08:00 run on the 5th files under the 5th.
 */
export function briefingWindowAtCutoff(
  cutoff: string,
  timeZone: string,
  settings: DailyBriefingWindowSettings = {},
  fallbackTimeZone: string = systemTimeZone()
): DailyBriefingWindow | undefined {
  const parsed = Date.parse(cutoff)
  if (!Number.isFinite(parsed)) return undefined
  const zoneSource: DailyBriefingZoneSource = isValidTimeZone(timeZone) ? 'settings' : 'system'
  const zone = zoneSource === 'settings' ? timeZone : (isValidTimeZone(fallbackTimeZone) ? fallbackTimeZone : 'UTC')
  const date = localDate(cutoff, zone)
  if (date === undefined) return undefined
  const windowHours = isDailyBriefingWindowHours(settings.windowHours)
    ? settings.windowHours
    : dailyBriefingGenerationPolicy.defaultWindowHours
  const windowEnd = new Date(parsed).toISOString()
  return Object.freeze({
    date,
    windowEnd,
    windowStart: new Date(parsed - windowHours * 60 * 60 * 1000).toISOString(),
    windowHours,
    zoneSource
  })
}

function localParts(value: number, timeZone: string): { date: string; hour: number; minute: number } | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(value))
    const get = (type: string) => parts.find((part) => part.type === type)?.value
    const year = get('year'); const month = get('month'); const day = get('day')
    const hour = Number(get('hour')); const minute = Number(get('minute'))
    return year && month && day && Number.isInteger(hour) && Number.isInteger(minute)
      ? { date: `${year}-${month}-${day}`, hour, minute }
      : undefined
  } catch { return undefined }
}

function zonedIso(date: string, hour: number, minute: number, timeZone: string): string | undefined {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return undefined
  const target = Date.UTC(year, month - 1, day, hour, minute)
  let guess = target
  try {
    for (let index = 0; index < 3; index++) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
      }).formatToParts(new Date(guess))
      const get = (type: string) => Number(parts.find((part) => part.type === type)?.value)
      const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
      guess += target - asUtc
    }
    return new Date(guess).toISOString()
  } catch { return undefined }
}

export function localDate(asOf: string, timeZone: string): string | undefined {
  const parsed = Date.parse(asOf)
  if (!Number.isFinite(parsed)) return undefined
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: isValidTimeZone(timeZone) ? timeZone : 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(parsed))
    const year = parts.find((part) => part.type === 'year')?.value
    const month = parts.find((part) => part.type === 'month')?.value
    const day = parts.find((part) => part.type === 'day')?.value
    return year && month && day ? `${year}-${month}-${day}` : undefined
  } catch {
    return undefined
  }
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}
