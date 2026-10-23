import type { MacroCalendarScheduleDraft, VerifiedScheduleParserInput } from './verifiedScheduleParserContracts'
import { hasVerifiedScheduleFixture, text } from './verifiedScheduleParserSupport'
import { toUtcIsoFromOfficialEasternTime } from '../macroCalendarTimeZone'

export const beaReleaseScheduleParserVersion = 'bea-release-schedule-v2'

const monthNumbers: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12
}

export const beaGdpEstimateIdentityPolicy = {
  variants: {
    Advance: 'ADVANCE',
    Second: 'SECOND',
    Third: 'THIRD'
  }
} as const

export const beaReleaseScheduleTimePolicy = {
  timeMarkupPattern: /<small\b[^>]*class="[^"]*text-muted[^"]*"[^>]*>([\s\S]*?)<\/small>/g,
  localTimePattern: /^(\d{1,2}):(\d{2})\s+(AM|PM)$/
} as const

export function parseBeaReleaseSchedule(input: VerifiedScheduleParserInput): MacroCalendarScheduleDraft[] {
  if (!hasVerifiedScheduleFixture(input, 'macro-calendar-bea-schedule')) return []
  const table = /<table[^>]+id="release-schedule-table"[\s\S]*?<\/table>/.exec(input.body)?.[0]
  const year = /<th[^>]*>\s*Year\s+(\d{4})\s*<\/th>/.exec(table ?? '')?.[1]
  if (!table || !year) return []
  return [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].flatMap(([, row]) => drafts(year, row!, input)).filter(isBeaScheduleDraft)
}

function drafts(year: string, row: string, input: VerifiedScheduleParserInput): MacroCalendarScheduleDraft[] {
  const dateCell = /<td[^>]*class="[^"]*scheduled-date[^"]*"[^>]*>([\s\S]*?)<\/td>/.exec(row)?.[1] ?? ''
  const dateText = text(dateCell)
  const title = text(/<td[^>]*class="[^"]*release-title[^"]*"[^>]*>([\s\S]*?)<\/td>/.exec(row)?.[1] ?? '')
  const scheduledDate = date(year, dateText)
  if (!scheduledDate || !title || /To Be Announced/i.test(dateText)) return []
  const scheduledAt = parseScheduledAt(scheduledDate, dateCell)
  if (scheduledAt === false) return []
  const pce = /^Personal Income and Outlays, ([A-Za-z]+) (\d{4})$/.exec(title)
  if (pce) return (['PCE', 'CORE_PCE'] as const).map((prefix) => schedule(prefix, `${pce[2]}-${String(monthNumbers[pce[1]!]).padStart(2, '0')}`, scheduledDate, input, undefined, scheduledAt || undefined))
  const gdp = parseGdpTitle(title)
  return gdp ? [schedule('GDP', `${gdp.year}-Q${gdp.quarter}`, scheduledDate, input, gdp.variant, scheduledAt || undefined)] : []
}

function date(year: string, value: string): string | undefined {
  const match = /^([A-Za-z]+) (\d{1,2})\b/.exec(value)
  const month = monthNumbers[match?.[1] ?? '']
  const day = Number(match?.[2])
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return month && new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) === date ? date : undefined
}

function schedule(prefix: 'PCE' | 'CORE_PCE' | 'GDP', periodKey: string, scheduledDate: string, input: VerifiedScheduleParserInput, estimateVariant?: string, scheduledAt?: string): MacroCalendarScheduleDraft {
  const eventFamily = prefix === 'PCE' ? 'pce' : prefix === 'CORE_PCE' ? 'core-pce' : 'gdp'
  const identityKey = `${periodKey}${estimateVariant ? `.${estimateVariant}` : ''}`
  return {
    eventKey: `US.${prefix}.${identityKey}`, releaseGroupKey: `US.BEA.${prefix === 'GDP' ? 'GDP' : 'PCE'}.${identityKey}`,
    eventFamily, eventNameKey: eventFamily, periodKey, lifecycleState: 'scheduled', revisionKind: 'schedule', scheduledDate,
    providerId: input.descriptor.providerId, descriptorId: input.descriptor.descriptorId, sourceUrl: input.descriptor.sourceUrl,
    parserVersion: beaReleaseScheduleParserVersion, ...(scheduledAt ? { scheduledAt } : {}), caveats: scheduledAt ? [] : ['official-timezone-not-published']
  }
}

function parseScheduledAt(scheduledDate: string, dateCell: string): string | false | undefined {
  const times = [...dateCell.matchAll(beaReleaseScheduleTimePolicy.timeMarkupPattern)].map((match) => text(match[1] ?? ''))
  if (times.length === 0) return undefined
  if (times.length !== 1) return false
  const match = beaReleaseScheduleTimePolicy.localTimePattern.exec(times[0]!)
  if (!match) return false
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 1 || hour > 12 || minute > 59) return false
  const localHour = (hour % 12) + (match[3] === 'PM' ? 12 : 0)
  return toUtcIsoFromOfficialEasternTime(scheduledDate, `${String(localHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`) ?? false
}

function parseGdpTitle(title: string): { variant: string; quarter: string; year: string } | undefined {
  const patterns: Array<{ variant: keyof typeof beaGdpEstimateIdentityPolicy.variants; pattern: RegExp }> = [
    { variant: 'Advance', pattern: /^GDP \(Advance Estimate\), (\d)(?:st|nd|rd|th) Quarter (\d{4})(?: and Year \d{4})?$/ },
    { variant: 'Second', pattern: /^GDP \(Second Estimate\)(?: and Corporate Profits)?, (\d)(?:st|nd|rd|th) Quarter (\d{4})$/ },
    { variant: 'Third', pattern: /^GDP \(Third Estimate\)(?:, Industries, Corporate Profits, State GDP, and State Personal Income)?, (\d)(?:st|nd|rd|th) Quarter (\d{4})(?:; State PCE, \d{4})?$/ }
  ]
  for (const candidate of patterns) {
    const match = candidate.pattern.exec(title)
    if (match) return { variant: beaGdpEstimateIdentityPolicy.variants[candidate.variant], quarter: match[1]!, year: match[2]! }
  }
  return undefined
}

function isBeaScheduleDraft(draft: MacroCalendarScheduleDraft): boolean {
  return /^US\.(?:PCE|CORE_PCE)\.\d{4}-\d{2}$/.test(draft.eventKey) ||
    /^US\.GDP\.\d{4}-Q[1-4]\.(?:ADVANCE|SECOND|THIRD)$/.test(draft.eventKey)
}
