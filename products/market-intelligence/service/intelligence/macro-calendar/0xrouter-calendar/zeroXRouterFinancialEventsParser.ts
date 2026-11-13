import { calendarEventDraft, parseCalendarEnvelope, type ZeroXRouterCalendarLocale, type ZeroXRouterCalendarParseResult } from './marketCalendarStorageContracts'

export function parseZeroXRouterFinancialEvents(input: unknown, locale: ZeroXRouterCalendarLocale): ZeroXRouterCalendarParseResult {
  return parseCalendarEnvelope(input, locale, (row) =>
    calendarEventDraft(row, locale, 'macro-calendar-0xrouter-financial-events', 'financial-event'))
}
