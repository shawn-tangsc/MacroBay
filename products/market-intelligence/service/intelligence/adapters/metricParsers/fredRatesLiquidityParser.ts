import { FRED_MACRO_SERIES } from '../../application/macroSourceCatalogMetadata'
import type { MetricIntelligenceEventDraft } from '../../schema/intelligenceMetricEvent'
import type { IntelligenceSourceConfig } from '../../schema/intelligenceSource'

type FredObservation = {
  date?: string
  value?: string
}

type FredPayload = {
  observations?: FredObservation[]
  realtime_start?: string
  realtime_end?: string
}

const SERIES_BY_PROVIDER_ID = new Map(FRED_MACRO_SERIES.map((row) => [row.providerSeriesId ?? '', row]))

/**
 * FRED publishes each observation as a **string** and writes `.` for a day it has no value for
 * (weekends, Columbus Day and other market holidays). The sentinel is skipped rather than parsed:
 * `Number('.')` is `NaN`, but a sentinel that survived as `0` would read as a 0% yield.
 */
const FRED_MISSING_VALUE = '.'
/** `YYYY-MM-DD`, the only date shape FRED's `observations[].date` has. */
const FRED_OBSERVATION_DATE = /^\d{4}-\d{2}-\d{2}$/

export function parseFredRatesLiquidityPayload(
  payload: unknown,
  config: IntelligenceSourceConfig,
  seriesId?: string
): MetricIntelligenceEventDraft[] {
  const body = payload as FredPayload
  const meta = seriesId ? SERIES_BY_PROVIDER_ID.get(seriesId) : undefined
  const observations = (body.observations ?? [])
    .map((row) => ({ date: (row.date ?? '').trim(), value: (row.value ?? '').trim() }))
    // A row without an observation date can never become a period, so it is not an observation.
    .filter((row) => FRED_OBSERVATION_DATE.test(row.date))
    .filter((row) => row.value !== '' && row.value !== FRED_MISSING_VALUE)
    // `"4.8"` has no leading zero and parses as 4.8; the display layer owns the two decimals.
    .map((row) => ({ date: row.date, value: Number(row.value) }))
    .filter((row) => Number.isFinite(row.value))
    .sort((left, right) => left.date.localeCompare(right.date))

  if (!observations.length) {
    throw new Error(`fred-rates-liquidity: no usable observations for ${seriesId ?? 'unknown-series'}`)
  }

  const latest = observations.at(-1)!
  const previous = observations.at(-2)
  const delta = previous ? latest.value - previous.value : undefined
  const metricMeta =
    meta ??
    ({
      key: seriesId ?? 'UNKNOWN_FRED_SERIES',
      metricName: seriesId ?? 'Unknown FRED Series',
      metricKind: 'rate',
      comparisonBasis: 'period-change',
      frequency: 'daily',
      unit: 'percent'
    } as const)

  return [
    {
      sourceId: config.sourceId,
      metricKey: metricMeta.key,
      metricName: metricMeta.metricName,
      metricKind: metricMeta.metricKind,
      actual: roundMetric(latest.value),
      previous: previous ? roundMetric(previous.value) : undefined,
      unit: metricMeta.unit,
      period: latest.date,
      releaseTime: `${latest.date}T00:00:00.000Z`,
      comparisonBasis: metricMeta.comparisonBasis,
      surpriseDirection:
        delta === undefined ? 'unknown' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'inline',
      surpriseMagnitude: delta !== undefined ? Math.abs(delta) : undefined,
      rawValueJson: JSON.stringify({
        seriesId,
        observationDate: latest.date,
        realtimeEnd: body.realtime_end
      })
    }
  ]
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000
}
