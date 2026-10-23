import { BLS_MACRO_SERIES } from '../../application/macroSourceCatalogMetadata'
import type { MetricIntelligenceEventDraft } from '../../schema/intelligenceMetricEvent'
import type { IntelligenceSourceConfig } from '../../schema/intelligenceSource'
import { BLS_RELEASE_CALENDAR_CAVEAT, resolveBlsReleaseTime } from './blsReleaseCalendar'

type BlsObservation = {
  year?: string
  period?: string
  periodName?: string
  value?: string
}

type BlsSeriesPayload = {
  Results?: {
    series?: Array<{
      seriesID?: string
      data?: BlsObservation[]
    }>
  }
}

const SERIES_BY_PROVIDER_ID = new Map(BLS_MACRO_SERIES.map((row) => [row.providerSeriesId ?? '', row]))

export function parseBlsEconomicSeriesPayload(
  payload: unknown,
  config: IntelligenceSourceConfig
): MetricIntelligenceEventDraft[] {
  const body = payload as BlsSeriesPayload
  const drafts: MetricIntelligenceEventDraft[] = []

  for (const series of body.Results?.series ?? []) {
    const seriesId = series.seriesID ?? ''
    const meta = SERIES_BY_PROVIDER_ID.get(seriesId)
    if (!meta) continue

    const observationByKey = indexObservations(series.data ?? [])
    const latestKey = [...observationByKey.keys()].sort(comparePeriodKeys).at(-1)
    if (!latestKey) continue

    const latest = observationByKey.get(latestKey)
    if (!latest || !Number.isFinite(latest.value)) {
      throw new Error(`bls-economic-series: missing numeric value for ${seriesId}`)
    }

    const draft = buildMetricDraft({
      config,
      meta,
      seriesId,
      latestKey,
      latest,
      observationByKey
    })
    if (draft) drafts.push(draft)
  }

  if (drafts.length === 0) {
    throw new Error('bls-economic-series: no series observations found')
  }

  return drafts
}

