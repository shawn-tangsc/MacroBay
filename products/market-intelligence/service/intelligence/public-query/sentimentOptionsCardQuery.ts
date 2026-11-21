import {
  fearGreedSnapshotPolicy,
  isCanonicalFearGreedSnapshotTime,
  type FearGreedCardSection,
  type OptionSkewCardSection,
  type OptionSkewSeriesPoint,
  type SentimentOptionsCardQueryInput,
  type SentimentOptionsCardResult
} from '../../../contracts/intelligenceQueryContracts'
import { marketPulsePolicy } from '../../../contracts/marketPulse'
import type { IntelligencePipeline } from '../application/intelligencePipeline'
import { getIntelligenceSourceDefinition } from '../application/sourceCatalog'
import { readFearGreedDailyPoints } from './fearGreedDailyPoints'
import {
  calendarDaysBetween,
  computeFearGreedPercentile,
  computeOptionSkewDirection,
  isValidTimeZone,
  localDayLabel,
  sentimentOptionsCardPolicy,
  utcDayLabel
} from './sentimentOptionsCardPolicy'

/** One stored option-skew day. Supplied by the product's own store; absent before the source is live. */
export type OptionSkewStoredPoint = {
  day: string
  observedAt: string
  riskReversal: number
  putIv25: number
  callIv25: number
  expiries: readonly [string, string]
  tenorDays: 30
}

export type OptionSkewStoreRead = {
  points: readonly OptionSkewStoredPoint[]
  /** Why the latest collection attempt failed, if it did. Decides "unreadable", not "empty". */
  lastFailureCause?: 'connection-unavailable' | 'upstream-http-error'
}

export type SentimentOptionsCardQueryDependencies = {
  pipeline: Pick<IntelligencePipeline, 'listItems' | 'listMetricEvents'>
  /** Absent until the option-skew store exists: the card then reads "not connected", not "empty". */
  readOptionSkew?: () => OptionSkewStoreRead
  /** Defaults to the product catalog. Injectable so tests can exercise the live path. */
  readSkewReadiness?: () => string | undefined
}

export function querySentimentOptionsCard(
  input: SentimentOptionsCardQueryInput & SentimentOptionsCardQueryDependencies
): SentimentOptionsCardResult {
  const base = { asOf: input.asOf, windowDays: input.windowDays, timeZone: input.timeZone }
  if (!isCanonicalFearGreedSnapshotTime(input.asOf) || !isValidTimeZone(input.timeZone) ||
    !(sentimentOptionsCardPolicy.windowDays as readonly number[]).includes(input.windowDays)) {
    return {
      ...base,
      fearGreed: { state: 'unavailable', failureCode: 'fear-greed-query-unavailable' },
      optionSkew: { state: 'unavailable', failureCode: 'option-skew-query-unavailable' }
    }
  }

  return {
    ...base,
    fearGreed: fearGreedSection(input),
    optionSkew: optionSkewSection(input)
  }
}

function fearGreedSection(input: SentimentOptionsCardQueryInput & SentimentOptionsCardQueryDependencies): FearGreedCardSection {
  // The series tolerates a corrupt day (skips and counts it); the snapshot stays strict.
  const read = readFearGreedDailyPoints({ pipeline: input.pipeline, asOf: input.asOf, tolerateBadEntries: true })
  if (read.state === 'unavailable') return { state: 'unavailable', failureCode: fearGreedSnapshotPolicy.unavailableFailureCode }
  if (read.state === 'empty') return { state: 'empty' }

  const latest = read.days[0]
  if (!latest) return { state: 'empty' }
  const daysAgo = Math.max(0, calendarDaysBetween(latest.day, localDayLabel(input.asOf, input.timeZone)))
  const stale = Date.parse(input.asOf) - Date.parse(latest.observedAt) > marketPulsePolicy.fearGreedStaleAfterMs
  const points = read.days
    .filter((point) => point.day >= windowStartDay(input.asOf, input.windowDays) && point.day <= utcDayLabel(input.asOf))
    .map((point) => ({ day: point.day, observedAt: point.observedAt, score: point.score, bucket: point.bucket }))
  const percentile = computeFearGreedPercentile({ points: read.days.map((point) => ({ day: point.day, score: point.score })), asOf: input.asOf })

  return {
    state: 'available',
    score: latest.score,
    bucket: latest.bucket,
    observedAt: latest.observedAt,
    latestDay: latest.day,
    daysAgo,
    stale,
    seriesStart: read.days[read.days.length - 1]!.day,
    points,
    ...(percentile === undefined ? {} : { percentile })
  }
}

