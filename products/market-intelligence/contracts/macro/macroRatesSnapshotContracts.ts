// Product-owned public boundary for the daily FRED rate readings the dashboard's 市场状态 block reads.
//
// The source is official and daily: one observation per trading day, published for days the market
// was open. That granularity is part of the contract rather than a footnote — a reading carries its
// observation date, and the `official-daily-close` caveat travels with every answer so no reader can
// mistake it for an intraday figure.
//
// Two things travel beside the level, and neither is decoration:
//
// - **A window**, the trading days the row was drawn from. One close is a number; a year of closes is
//   a trend, and the block exists to answer "which way". The window is the store's own observations —
//   a day with no observation is absent from it, never a zero and never interpolated.
// - **Two spreads** (10Y−2Y and 10Y−3M), each its own series of differences. A spread is only stated
//   on a day both legs actually have a close for; a missing leg is `absent`, not a difference against
//   nothing. They are prepared here so the panel can draw them; whether and where it does is the
//   prototype's decision.
const macroRatesSeries = Object.freeze({
  us3m: 'DGS3MO',
  us2y: 'DGS2',
  us5y: 'DGS5',
  us10y: 'DGS10',
  us30y: 'DGS30',
  realRate: 'DFII10',
  breakevenInflation: 'T10YIE'
} as const)

/** The metric keys the collector writes for those series; the pairing is enforced, not assumed. */
const macroRatesMetricKeys = Object.freeze({
  DGS3MO: 'US_3M_YIELD',
  DGS2: 'US_2Y_YIELD',
  DGS5: 'US_5Y_YIELD',
  DGS10: 'US_10Y_YIELD',
  DGS30: 'US_30Y_YIELD',
  DFII10: 'US_REAL_YIELD_10Y',
  T10YIE: 'US_10Y_BREAKEVEN_INFLATION'
} as const)

/** The admitted differences, named once so the parser can reject anything else by construction. */
const macroRatesSpreads = Object.freeze([
  Object.freeze({ key: 'us10y-minus-us2y', long: 'DGS10', short: 'DGS2' }),
  Object.freeze({ key: 'us10y-minus-us3m', long: 'DGS10', short: 'DGS3MO' })
] as const)

const macroRatesCaveats = Object.freeze({ officialDailyClose: 'official-daily-close' } as const)

export const macroRatesSnapshotPublicPolicy = Object.freeze({
  method: 'intelligence.macro.ratesSnapshot.query',
  sourceId: 'fred-rates-liquidity',
  series: macroRatesSeries,
  /**
   * The admitted series, in the order the block reads them: the curve first (3M → 30Y), then the two
   * series that are not tenors — the 10-year real yield and the 10-year breakeven.
   */
  seriesIds: Object.freeze(Object.values(macroRatesSeries)) as readonly string[],
  metricKeys: macroRatesMetricKeys,
  spreads: macroRatesSpreads,
  spreadKeys: Object.freeze(macroRatesSpreads.map((spread) => spread.key)) as readonly string[],
  caveats: macroRatesCaveats,
  caveatIds: Object.freeze(Object.values(macroRatesCaveats)) as readonly string[],
  /**
   * 官方发布节律。真正的 owner 是服务侧来源目录（`FRED_MACRO_ADAPTER_CONFIG.releaseCadence`），契约这里
   * 是给渲染侧读的镜像；服务侧有一条测试断言两者一致，所以镜像不会悄悄漂移。
   */
  releaseCadence: 'daily',
  /** FRED's own date shape: a trading day, never an instant. */
  observationDatePattern: /^\d{4}-\d{2}-\d{2}$/,
  canonicalUtcPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  /** 五个期限 + 实际利率 + 盈亏平衡。 */
  maximumReadings: 7,
  maximumSpreads: 2,
  /**
   * 每行带多少交易日：一年（约 252 个交易日）留出余量。面板要更长的窗口时只改这一处，
   * 不要在各调用点各写一个数——窗口长度是可感知的产品决定，不是渲染细节。
   */
  windowPoints: 260,
  maximumCaveats: 2,
  /** Yields are percentages; anything outside this is a parse accident, not a rate. */
  maximumLevelAbs: 100,
  /** 七个序列各带一年窗口，加上两条价差：留足余量，但仍是硬上限而非「随便多大」。 */
  maximumSnapshotBytes: 256 * 1024
} as const)

