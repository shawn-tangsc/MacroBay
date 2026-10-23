// Product-owned public boundary for the macro-market snapshot the dashboard's 市场状态 block reads.
// Levels and returns come from the product's own store through `createMacroMarketSnapshotQuery`;
// this file only decides what may cross to the renderer. A window the series cannot answer is
// absent from `returns`, and the renderer prints 无数据 rather than filling the hole with a zero.
const macroMarketSeries = Object.freeze({
  dollarIndex: 'dxy-synthetic', dollarIndexReal: 'dxy-real', gold: 'xau-usd', offshoreYuan: 'usd-cnh', stablecoinPeg: 'usdt-usd'
} as const)

/** Kept in the same shape as the service policy so the wire names are one list, not two opinions. */
const macroMarketCaveats = Object.freeze({
  syntheticDollarIndex: 'synthetic-dollar-index', providerTimeSeries: 'provider-time-series'
} as const)

export const macroMarketSnapshotPublicPolicy = Object.freeze({
  method: 'intelligence.macro.marketSnapshot.query',
  /**
   * The reading ladder the wire may carry, shortest window first — and the one definition of it.
   *
   * It is the *producer's* ladder, not the table's column list: the service derives
   * `macroMarketWindows` from this array, so the process that builds the snapshot and the process
   * that validates it cannot hold two opinions about the vocabulary.
   *
   * The table prints four of these — 15m/1h/24h/7d — and `4h` crosses the wire unrendered. The macro
   * series is stored one point per fifteen minutes, so `4h` (sixteen stored points) is a window it
   * can honestly answer, and the analysis reads it as its own horizon. The cross-asset ladder has
   * always worked this way: `5m` and `4h` cross it and are never printed. Conflating "what may cross
   * the wire" with "what this table prints" made a real producer window a contract violation — and
   * because this parser fails the whole snapshot closed, one unrecognised key turned every reading
   * into 未接入.
   *
   * `5m` is still refused: a fifteen-minute series can never answer it, so admitting it would admit
   * a window that could only ever hold a fabricated figure.
   */
  windows: Object.freeze(['15m', '1h', '4h', '24h', '7d'] as const),
  /** The four series this boundary admits; no provider-native symbol ever crosses it. */
  series: macroMarketSeries,
  seriesIds: Object.freeze(Object.values(macroMarketSeries)) as readonly string[],
  /** The series the product computes rather than licenses, so the label travels with the level. */
  syntheticSeriesId: macroMarketSeries.dollarIndex,
  /**
   * The dollar row's candidates, best first: the provider's own index, then this product's synthesis.
   * Nothing else may fill the row, and the second entry is only reached when the first has no fresh
   * reading — so the computed level is never shown beside a licensed one.
   */
  dollarIndexPreference: Object.freeze([macroMarketSeries.dollarIndexReal, macroMarketSeries.dollarIndex] as const),
  /**
   * Three collection cycles (the real index is collected every five minutes). A real reading whose
   * newest point is older than this has stopped arriving — the app was closed, the key was revoked,
   * the provider is down — and the row falls back to the synthesised basket, tag and all.
   */
  dollarIndexFreshnessMs: 15 * 60_000,
  caveats: macroMarketCaveats,
  caveatIds: Object.freeze(Object.values(macroMarketCaveats)) as readonly string[],
  canonicalUtcPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  maximumReadings: 8,
  maximumCaveats: 8,
  maximumLevelAbs: 1e9,
  maximumSnapshotBytes: 16 * 1024,
  /**
   * The live leg of the gold row. The provider's free tier admits only XAU/USD, so gold is the one
   * series that may carry a live tick, and this is the only state vocabulary the wire admits for it.
   * The price is a string for the same reason a Binance quote is: it is a decimal the provider
   * published, not an arithmetic result this product owns.
   */
  live: Object.freeze({
    seriesId: macroMarketSeries.gold,
    states: Object.freeze(['disabled', 'connecting', 'live', 'stale', 'unavailable'] as const),
    pricePattern: /^(?:0|[1-9]\d*)(?:\.\d+)?$/,
    maxPriceLength: 24
  } as const)
} as const)

export type MacroMarketWindow = typeof macroMarketSnapshotPublicPolicy.windows[number]
export type MacroMarketCaveat = typeof macroMarketCaveats[keyof typeof macroMarketCaveats]
export type MacroMarketLiveState = typeof macroMarketSnapshotPublicPolicy.live.states[number]

/** The latest value that is not a closed bar: shown beside the row, used by no window return. */
export type MacroMarketLiveTick = Readonly<{ state: MacroMarketLiveState; price: string; atMs: number }>

export type MacroMarketSnapshotReading = Readonly<{
  seriesId: string
  level: number
  atMs: number
  /** Only the windows the store could actually answer; a missing key is a stated gap. */
  returns: Readonly<Partial<Record<MacroMarketWindow, number>>>
  synthetic?: true
  /** Admitted on the gold reading only, and only while a tick exists to show. */
  live?: MacroMarketLiveTick
}>

/** Whether the source behind the snapshot could have collected at all: enabled, and keyed. */
export type MacroMarketSourceView = Readonly<{ enabled: boolean; hasCredential: boolean }>

/**
 * The renderer-safe view. `lastRunAtMs`/`lastPlan` stay in the main process: the plan string names
 * provider symbols and the table has no reader for either field. `source` is what lets the 来源状态
 * strip say "waiting for the first collection" instead of an unqualified "unavailable".
 */
export type MacroMarketSnapshotView =
  | Readonly<{ state: 'available' | 'empty'; asOf: string; source: MacroMarketSourceView; readings: readonly MacroMarketSnapshotReading[]; caveats: readonly MacroMarketCaveat[] }>
  | Readonly<{ state: 'unavailable' }>