function buildMetricDraft(input: {
  config: IntelligenceSourceConfig
  meta: (typeof BLS_MACRO_SERIES)[number]
  seriesId: string
  latestKey: string
  latest: { value: number; observation: BlsObservation }
  observationByKey: Map<string, { value: number; observation: BlsObservation }>
}): MetricIntelligenceEventDraft | null {
  const period = input.latestKey
  const releaseTime = resolveBlsReleaseTime({ periodKey: period, metricKind: input.meta.metricKind })

  if (input.meta.key === 'US_CPI_HEADLINE_YOY' || input.meta.key === 'US_CPI_CORE_YOY') {
    const yoy = computeYearOverYearPercent(input.latestKey, input.observationByKey)
    if (yoy === undefined) return null

    const previousYoyKey = shiftPeriodKey(input.latestKey, -1)
    const previousYoy = computeYearOverYearPercent(previousYoyKey, input.observationByKey)
    const delta = previousYoy !== undefined ? yoy - previousYoy : undefined

    return {
      sourceId: input.config.sourceId,
      metricKey: input.meta.key,
      metricName: input.meta.metricName,
      metricKind: input.meta.metricKind,
      actual: roundMetric(yoy),
      previous: previousYoy !== undefined ? roundMetric(previousYoy) : undefined,
      unit: 'percent',
      period,
      releaseTime,
      comparisonBasis: 'actual-vs-previous',
      surpriseDirection: delta === undefined ? 'unknown' : delta > 0.05 ? 'above' : delta < -0.05 ? 'below' : 'inline',
      surpriseMagnitude: delta !== undefined ? Math.abs(delta) : undefined,
      rawValueJson: JSON.stringify({
        seriesId: input.seriesId,
        periodName: input.latest.observation.periodName,
        indexLevel: input.latest.value,
        computedYoY: roundMetric(yoy),
        releaseCalendarCaveat: BLS_RELEASE_CALENDAR_CAVEAT
      })
    }
  }

  if (input.meta.key === 'US_PAYROLLS_NFP') {
    const previousKey = shiftPeriodKey(input.latestKey, -1)
    const previousLevel = input.observationByKey.get(previousKey)?.value
    if (previousLevel === undefined) return null

    const monthlyChange = input.latest.value - previousLevel
    const priorChangeKey = shiftPeriodKey(previousKey, -1)
    const priorLevel = input.observationByKey.get(priorChangeKey)?.value
    const previousChange = priorLevel !== undefined ? previousLevel - priorLevel : undefined
    const delta = previousChange !== undefined ? monthlyChange - previousChange : undefined

    return {
      sourceId: input.config.sourceId,
      metricKey: input.meta.key,
      metricName: input.meta.metricName,
      metricKind: input.meta.metricKind,
      actual: roundMetric(monthlyChange),
      previous: previousChange !== undefined ? roundMetric(previousChange) : roundMetric(previousLevel),
      unit: 'thousands',
      period,
      releaseTime,
      comparisonBasis: 'period-change',
      surpriseDirection:
        delta === undefined ? 'unknown' : delta > 0 ? 'above' : delta < 0 ? 'below' : 'inline',
      surpriseMagnitude: delta !== undefined ? Math.abs(delta) : undefined,
      rawValueJson: JSON.stringify({
        seriesId: input.seriesId,
        employmentLevel: input.latest.value,
        monthlyChange: roundMetric(monthlyChange),
        releaseCalendarCaveat: BLS_RELEASE_CALENDAR_CAVEAT
      })
    }
  }

  if (input.meta.key === 'US_UNEMPLOYMENT_RATE') {
    const previousKey = shiftPeriodKey(input.latestKey, -1)
    const previousValue = input.observationByKey.get(previousKey)?.value
    const delta = previousValue !== undefined ? input.latest.value - previousValue : undefined

    return {
      sourceId: input.config.sourceId,
      metricKey: input.meta.key,
      metricName: input.meta.metricName,
      metricKind: input.meta.metricKind,
      actual: roundMetric(input.latest.value),
      previous: previousValue !== undefined ? roundMetric(previousValue) : undefined,
      unit: 'percent',
      period,
      releaseTime,
      comparisonBasis: 'actual-vs-previous',
      surpriseDirection:
        delta === undefined ? 'unknown' : delta > 0 ? 'above' : delta < 0 ? 'below' : 'inline',
      surpriseMagnitude: delta !== undefined ? Math.abs(delta) : undefined,
      rawValueJson: JSON.stringify({
        seriesId: input.seriesId,
        periodName: input.latest.observation.periodName,
        releaseCalendarCaveat: BLS_RELEASE_CALENDAR_CAVEAT
      })
    }
  }

  return null
}

function indexObservations(observations: BlsObservation[]): Map<string, { value: number; observation: BlsObservation }> {
  const map = new Map<string, { value: number; observation: BlsObservation }>()
  for (const observation of observations) {
    const key = periodKey(observation.year, observation.period)
    if (!key) continue
    const value = Number(observation.value)
    if (!Number.isFinite(value)) continue
    map.set(key, { value, observation })
  }
  return map
}

function computeYearOverYearPercent(
  periodKeyValue: string,
  observationByKey: Map<string, { value: number }>
): number | undefined {
  const current = observationByKey.get(periodKeyValue)?.value
  const yearAgoKey = shiftPeriodKey(periodKeyValue, -12)
  const yearAgo = observationByKey.get(yearAgoKey)?.value
  if (current === undefined || yearAgo === undefined || yearAgo === 0) return undefined
  return ((current / yearAgo) - 1) * 100
}

function periodKey(year?: string, period?: string): string | undefined {
  if (!year || !period) return undefined
  return `${year}-${period}`
}

function shiftPeriodKey(key: string, monthDelta: number): string {
  const match = /^(\d{4})-(M\d{2})$/.exec(key)
  if (!match) return key

  const year = Number(match[1])
  const month = Number(match[2]?.slice(1))
  const absoluteMonth = year * 12 + (month - 1) + monthDelta
  const nextYear = Math.floor(absoluteMonth / 12)
  const nextMonth = (absoluteMonth % 12) + 1
  return `${nextYear}-M${String(nextMonth).padStart(2, '0')}`
}

function comparePeriodKeys(left: string, right: string): number {
  return left.localeCompare(right)
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000
}
