import { TREASURY_MACRO_ENDPOINTS } from '../../application/macroSourceCatalogMetadata'
import type { MetricIntelligenceEventDraft } from '../../schema/intelligenceMetricEvent'
import type { IntelligenceSourceConfig } from '../../schema/intelligenceSource'

type TreasuryRow = Record<string, string | number | null | undefined>

type TreasuryPayload = {
  data?: TreasuryRow[]
  meta?: { count?: number }
}

const ENDPOINT_BY_KEY = new Map(TREASURY_MACRO_ENDPOINTS.map((row) => [row.key, row]))

export function parseTreasuryFiscalDataPayload(
  payload: unknown,
  config: IntelligenceSourceConfig,
  metricKey?: string
): MetricIntelligenceEventDraft[] {
  const body = payload as TreasuryPayload
  const rows = (body.data ?? []).filter((row) => row && typeof row === 'object')
  if (!rows.length) {
    throw new Error('treasury-fiscal-data: empty filtered result set')
  }

  const endpointMeta = metricKey ? ENDPOINT_BY_KEY.get(metricKey) : undefined
  const valueField = endpointMeta?.valueField ?? inferValueField(rows[0] ?? {})
  const sorted = [...rows].sort((left, right) =>
    String(left.record_date ?? '').localeCompare(String(right.record_date ?? ''))
  )
  const latest = sorted.at(-1)
  const previous = sorted.at(-2)
  if (!latest) {
    throw new Error('treasury-fiscal-data: no relevant rows after filtering')
  }

  const actual = normalizeTreasuryAmount(latest[valueField])
  const previousValue = previous ? normalizeTreasuryAmount(previous[valueField]) : undefined
  if (!Number.isFinite(actual)) {
    throw new Error(`treasury-fiscal-data: missing numeric value in ${valueField}`)
  }

  const delta = previousValue !== undefined ? actual - previousValue : undefined
  const meta =
    endpointMeta ??
    ({
      key: metricKey ?? 'US_TGA_BALANCE',
      metricName: 'Treasury Fiscal Metric',
      metricKind: 'liquidity',
      comparisonBasis: 'period-change',
      frequency: 'daily',
      unit: 'millions-usd'
    } as const)

  return [
    {
      sourceId: config.sourceId,
      metricKey: meta.key,
      metricName: meta.metricName,
      metricKind: meta.metricKind,
      actual: roundMetric(actual),
      previous: previousValue !== undefined ? roundMetric(previousValue) : undefined,
      unit: meta.unit,
      period: String(latest.record_date ?? 'unknown'),
      releaseTime: `${latest.record_date ?? '1970-01-01'}T00:00:00.000Z`,
      comparisonBasis: meta.comparisonBasis,
      surpriseDirection:
        delta === undefined ? 'unknown' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'inline',
      surpriseMagnitude: delta !== undefined ? Math.abs(delta) : undefined,
      rawValueJson: JSON.stringify({
        metricKey: meta.key,
        recordDate: latest.record_date,
        accountType: latest.account_type,
        transactionType: latest.transaction_type,
        unit: 'millions-usd',
        proxy: true
      })
    }
  ]
}

function inferValueField(row: TreasuryRow): string {
  if ('close_today_bal' in row) return 'close_today_bal'
  if ('transaction_today_amt' in row) return 'transaction_today_amt'
  return 'value'
}

function normalizeTreasuryAmount(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : Number.NaN
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000
}
