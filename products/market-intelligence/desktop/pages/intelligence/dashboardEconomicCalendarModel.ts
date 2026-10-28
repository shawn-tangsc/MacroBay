/**
 * The dashboard's economic-calendar source row.
 *
 * The board used to project released and upcoming release groups from this month's query. That
 * surface is gone (the right column's calendar card owns the release rows), so the only thing the
 * dashboard still needs from the query is whether this month could be read at all. Keeping the
 * grouping here would have been a second interpretation of the same events that nobody renders.
 */
export const dashboardEconomicCalendarPolicy = Object.freeze({
  monthPattern: /^\d{4}-(?:0[1-9]|1[0-2])$/,
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
})

export const dashboardEconomicCalendarSourcePolicy = {
  sourceId: 'economic-calendar',
  sourceStates: ['loading', 'available', 'empty', 'unavailable'],
  actions: ['open-calendar', 'manage-macro-calendar-settings']
} as const

export type DashboardEconomicCalendarMonthState = 'available' | 'empty' | 'unavailable'

export type DashboardEconomicCalendarState =
  | { state: 'loading' }
  | { state: DashboardEconomicCalendarMonthState }

/**
 * Whether the month query was readable.
 *
 * Only the envelope is judged: the dashboard no longer keeps or renders any event field, so a
 * per-event shape check here would guard values that never leave this function. `empty` is a
 * readable month with no events, which the source row states separately from `unavailable`.
 */
export function selectDashboardEconomicCalendarMonth(
  input: unknown,
  query: Readonly<{ month: string; asOf: string }>
): DashboardEconomicCalendarMonthState {
  const { month, asOf } = query
  if (!dashboardEconomicCalendarPolicy.monthPattern.test(month)) return 'unavailable'
  if (!isCanonicalUtcMillis(asOf)) return 'unavailable'
  if (!isPlainDataRecord(input)) return 'unavailable'
  if (input.state === 'unavailable') return 'unavailable'
  if (input.state !== 'available' || input.asOf !== asOf || !Array.isArray(input.events)) return 'unavailable'
  return input.events.length > 0 ? 'available' : 'empty'
}

function isCanonicalUtcMillis(value: string): boolean {
  if (!dashboardEconomicCalendarPolicy.canonicalUtcMillisPattern.test(value)) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isPlainDataRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return (prototype === Object.prototype || prototype === null) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) => 'value' in descriptor)
}