export type MacroRatesCaveat = typeof macroRatesCaveats[keyof typeof macroRatesCaveats]
export type MacroRatesSpreadKey = typeof macroRatesSpreads[number]['key']

/** One trading day's close. `period` is the day it belongs to, not the instant it was fetched. */
export type MacroRatesWindowPoint = Readonly<{ period: string; value: number }>

/**
 * One reading: the level FRED published for one trading day, the prior trading day's level when the
 * window kept one, and the window itself.
 *
 * `previous` is absent rather than zero when the window holds no older observation, so the change is
 * reported as unknown instead of as a flat market. `window` is never empty: the level is the last
 * point of its own window, and the parser enforces that (a line that ends somewhere other than the
 * number printed beside it is a bug the reader would have to notice).
 */
export type MacroRatesReading = Readonly<{
  seriesId: string
  metricKey: string
  actual: number
  previous?: number
  /** The observation date, `YYYY-MM-DD`: 截至 this day, not necessarily today. */
  period: string
  /** The newest trading days, oldest first. A day with no observation is absent — a gap, not a zero. */
  window: readonly MacroRatesWindowPoint[]
}>

/** One admitted difference, day by day: only the days both legs have a close for. */
export type MacroRatesSpread = Readonly<{
  key: MacroRatesSpreadKey
  actual: number
  previous?: number
  period: string
  window: readonly MacroRatesWindowPoint[]
}>

export type MacroRatesSnapshotView =
  | Readonly<{
      state: 'available' | 'empty'
      asOf: string
      readings: readonly MacroRatesReading[]
      spreads: readonly MacroRatesSpread[]
      caveats: readonly MacroRatesCaveat[]
    }>
  | Readonly<{ state: 'unavailable' }>

/** The one admitted request shape: no arguments at all — the snapshot is product-wide. */
export function isMacroRatesSnapshotQuery(value: unknown): value is Record<string, never> {
  try {
    if (!plainRecord(value)) return false
    return Reflect.ownKeys(value).length === 0
  } catch { return false }
}

/**
 * Sanitises the snapshot at both ends of the wire: the main process runs it before the payload leaves,
 * the renderer runs it again on arrival. Anything outside the admitted shape becomes `unavailable`, so
 * a malformed answer reads as "no data" and never as a figure.
 */
export function parseMacroRatesSnapshot(value: unknown): MacroRatesSnapshotView | undefined {
  try {
    if (!plainRecord(value)) return undefined
    if (value.state === 'unavailable') return exactFields(value, ['state']) ? Object.freeze({ state: 'unavailable' as const }) : undefined
    if (value.state !== 'available' && value.state !== 'empty') return undefined
    if (!exactFields(value, ['state', 'asOf', 'readings', 'spreads', 'caveats'])) return undefined
    if (!instant(value.asOf)) return undefined
    if (!safeArray(value.readings, isReading) || value.readings.length > macroRatesSnapshotPublicPolicy.maximumReadings) return undefined
    if (!safeArray(value.spreads, isSpread) || value.spreads.length > macroRatesSnapshotPublicPolicy.maximumSpreads) return undefined
    if (!safeArray(value.caveats, isCaveat) || value.caveats.length > macroRatesSnapshotPublicPolicy.maximumCaveats) return undefined
    // `available` means a level was actually read; a claim of availability without one is rejected
    // structurally, so the row can never print 可用 over an empty store. A spread without a reading is
    // the same contradiction: the difference is computed from the readings, not collected on its own.
    if ((value.state === 'empty') !== (value.readings.length === 0)) return undefined
    if (value.readings.length === 0 && value.spreads.length > 0) return undefined
    const readings = value.readings.map(reading => Object.freeze({
      seriesId: reading.seriesId, metricKey: reading.metricKey, actual: reading.actual, period: reading.period,
      window: freezeWindow(reading.window),
      ...(reading.previous === undefined ? {} : { previous: reading.previous })
    }))
    const spreads = value.spreads.map(spread => Object.freeze({
      key: spread.key, actual: spread.actual, period: spread.period, window: freezeWindow(spread.window),
      ...(spread.previous === undefined ? {} : { previous: spread.previous })
    }))
    const view = Object.freeze({
      state: value.state, asOf: value.asOf, readings: Object.freeze(readings), spreads: Object.freeze(spreads),
      caveats: Object.freeze([...value.caveats])
    })
    return new TextEncoder().encode(JSON.stringify(view)).byteLength <= macroRatesSnapshotPublicPolicy.maximumSnapshotBytes ? view : undefined
  } catch { return undefined }
}