/** The one admitted request shape: no arguments at all — the snapshot is product-wide. */
export function isMacroMarketSnapshotQuery(value: unknown): value is Record<string, never> {
  try {
    if (!plainRecord(value)) return false
    return Reflect.ownKeys(value).length === 0
  } catch { return false }
}

/**
 * Sanitises the snapshot at both ends of the wire: the main process runs it before the payload
 * leaves, the renderer runs it again on arrival. Anything outside the admitted shape becomes
 * `unavailable`, so a malformed answer reads as "no data" and never as a figure.
 */
export function parseMacroMarketSnapshot(value: unknown): MacroMarketSnapshotView | undefined {
  try {
    if (!plainRecord(value)) return undefined
    if (value.state === 'unavailable') return exactFields(value, ['state']) ? Object.freeze({ state: 'unavailable' as const }) : undefined
    if (value.state !== 'available' && value.state !== 'empty') return undefined
    // `lastRunAtMs`/`lastPlan` are accepted on the way in and dropped: the renderer never sees them.
    if (!exactFields(value, ['state', 'asOf', 'source', 'readings', 'caveats'], ['lastRunAtMs', 'lastPlan'])) return undefined
    if (!instant(value.asOf)) return undefined
    if (!exactFields(value.source, ['enabled', 'hasCredential']) ||
      typeof value.source.enabled !== 'boolean' || typeof value.source.hasCredential !== 'boolean') return undefined
    if (Object.hasOwn(value, 'lastRunAtMs') && !(Number.isSafeInteger(value.lastRunAtMs) && (value.lastRunAtMs as number) >= 0)) return undefined
    if (Object.hasOwn(value, 'lastPlan') && !plan(value.lastPlan)) return undefined
    if (!safeArray(value.readings, isReading) || value.readings.length > macroMarketSnapshotPublicPolicy.maximumReadings) return undefined
    if (!safeArray(value.caveats, isCaveat) || value.caveats.length > macroMarketSnapshotPublicPolicy.maximumCaveats) return undefined
    // `available` means a level was actually read; a claim of availability without one is rejected
    // structurally so the 来源状态 strip can never print 可用 over an empty store.
    if ((value.state === 'empty') !== (value.readings.length === 0)) return undefined
    const readings = value.readings.map(reading => Object.freeze({
      seriesId: reading.seriesId, level: reading.level, atMs: reading.atMs,
      returns: Object.freeze({ ...reading.returns }), ...(reading.synthetic ? { synthetic: true as const } : {}),
      ...(reading.live ? { live: Object.freeze({ state: reading.live.state, price: reading.live.price, atMs: reading.live.atMs }) } : {})
    }))
    const view = Object.freeze({
      state: value.state, asOf: value.asOf,
      source: Object.freeze({ enabled: value.source.enabled, hasCredential: value.source.hasCredential }),
      readings: Object.freeze(readings), caveats: Object.freeze([...value.caveats])
    })
    return new TextEncoder().encode(JSON.stringify(view)).byteLength <= macroMarketSnapshotPublicPolicy.maximumSnapshotBytes ? view : undefined
  } catch { return undefined }
}

function isReading(value: unknown): value is MacroMarketSnapshotReading {
  if (!exactFields(value, ['seriesId', 'level', 'atMs', 'returns'], ['synthetic', 'live'])) return false
  const policy = macroMarketSnapshotPublicPolicy
  if (!policy.seriesIds.includes(value.seriesId as string)) return false
  if (typeof value.level !== 'number' || !Number.isFinite(value.level) || Math.abs(value.level) > policy.maximumLevelAbs) return false
  if (!Number.isSafeInteger(value.atMs) || (value.atMs as number) < 0) return false
  if (Object.hasOwn(value, 'synthetic') && (value.synthetic !== true || value.seriesId !== policy.syntheticSeriesId)) return false
  // The live leg belongs to gold alone, so a live tick on the dollar, the yuan or the peg is a
  // contract violation rather than an extra field to be ignored.
  if (Object.hasOwn(value, 'live') && (value.seriesId !== policy.live.seriesId || !isLive(value.live))) return false
  const returns = value.returns
  if (!plainRecord(returns)) return false
  const windows: readonly string[] = policy.windows
  return Object.getOwnPropertyNames(returns).every(window => windows.includes(window) &&
    typeof returns[window] === 'number' && Number.isFinite(returns[window]))
}

/** Strictest reading of a live tick: three known fields, an admitted state, a decimal, a real instant. */
function isLive(value: unknown): value is MacroMarketLiveTick {
  const policy = macroMarketSnapshotPublicPolicy.live
  if (!exactFields(value, ['state', 'price', 'atMs'])) return false
  if (typeof value.state !== 'string' || !(policy.states as readonly string[]).includes(value.state)) return false
  if (typeof value.price !== 'string' || value.price.length === 0 || value.price.length > policy.maxPriceLength ||
    !policy.pricePattern.test(value.price) || !Number.isFinite(Number(value.price)) || Number(value.price) <= 0) return false
  return Number.isSafeInteger(value.atMs) && (value.atMs as number) >= 0
}

function isCaveat(value: unknown): value is MacroMarketCaveat {
  return typeof value === 'string' && macroMarketSnapshotPublicPolicy.caveatIds.includes(value)
}

/** The collector's plan label names provider symbols, so it is bounded here and never forwarded. */
function plan(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && !/[\u0000-\u001f\u007f]/u.test(value)
}

function instant(value: unknown): value is string {
  return typeof value === 'string' && macroMarketSnapshotPublicPolicy.canonicalUtcPattern.test(value) &&
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
