// Product-owned public boundary for the daily FRED rate readings the dashboard's 市场状态 block reads.
//
// The source is official and daily: one observation per trading day, published for days the market
// was open. That granularity is part of the contract rather than a footnote — a reading carries its
// observation date, and the `official-daily-close` caveat travels with every answer so no reader can
// mistake it for an intraday figure.
const macroRatesSeries = Object.freeze({
  us10y: 'DGS10', realRate: 'DFII10', us2y: 'DGS2', breakevenInflation: 'T10YIE'
} as const)

/** The metric keys the collector writes for those series; the pairing is enforced, not assumed. */
const macroRatesMetricKeys = Object.freeze({
  DGS10: 'US_10Y_YIELD', DFII10: 'US_REAL_YIELD_10Y', DGS2: 'US_2Y_YIELD', T10YIE: 'US_10Y_BREAKEVEN_INFLATION'
} as const)

const macroRatesCaveats = Object.freeze({ officialDailyClose: 'official-daily-close' } as const)

export const macroRatesSnapshotPublicPolicy = Object.freeze({
  method: 'intelligence.macro.ratesSnapshot.query',
  sourceId: 'fred-rates-liquidity',
  series: macroRatesSeries,
  /** The four admitted series, in the order the block reads them. */
  seriesIds: Object.freeze(Object.values(macroRatesSeries)) as readonly string[],
  metricKeys: macroRatesMetricKeys,
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
  maximumReadings: 4,
  maximumCaveats: 2,
  /** Yields are percentages; anything outside this is a parse accident, not a rate. */
  maximumLevelAbs: 100,
  maximumSnapshotBytes: 4 * 1024
} as const)

export type MacroRatesCaveat = typeof macroRatesCaveats[keyof typeof macroRatesCaveats]

/**
 * One reading: the level FRED published for one trading day, and the prior trading day's level when
 * the store kept one. `previous` is absent rather than zero when the series has no older observation,
 * so the change is reported as unknown instead of as a flat market.
 */
export type MacroRatesReading = Readonly<{
  seriesId: string
  metricKey: string
  actual: number
  previous?: number
  /** The observation date, `YYYY-MM-DD`: 截至 this day, not necessarily today. */
  period: string
}>

export type MacroRatesSnapshotView =
  | Readonly<{ state: 'available' | 'empty'; asOf: string; readings: readonly MacroRatesReading[]; caveats: readonly MacroRatesCaveat[] }>
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
    if (!exactFields(value, ['state', 'asOf', 'readings', 'caveats'])) return undefined
    if (!instant(value.asOf)) return undefined
    if (!safeArray(value.readings, isReading) || value.readings.length > macroRatesSnapshotPublicPolicy.maximumReadings) return undefined
    if (!safeArray(value.caveats, isCaveat) || value.caveats.length > macroRatesSnapshotPublicPolicy.maximumCaveats) return undefined
    // `available` means a level was actually read; a claim of availability without one is rejected
    // structurally, so the row can never print 可用 over an empty store.
    if ((value.state === 'empty') !== (value.readings.length === 0)) return undefined
    const readings = value.readings.map(reading => Object.freeze({
      seriesId: reading.seriesId, metricKey: reading.metricKey, actual: reading.actual, period: reading.period,
      ...(reading.previous === undefined ? {} : { previous: reading.previous })
    }))
    const view = Object.freeze({
      state: value.state, asOf: value.asOf, readings: Object.freeze(readings), caveats: Object.freeze([...value.caveats])
    })
    return new TextEncoder().encode(JSON.stringify(view)).byteLength <= macroRatesSnapshotPublicPolicy.maximumSnapshotBytes ? view : undefined
  } catch { return undefined }
}

function isReading(value: unknown): value is MacroRatesReading {
  const policy = macroRatesSnapshotPublicPolicy
  if (!exactFields(value, ['seriesId', 'metricKey', 'actual', 'period'], ['previous'])) return false
  // The series and its metric key are one fact, so a swapped pairing is a contract violation.
  if (policy.metricKeys[value.seriesId as keyof typeof policy.metricKeys] !== value.metricKey) return false
  if (!level(value.actual)) return false
  if (Object.hasOwn(value, 'previous') && !level(value.previous)) return false
  return typeof value.period === 'string' && policy.observationDatePattern.test(value.period) && Number.isFinite(Date.parse(value.period))
}

function level(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= macroRatesSnapshotPublicPolicy.maximumLevelAbs
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
