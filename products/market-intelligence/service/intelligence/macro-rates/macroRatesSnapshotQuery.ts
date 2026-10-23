import { macroRatesSnapshotPublicPolicy } from '../../../contracts/macro/macroRatesSnapshotContracts'
import type { MacroRatesReading } from '../../../contracts/macro/macroRatesSnapshotContracts'
import type { MetricIntelligenceEvent } from '../schema/intelligenceMetricEvent'

export type MacroRatesSnapshot =
  | Readonly<{
      state: 'available' | 'empty'
      asOf: string
      readings: readonly MacroRatesReading[]
      caveats: readonly string[]
    }>
  | Readonly<{ state: 'unavailable' }>

export type MacroRatesSnapshotQueryDeps = Readonly<{
  /** The metric pipeline's stored events: FRED readings are what the collector already parsed. */
  listMetricEvents: () => MetricIntelligenceEvent[]
  now?: () => number
}>

/**
 * The daily rate block's read path. It publishes only what the store actually holds: a series with no
 * visible observation is absent from `readings` (the row then says 未接入), a level that fails its own
 * bounds is dropped rather than clamped, and a series whose newest observation contradicts itself is
 * dropped entirely rather than resolved by pick order.
 */
export function createMacroRatesSnapshotQuery(deps: MacroRatesSnapshotQueryDeps) {
  const seriesByMetricKey = new Map<string, string>(
    Object.entries(macroRatesSnapshotPublicPolicy.metricKeys).map(([seriesId, metricKey]) => [metricKey, seriesId])
  )

  function snapshot(): MacroRatesSnapshot {
    const asOf = new Date((deps.now ?? Date.now)()).toISOString()
    let metrics: MetricIntelligenceEvent[]
    try {
      metrics = deps.listMetricEvents()
      if (!Array.isArray(metrics)) return unavailable()
    } catch {
      // A store that cannot be read is not an empty store: the panel must not read it as "no data yet".
      return unavailable()
    }

    const candidates = new Map<string, Candidate[]>()
    for (const metric of metrics) {
      const evidence = readEvidence(metric, asOf, seriesByMetricKey)
      if (!evidence) continue
      const bucket = candidates.get(evidence.seriesId)
      if (bucket) bucket.push(evidence)
      else candidates.set(evidence.seriesId, [evidence])
    }

    const readings: MacroRatesReading[] = []
    // The order the block reads, not the order the store happened to return.
    for (const seriesId of macroRatesSnapshotPublicPolicy.seriesIds) {
      const newest = newestUnambiguous(candidates.get(seriesId))
      if (newest) readings.push(newest)
    }

    return Object.freeze({
      state: readings.length > 0 ? 'available' as const : 'empty' as const,
      asOf,
      readings: Object.freeze(readings),
      caveats: Object.freeze([macroRatesSnapshotPublicPolicy.caveats.officialDailyClose])
    })
  }

  return { snapshot }
}

export type MacroRatesSnapshotQuery = ReturnType<typeof createMacroRatesSnapshotQuery>

type Candidate = Readonly<{
  seriesId: string
  metricKey: string
  actual: number
  previous?: number
  period: string
  releaseTime: string
}>

function readEvidence(
  metric: MetricIntelligenceEvent | undefined,
  asOf: string,
  seriesByMetricKey: ReadonlyMap<string, string>
): Candidate | undefined {
  if (!metric || typeof metric !== 'object') return undefined
  if (metric.sourceId !== macroRatesSnapshotPublicPolicy.sourceId) return undefined
  const seriesId = seriesByMetricKey.get(metric.metricKey)
  if (!seriesId) return undefined
  if (typeof metric.releaseTime !== 'string' || !macroRatesSnapshotPublicPolicy.canonicalUtcPattern.test(metric.releaseTime)) return undefined
  // Visibility: an observation the store holds but the clock has not reached is not a reading yet.
  if (metric.releaseTime > asOf) return undefined
  if (!level(metric.actual)) return undefined
  if (typeof metric.period !== 'string' || !macroRatesSnapshotPublicPolicy.observationDatePattern.test(metric.period)) return undefined
  // A malformed prior day costs the change, never the level: the field is absent, not invented.
  const previous = level(metric.previous) ? metric.previous : undefined
  return Object.freeze({
    seriesId, metricKey: metric.metricKey, actual: metric.actual, period: metric.period, releaseTime: metric.releaseTime,
    ...(previous === undefined ? {} : { previous })
  })
}

/** The newest observation, or nothing at all when the newest instant carries two different readings. */
function newestUnambiguous(bucket: readonly Candidate[] | undefined): MacroRatesReading | undefined {
  if (!bucket || bucket.length === 0) return undefined
  const newest = bucket.reduce((latest, candidate) => candidate.releaseTime > latest.releaseTime ? candidate : latest)
  const tied = bucket.filter((candidate) => candidate.releaseTime === newest.releaseTime)
  const agreed = tied.every((candidate) => candidate.actual === newest.actual && candidate.previous === newest.previous && candidate.period === newest.period)
  if (!agreed) return undefined
  return Object.freeze({
    seriesId: newest.seriesId, metricKey: newest.metricKey, actual: newest.actual, period: newest.period,
    ...(newest.previous === undefined ? {} : { previous: newest.previous })
  })
}

function level(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= macroRatesSnapshotPublicPolicy.maximumLevelAbs
}

function unavailable(): MacroRatesSnapshot {
  return Object.freeze({ state: 'unavailable' as const })
}
