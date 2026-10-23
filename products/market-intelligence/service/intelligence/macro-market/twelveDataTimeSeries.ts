import { macroMarketPolicy, type MacroMarketFailureCode } from './macroMarketPolicy'

export type ProviderBar = Readonly<{ symbol: string; atMs: number; open: string; high: string; low: string; close: string }>
export type TimeSeriesResult =
  | Readonly<{ state: 'available'; bars: readonly ProviderBar[] }>
  | Readonly<{ state: 'unavailable'; failureCode: MacroMarketFailureCode; detail?: string }>

const decimal = /^-?\d+(?:\.\d+)?$/
const utcMinute = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/

/** `2026-10-14 06:15:00` as UTC. The request pins `timezone=UTC`, so no local zone is inferred. */
export function parseProviderDatetime(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const match = utcMinute.exec(value.trim())
  if (!match) return undefined
  const [, year, month, day, hour, minute, second] = match
  const atMs = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  return Number.isFinite(atMs) ? atMs : undefined
}

/** One request for every symbol of the plan, in UTC, so bars land on five-minute boundaries. */
export function timeSeriesUrl(symbols: readonly string[], apiKey: string, outputsize: number = macroMarketPolicy.outputsize): string {
  const query = new URLSearchParams({
    symbol: symbols.join(','), interval: macroMarketPolicy.interval,
    outputsize: String(outputsize), timezone: macroMarketPolicy.timezone, apikey: apiKey
  })
  return `${macroMarketPolicy.baseUrl}/time_series?${query.toString()}`
}

export function timeSeriesFailureCode(status: number, code: unknown): MacroMarketFailureCode {
  if (status === 401 || code === 401) return 'credential-rejected'
  if (status === 403 || code === 403) return 'plan-restricted'
  if (status === 429 || code === 429) return 'rate-limited'
  return 'response-invalid'
}

/**
 * Twelve Data answers a multi-symbol request with one object per symbol and a single-symbol request
 * with `meta`/`values` at the top level; either shape is accepted here, and anything else is
 * `response-invalid` rather than a half-read page.
 */
export function parseTimeSeries(payload: unknown, httpStatus = 200): TimeSeriesResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { state: 'unavailable', failureCode: 'response-invalid' }
  const record = payload as Record<string, unknown>
  if (record.status === 'error' || typeof record.code === 'number') {
    const code = typeof record.code === 'number' ? record.code : undefined
    return { state: 'unavailable', failureCode: timeSeriesFailureCode(httpStatus, code), detail: typeof record.message === 'string' ? record.message.slice(0, 200) : undefined }
  }
  const entries = 'values' in record ? [[String((record.meta as { symbol?: unknown } | undefined)?.symbol ?? ''), record] as const] : Object.entries(record)
  const bars: ProviderBar[] = []
  for (const [symbol, entry] of entries) {
    if (!entry || typeof entry !== 'object' || !symbol) continue
    const values = (entry as { values?: unknown }).values
    if (!Array.isArray(values)) continue
    for (const value of values) {
      if (!value || typeof value !== 'object') return { state: 'unavailable', failureCode: 'response-invalid' }
      const row = value as Record<string, unknown>
      const atMs = parseProviderDatetime(row.datetime)
      const fields = ['open', 'high', 'low', 'close'] as const
      if (atMs === undefined || atMs % macroMarketPolicy.intervalMs !== 0 ||
        !fields.every(field => typeof row[field] === 'string' && decimal.test(row[field] as string))) {
        return { state: 'unavailable', failureCode: 'response-invalid' }
      }
      bars.push({ symbol, atMs, open: row.open as string, high: row.high as string, low: row.low as string, close: row.close as string })
    }
  }
  return bars.length > 0 ? { state: 'available', bars } : { state: 'unavailable', failureCode: 'response-invalid' }
}
