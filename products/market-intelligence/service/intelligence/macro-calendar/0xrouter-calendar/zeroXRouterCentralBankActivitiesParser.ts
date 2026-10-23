import { calendarEventDraft, parseCalendarEnvelope, type ZeroXRouterCalendarLocale, type ZeroXRouterCalendarParseResult } from './zeroXRouterCalendarContracts'

export function parseZeroXRouterCentralBankActivities(input: unknown, locale: ZeroXRouterCalendarLocale): ZeroXRouterCalendarParseResult {
  return parseCalendarEnvelope(input, locale, (row) =>
    calendarEventDraft(row, locale, 'macro-calendar-0xrouter-central-bank-activities', 'central-bank-activity'))
}
