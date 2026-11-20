import type { MacroMarketPoint, MacroMarketStore } from '../macro-market/macroMarketStore'
import { macroMarketRatesSeries } from '../macro-market/macroMarketSeries'
import { readFredObservations } from '../adapters/metricParsers/fredRatesLiquidityParser'

/**
 * The daily rate closes, written into the macro-market store so the four rate rows have a window
 * instead of one day.
 *
 * Two facts decide the shape here.
 *
 * 1. **The window is the payload, not the newest row.** The collector asks the provider for a whole
 *    trading year in one answer, and the feed item keeps the newest observation because that is what
 *    a metric event is. The other four hundred rows are history, and this module is the one place
 *    that reads them: same parser, same rule about the `.` sentinel, no second interpretation.
 * 2. **A trading day is the key.** The store's primary key is already `(series, at_ms)`, and a close
 *    is stamped at the UTC midnight of the day it covers, so writing the same window twice inserts
 *    nothing. There is no read-then-write here on purpose: a check-then-insert would race with itself
 *    the moment two runs overlap.
 *
 * A day the provider answers `.` for gets **no row** rather than a zero. The gap is the fact; a 0%
 * yield would be a different one.
 */
export const fredRatesHistorySourceId = 'fred-rates-liquidity'

const seriesByProviderId = new Map<string, string>(Object.entries(macroMarketRatesSeries))

export function fredRatesHistoryPoints(input: Readonly<{
  payload: unknown
  providerSeriesId: string
  /** When this window was written, so a reader can tell a backfill from a fresh fetch. */
  observedAtMs: number
}>): MacroMarketPoint[] {
  const series = seriesByProviderId.get(input.providerSeriesId)
  if (!series) return []
  return readFredObservations(input.payload).map((row) => ({
    series,
    atMs: Date.parse(`${row.date}T00:00:00.000Z`),
    value: row.value,
    observedAtMs: input.observedAtMs
  }))
}

export type FredRatesWindowIngest = Readonly<{ sourceId: string; payloadBody?: string; payloadMetaJson?: string }>
export type FredRatesHistoryWrite =
  | Readonly<{ state: 'stored' | 'unchanged'; added: number }>
  | Readonly<{ state: 'skipped' | 'unrecognized'; added: 0 }>

/**
 * The pipeline's window sink for this source: it receives the bytes the collector stored, exactly as
 * the feed item's parse saw them.
 *
 * It never throws. A store that refused a write must not fail the collection that produced it — the
 * item, the health line and the notification are the run's business; this is a second copy for the
 * dashboard's chart. A refused write is reported as `skipped` with a log line, not as silence.
 */
export function createFredRatesHistorySink(deps: Readonly<{
  store: Pick<MacroMarketStore, 'append'>
  now?: () => number
  log?: (event: string, fields: Readonly<Record<string, unknown>>) => void
}>) {
  const log = deps.log ?? ((event: string, fields: Readonly<Record<string, unknown>>) => {
    console.log(JSON.stringify({ marker: 'MI_FRED_RATES_HISTORY', event, ...fields }))
  })

  return (input: FredRatesWindowIngest): FredRatesHistoryWrite => {
    if (input.sourceId !== fredRatesHistorySourceId) return { state: 'skipped', added: 0 }
    if (!input.payloadBody) return { state: 'skipped', added: 0 }
    const providerSeriesId = readSeriesId(input.payloadMetaJson)
    if (!providerSeriesId) return { state: 'skipped', added: 0 }
    if (!seriesByProviderId.has(providerSeriesId)) {
      // A series the source collects but no rate row reads: a mapping is missing, not a data gap.
      log('unmapped-series', { providerSeriesId })
      return { state: 'unrecognized', added: 0 }
    }

    try {
      const points = fredRatesHistoryPoints({
        payload: JSON.parse(input.payloadBody),
        providerSeriesId,
        observedAtMs: (deps.now ?? Date.now)()
      })
      if (!points.length) return { state: 'skipped', added: 0 }
      const appended = deps.store.append(points)
      if (appended.state === 'invalid-input') {
        log('invalid-input', { providerSeriesId, points: points.length })
        return { state: 'skipped', added: 0 }
      }
      return { state: appended.state, added: appended.added }
    } catch (error) {
      log('write-failed', { providerSeriesId, reason: error instanceof Error ? error.message : String(error) })
      return { state: 'skipped', added: 0 }
    }
  }
}

/** The provider series id the collector recorded beside the payload, when it recorded a usable one. */
function readSeriesId(payloadMetaJson: string | undefined): string | undefined {
  if (!payloadMetaJson) return undefined
  try {
    const meta = JSON.parse(payloadMetaJson) as { seriesId?: unknown }
    return typeof meta.seriesId === 'string' && meta.seriesId.trim() ? meta.seriesId.trim() : undefined
  } catch { return undefined }
}
