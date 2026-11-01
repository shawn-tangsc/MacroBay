import type { MacroCalendarScheduleDraft, VerifiedScheduleParserInput } from './verifiedScheduleParserContracts'
import { hasVerifiedScheduleFixture, isScheduleDraft, text } from './verifiedScheduleParserSupport'

export const fedFomcScheduleParserVersion = 'fed-fomc-schedule-v3'

const months: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12
}

export function parseFedFomcSchedule(input: VerifiedScheduleParserInput): MacroCalendarScheduleDraft[] {
  if (!hasVerifiedScheduleFixture(input, 'macro-calendar-fed-schedule')) return []
  const years = [...input.body.matchAll(/<h4><a[^>]*>\s*(\d{4}) FOMC Meetings\s*<\/a><\/h4>([\s\S]*?)(?=<div class="panel panel-default"|$)/g)]
  return years.flatMap(([, year, panel]) => [...panel.matchAll(/<div class="(?:[^"\n]* )?fomc-meeting[^"\n]*"[^>]*>[\s\S]*?<div class="[^"\n]*fomc-meeting__month[^"\n]*">([\s\S]*?)<\/div>[\s\S]*?<div class="[^"\n]*fomc-meeting__date[^"\n]*">([\s\S]*?)<\/div>/g)]
    .flatMap(([, monthHtml, dayHtml]) => draft(year!, text(monthHtml!), text(dayHtml!), input) ?? []))
    .filter(isScheduleDraft)
}

function draft(year: string, monthName: string, dayText: string, input: VerifiedScheduleParserInput): MacroCalendarScheduleDraft | undefined {
  const month = months[monthName]
  const days = [...dayText.matchAll(/\d{1,2}/g)].map((match) => Number(match[0]))
  const finalDay = days.at(-1)
  if (!month || !finalDay) return undefined
  const date = `${year}-${String(month).padStart(2, '0')}-${String(finalDay).padStart(2, '0')}`
  // `8-9*` marks a meeting with projection materials; the star is part of the date block's text.
  const hasProjectionMaterials = dayText.includes('*')
  if (new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) return undefined
  return {
    eventKey: `US.FOMC.${date}`, releaseGroupKey: `US.FOMC.${date}`, eventFamily: 'fomc', eventNameKey: 'fomc', periodKey: date,
    lifecycleState: 'scheduled', revisionKind: 'schedule', scheduledDate: date, hasProjectionMaterials,
    providerId: input.descriptor.providerId, descriptorId: input.descriptor.descriptorId, sourceUrl: input.descriptor.sourceUrl,
    parserVersion: fedFomcScheduleParserVersion, caveats: ['official-time-not-published']
  }
}
