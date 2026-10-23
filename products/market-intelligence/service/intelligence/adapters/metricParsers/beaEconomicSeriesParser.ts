import { BEA_MACRO_SERIES } from '../../application/macroSourceCatalogMetadata'
import type { MetricIntelligenceEventDraft } from '../../schema/intelligenceMetricEvent'
import type { IntelligenceSourceConfig } from '../../schema/intelligenceSource'

type BeaDataRow = {
  TableName?: string
  LineNumber?: string
  LineDescription?: string
  TimePeriod?: string
  METRIC_DESC?: string
  CL_UNIT?: string
  UNIT_MULT?: string
  DataValue?: string
  NoteRef?: string
}

type BeaPayload = {
  BEAAPI?: {
    Results?: {
      Error?: { APIErrorDescription?: string; APIErrorCode?: string }
      Data?: BeaDataRow[]
    }
  }
}

const SERIES_BY_TABLE_LINE = new Map(
  BEA_MACRO_SERIES.map((row) => [`${row.table}:${row.lineCode}`, row])
)

export function parseBeaEconomicSeriesPayload(
  payload: unknown,
  config: IntelligenceSourceConfig
): MetricIntelligenceEventDraft[] {
  const body = payload as BeaPayload
  const error = body.BEAAPI?.Results?.Error
  if (error?.APIErrorDescription || error?.APIErrorCode) {
    throw new Error(`bea-economic-series: ${error.APIErrorDescription ?? error.APIErrorCode}`)
  }

  const rows = body.BEAAPI?.Results?.Data ?? []
  if (!rows.length) {
    throw new Error('bea-economic-series: empty result set')
  }

  const grouped = new Map<string, BeaDataRow[]>()
  for (const row of rows) {
    const key = `${row.TableName ?? ''}:${row.LineNumber ?? ''}`
    const bucket = grouped.get(key) ?? []
    bucket.push(row)
    grouped.set(key, bucket)
  }

  const drafts: MetricIntelligenceEventDraft[] = []
  for (const [key, bucket] of grouped) {
    const meta = SERIES_BY_TABLE_LINE.get(key)
    if (!meta) continue

    const sorted = [...bucket].sort((left, right) =>
      String(left.TimePeriod ?? '').localeCompare(String(right.TimePeriod ?? ''))
    )
    const latest = sorted.at(-1)
    const previous = sorted.at(-2)
    if (!latest) continue

    const actual = Number(latest.DataValue)
    if (!Number.isFinite(actual)) {
      throw new Error(`bea-economic-series: missing numeric value for ${meta.key}`)
    }

    const previousValue = previous ? Number(previous.DataValue) : undefined
    const delta = previousValue !== undefined ? actual - previousValue : undefined
    const period = String(latest.TimePeriod ?? 'unknown')
    const releaseTime = beaPeriodToReleaseTime(period, meta.frequency)

    drafts.push({
      sourceId: config.sourceId,
      metricKey: meta.key,
      metricName: meta.metricName,
      metricKind: meta.metricKind,
      actual: roundMetric(actual),
      previous: previousValue !== undefined && Number.isFinite(previousValue) ? roundMetric(previousValue) : undefined,
      unit: latest.CL_UNIT?.toLowerCase().includes('percent') ? 'percent' : meta.unit ?? 'percent',
      period,
      releaseTime,
      comparisonBasis: meta.comparisonBasis,
      surpriseDirection:
        delta === undefined ? 'unknown' : delta > 0.05 ? 'above' : delta < -0.05 ? 'below' : 'inline',
      surpriseMagnitude: delta !== undefined ? Math.abs(delta) : undefined,
      rawValueJson: JSON.stringify({
        table: latest.TableName,
        lineNumber: latest.LineNumber,
        timePeriod: period,
        metricDesc: latest.METRIC_DESC
      })
    })
  }

  if (!drafts.length) {
    throw new Error('bea-economic-series: no supported metric rows found')
  }

  return drafts
}

function beaPeriodToReleaseTime(period: string, frequency: 'monthly' | 'quarterly' | 'daily' | 'weekly'): string {
  if (frequency === 'quarterly') {
    const match = /^(\d{4})Q([1-4])$/.exec(period)
    if (!match) return `${period}T00:00:00.000Z`
    const year = Number(match[1])
    const quarter = Number(match[2])
    const month = quarter * 3
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T00:00:00.000Z`
  }

  const monthly = /^(\d{4})M(\d{2})$/.exec(period) ?? /^(\d{4})-(\d{2})$/.exec(period)
  if (monthly) {
    const year = Number(monthly[1])
    const month = Number(monthly[2])
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T00:00:00.000Z`
  }

  return `${period}T00:00:00.000Z`
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000
}
