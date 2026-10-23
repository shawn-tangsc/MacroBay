import type { MacroMetricKind } from '../../application/macroSourceCatalogMetadata'

/** Approximate 8:30 AM US Eastern in UTC (standard-time anchor; DST not modeled). */
export const BLS_RELEASE_HOUR_UTC = 12
export const BLS_RELEASE_MINUTE_UTC = 30

export const BLS_RELEASE_CALENDAR_CAVEAT = 'derived-release-calendar'

/**
 * Resolve BLS official release time from observation period + metric kind.
 * Observation period M06 refers to June data; release occurs in July per BLS cadence.
 */
export function resolveBlsReleaseTime(input: { periodKey: string; metricKind: MacroMetricKind }): string {
  const parsed = parseMonthlyPeriodKey(input.periodKey)
  if (!parsed) return `${input.periodKey}T${pad(BLS_RELEASE_HOUR_UTC)}:${pad(BLS_RELEASE_MINUTE_UTC)}:00.000Z`

  const releaseYear = parsed.month === 12 ? parsed.year + 1 : parsed.year
  const releaseMonth = parsed.month === 12 ? 1 : parsed.month + 1

  if (input.metricKind === 'employment') {
    const releaseDay = firstFridayUtcDay(releaseYear, releaseMonth)
    return formatReleaseInstant(releaseYear, releaseMonth, releaseDay)
  }

  // CPI and other monthly inflation releases: mid-month anchor in the following month.
  const releaseDay = 13
  return formatReleaseInstant(releaseYear, releaseMonth, releaseDay)
}

function parseMonthlyPeriodKey(periodKey: string): { year: number; month: number } | undefined {
  const match = /^(\d{4})-M(\d{2})$/.exec(periodKey)
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return undefined
  return { year, month }
}

function firstFridayUtcDay(year: number, month: number): number {
  for (let day = 1; day <= 7; day += 1) {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    if (weekday === 5) return day
  }
  return 1
}

function formatReleaseInstant(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}T${pad(BLS_RELEASE_HOUR_UTC)}:${pad(BLS_RELEASE_MINUTE_UTC)}:00.000Z`
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
