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
  sourceStates: ['loading', 'available', 'empty', 'unavailable']
} as const

/**
 * 三句话，不是四个词（产品 2026-11-10，决定记录 §15）：**拿不到 ≠ 没有 ≠ 旧**。
 *
 * - `available`：读到了，这个月有安排；
 * - `empty`：读到了，这个月确实没有——是**空**，不是「不可用」；
 * - `unavailable`：读不到。`cause` 只在内部区分两种来路，**读者永远只看到一句「日程读不到」**：
 *   「月份参数非法 / asOf 非规范」是我们自己的程序错误（要写日志），而载荷形状不符、查询自报不可用
 *   是这一格没读成。给读者造第四个词只会让他以为是自己弄坏了什么。
 */
export type DashboardEconomicCalendarMonthState =
  | Readonly<{ state: 'available' }>
  | Readonly<{ state: 'empty' }>
  | Readonly<{ state: 'unavailable'; cause: 'input-invalid' | 'query-unavailable' }>

export type DashboardEconomicCalendarState =
  | { state: 'loading' }
  | DashboardEconomicCalendarMonthState

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
  // 这两条是**我们自己的程序错误**：参数是我们拼的、时钟是我们读的。归进「读不到」并让调用方记日志。
  if (!dashboardEconomicCalendarPolicy.monthPattern.test(month)) return { state: 'unavailable', cause: 'input-invalid' }
  if (!isCanonicalUtcMillis(asOf)) return { state: 'unavailable', cause: 'input-invalid' }
  // 从这里往下都是「这一格没读成」：形状不符也是读不到，不是我们的输入错误。
  if (!isPlainDataRecord(input)) return { state: 'unavailable', cause: 'query-unavailable' }
  if (input.state === 'unavailable') return { state: 'unavailable', cause: 'query-unavailable' }
  if (input.state !== 'available' || input.asOf !== asOf || !Array.isArray(input.events)) return { state: 'unavailable', cause: 'query-unavailable' }
  return input.events.length > 0 ? { state: 'available' } : { state: 'empty' }
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