function freezeWindow(window: readonly MacroRatesWindowPoint[]): readonly MacroRatesWindowPoint[] {
  return Object.freeze(window.map(point => Object.freeze({ period: point.period, value: point.value })))
}

function isReading(value: unknown): value is MacroRatesReading {
  const policy = macroRatesSnapshotPublicPolicy
  if (!exactFields(value, ['seriesId', 'metricKey', 'actual', 'period', 'window'], ['previous'])) return false
  // The series and its metric key are one fact, so a swapped pairing is a contract violation.
  if (policy.metricKeys[value.seriesId as keyof typeof policy.metricKeys] !== value.metricKey) return false
  if (!level(value.actual)) return false
  if (Object.hasOwn(value, 'previous') && !level(value.previous)) return false
  if (!observationDate(value.period)) return false
  if (!isWindow(value.window)) return false
  // The level is the newest point of its own window, on the day the reading claims.
  return windowHeadAgreesWith(value.window, value.period, value.actual)
}

function isSpread(value: unknown): value is MacroRatesSpread {
  if (!exactFields(value, ['key', 'actual', 'period', 'window'], ['previous'])) return false
  if (!(macroRatesSnapshotPublicPolicy.spreadKeys as readonly string[]).includes(value.key as string)) return false
  if (!level(value.actual)) return false
  if (Object.hasOwn(value, 'previous') && !level(value.previous)) return false
  if (!observationDate(value.period)) return false
  if (!isWindow(value.window)) return false
  return windowHeadAgreesWith(value.window, value.period, value.actual)
}

/**
 * A window is the trading days of one series: strictly increasing dates, bounded, and never a zero
 * standing in for a day the market was closed.
 */
function isWindow(value: unknown): value is readonly MacroRatesWindowPoint[] {
  if (!safeArray(value, isWindowPoint)) return false
  if (value.length === 0 || value.length > macroRatesSnapshotPublicPolicy.windowPoints) return false
  for (let index = 1; index < value.length; index += 1) {
    if (!(value[index]!.period > value[index - 1]!.period)) return false
  }
  return true
}

function isWindowPoint(value: unknown): value is MacroRatesWindowPoint {
  if (!exactFields(value, ['period', 'value'])) return false
  return observationDate(value.period) && level(value.value)
}

function windowHeadAgreesWith(window: readonly MacroRatesWindowPoint[], period: unknown, actual: unknown): boolean {
  const head = window[window.length - 1]
  return head !== undefined && head.period === period && head.value === actual
}

function level(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= macroRatesSnapshotPublicPolicy.maximumLevelAbs
}

function observationDate(value: unknown): value is string {
  return typeof value === 'string' && macroRatesSnapshotPublicPolicy.observationDatePattern.test(value) &&
    Number.isFinite(Date.parse(value))
}

function isCaveat(value: unknown): value is MacroRatesCaveat {
  return typeof value === 'string' && (macroRatesSnapshotPublicPolicy.caveatIds as readonly string[]).includes(value)
}

function instant(value: unknown): value is string {
  return typeof value === 'string' && macroRatesSnapshotPublicPolicy.canonicalUtcPattern.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false
  return Object.getOwnPropertySymbols(value).length === 0 &&
    Object.getOwnPropertyNames(value).every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return Boolean(descriptor && 'value' in descriptor)
    })
}

/** Own data fields only: no accessors, no symbols, no extra caller fields. */
function exactFields(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (!plainRecord(value)) return false
  const keys = Reflect.ownKeys(value)
  return required.every(key => keys.includes(key)) && keys.every(key => typeof key === 'string' && (required.includes(key) || optional.includes(key)))
}

function safeArray<T>(value: unknown, item: (value: unknown) => value is T): value is readonly T[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false
    const keys = Reflect.ownKeys(value)
    if (!keys.includes('length') || keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^\d+$/.test(key)))) return false
    const length = value.length
    if (keys.length !== length + 1) return false
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      // Writable/configurable are deliberately not required: this parser runs again on frozen views.
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable || !item(descriptor.value)) return false
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    return Boolean(lengthDescriptor && 'value' in lengthDescriptor && lengthDescriptor.value === length)
  } catch { return false }
}