function optionSkewSection(input: SentimentOptionsCardQueryInput & SentimentOptionsCardQueryDependencies): OptionSkewCardSection {
  // "Not connected" is decided here, from the registered source's readiness — never in the
  // renderer and never by inferring from a cell switch. A planned/pending source has no store to read.
  const readiness = (input.readSkewReadiness ?? (() => getIntelligenceSourceDefinition(SKEW_SOURCE_ID)?.readiness))()
  if (readiness === 'planned' || readiness === 'pending') return { state: 'not-connected' }

  if (!input.readOptionSkew) {
    return { state: 'unavailable', failureCode: 'option-skew-collect-unavailable', cause: 'connection-unavailable' }
  }

  let stored: OptionSkewStoreRead
  try {
    stored = input.readOptionSkew()
  } catch {
    // A store that cannot be read is "could not read", never "nothing yet": the fear-greed half
    // still answers, only this leg degrades.
    return { state: 'unavailable', failureCode: 'option-skew-query-unavailable' }
  }
  const points = stored.points
  if (points.length > 0 && !points.every(isReadablePoint)) return { state: 'unavailable', failureCode: 'option-skew-query-unavailable' }
  if (points.length === 0) {
    // No history and the latest attempt failed is "unreadable", never "nothing yet" (the reader
    // cannot tell "no data" from "could not fetch" once the reason is dropped).
    return stored.lastFailureCause
      ? { state: 'unavailable', failureCode: 'option-skew-collect-unavailable', cause: stored.lastFailureCause }
      : { state: 'empty' }
  }

  const sorted = [...points].sort((left, right) => (right.day > left.day ? 1 : right.day < left.day ? -1 : 0))
  const latest = sorted[0]!
  const daysAgo = Math.max(0, calendarDaysBetween(latest.day, localDayLabel(input.asOf, input.timeZone)))
  const inWindow = sorted.filter((point) => point.day >= windowStartDay(input.asOf, input.windowDays) && point.day <= utcDayLabel(input.asOf))

  return {
    state: 'available',
    latest: {
      riskReversal: latest.riskReversal,
      observedAt: latest.observedAt,
      tenorDays: latest.tenorDays,
      putIv25: latest.putIv25,
      callIv25: latest.callIv25,
      expiries: latest.expiries
    },
    // Direction reads the whole series, never the chart window: switching 30/90 must not change it.
    direction: computeOptionSkewDirection({
      points: sorted.map((point) => ({ day: point.day, riskReversal: point.riskReversal })),
      daysAgo
    }),
    observedAt: latest.observedAt,
    latestDay: latest.day,
    daysAgo,
    stale: daysAgo > sentimentOptionsCardPolicy.direction.staleAfterDays,
    seriesStart: sorted[sorted.length - 1]!.day,
    points: inWindow.map((point): OptionSkewSeriesPoint => ({ day: point.day, observedAt: point.observedAt, riskReversal: point.riskReversal }))
  }
}

const SKEW_SOURCE_ID = 'deribit-options'

/** First day of the chart window: `windowDays` calendar days ending on the as-of UTC day. */
function windowStartDay(asOf: string, windowDays: number): string {
  const end = Date.parse(`${utcDayLabel(asOf)}T00:00:00.000Z`)
  return new Date(end - (windowDays - 1) * 86_400_000).toISOString().slice(0, 10)
}

function isReadablePoint(point: unknown): point is OptionSkewStoredPoint {
  if (!point || typeof point !== 'object') return false
  const record = point as Record<string, unknown>
  return typeof record.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.day) &&
    isCanonicalFearGreedSnapshotTime(record.observedAt) &&
    typeof record.riskReversal === 'number' && Number.isFinite(record.riskReversal) &&
    typeof record.putIv25 === 'number' && Number.isFinite(record.putIv25) &&
    typeof record.callIv25 === 'number' && Number.isFinite(record.callIv25) &&
    record.tenorDays === 30 &&
    Array.isArray(record.expiries) && record.expiries.length === 2 && record.expiries.every((entry) => typeof entry === 'string')
}