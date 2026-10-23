import { getMacroCalendarOfficialSourceDescriptor, isFixedMacroCalendarDescriptor, type MacroCalendarOfficialSourceDescriptor } from '../macroCalendarOfficialSourceRegistry'

export type FedFomcStatementHistoryEntry = Readonly<{
  decisionDate: string
  officialStatementUrl: string
}>

export const fedFomcStatementHistoryPolicy = Object.freeze({
  descriptorId: 'macro-calendar-fed-statement-history',
  officialOrigin: 'https://www.federalreserve.gov',
  statementPath: /^\/newsevents\/pressreleases\/monetary\d{8}a\.htm$/,
  yearPanelPattern: /<h4><a[^>]*>\s*(\d{4}) FOMC Meetings\s*<\/a><\/h4>([\s\S]*?)(?=<div class="panel panel-default"|$)/g,
  meetingPattern: /<div class="[^"]*\bfomc-meeting\b[^"]*"[^>]*>([\s\S]*?)(?=<div class="[^"]*\bfomc-meeting\b[^"]*"|$)/g,
  months: { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 }
} as const)

export function parseFedFomcStatementHistory(input: { descriptor: MacroCalendarOfficialSourceDescriptor; body: string }): readonly FedFomcStatementHistoryEntry[] {
  try {
    if (!isInput(input)) return []
    const entries = [...input.body.matchAll(fedFomcStatementHistoryPolicy.yearPanelPattern)]
      .flatMap(([, year, panel]) => parsePanel(year!, panel!))
    const resolved = entries.filter((entry): entry is FedFomcStatementHistoryEntry => Boolean(entry))
    const dates = new Set<string>()
    const urls = new Set<string>()
    return resolved.some((entry) => dates.has(entry.decisionDate) || urls.has(entry.officialStatementUrl) || !dates.add(entry.decisionDate) || !urls.add(entry.officialStatementUrl))
      ? []
      : resolved.sort((left, right) => left.decisionDate.localeCompare(right.decisionDate))
  } catch {
    return []
  }
}

function isInput(value: unknown): value is { descriptor: MacroCalendarOfficialSourceDescriptor; body: string } {
  const descriptor = getMacroCalendarOfficialSourceDescriptor(fedFomcStatementHistoryPolicy.descriptorId)
  return Boolean(isExactRecord(value, ['descriptor', 'body']) &&
    Object.getOwnPropertyNames(value).length === 2 && Object.hasOwn(value, 'descriptor') && Object.hasOwn(value, 'body') &&
    descriptor && value.descriptor === descriptor && isFixedMacroCalendarDescriptor(descriptor) && typeof value.body === 'string' && value.body.trim().length > 0)
}

function isExactRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype &&
    fields.every((field) => Object.hasOwn(value, field)) && Object.getOwnPropertySymbols(value).length === 0)
}

function parsePanel(year: string, html: string): Array<FedFomcStatementHistoryEntry | undefined> {
  const starts = [...html.matchAll(/<div class="(?:fomc-meeting--shaded )?row fomc-meeting"[^>]*>/g)]
  return starts.map((match, index) => parseMeeting(year, html.slice(match.index! + match[0].length, starts[index + 1]?.index)))
}

function parseMeeting(year: string, html: string): FedFomcStatementHistoryEntry | undefined {
  const month = oneText(html, /fomc-meeting__month[^>]*>\s*<strong>([A-Z][a-z]+)<\/strong>/g)
  const days = oneText(html, /fomc-meeting__date[^>]*>([\s\S]*?)<\/div>/g)?.match(/\d{1,2}/g)?.map(Number)
  const statement = oneText(html, /<strong>Statement:<\/strong>\s*<br>\s*<a href="[^"]+">PDF<\/a> \| <a href="([^"]+)">HTML<\/a>/g)
  const monthNumber = month ? fedFomcStatementHistoryPolicy.months[month as keyof typeof fedFomcStatementHistoryPolicy.months] : undefined
  const day = days?.at(-1)
  const decisionDate = monthNumber && Number.isInteger(day) ? `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}` : undefined
  const officialStatementUrl = statement ? canonicalStatementUrl(statement) : undefined
  return decisionDate && isDate(decisionDate) && officialStatementUrl ? { decisionDate, officialStatementUrl } : undefined
}

function oneText(value: string, pattern: RegExp): string | undefined {
  const matches = [...value.matchAll(pattern)]
  return matches.length === 1 ? matches[0]![1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : undefined
}

function canonicalStatementUrl(value: string): string | undefined {
  try {
    const url = new URL(value, fedFomcStatementHistoryPolicy.officialOrigin)
    return url.origin === fedFomcStatementHistoryPolicy.officialOrigin && !url.search && !url.hash && fedFomcStatementHistoryPolicy.statementPath.test(url.pathname)
      ? url.toString()
      : undefined
  } catch {
    return undefined
  }
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
}
