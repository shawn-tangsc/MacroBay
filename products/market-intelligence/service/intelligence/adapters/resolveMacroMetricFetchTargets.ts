import type { IntelligenceSourceConfig } from '../schema/intelligenceSource'
import {
  isMacroSourceId,
  macroAdapterConfigForSource,
  type MacroSeriesDefinition,
  type MacroSourceId,
  type MacroTreasuryEndpointDefinition
} from '../application/macroSourceCatalogMetadata'

export type MetricFetchTarget = {
  url: string
  symbol?: string
  metricKey?: string
  seriesId?: string
  method?: 'GET' | 'POST'
  body?: string
  headers?: Record<string, string>
}

export function resolveMacroMetricFetchTargets(config: IntelligenceSourceConfig): MetricFetchTarget[] {
  if (!isMacroSourceId(config.sourceId)) return []

  const macroConfig = readMacroAdapterConfig(config.sourceId, config.adapterConfig)
  switch (macroConfig.requestMode) {
    case 'bls-series':
      return [buildBlsFetchTarget(macroConfig.series ?? [], macroConfig)]
    case 'bea-dataset':
      return (macroConfig.series ?? []).map((series) => buildBeaFetchTarget(series, macroConfig))
    case 'fred-series':
      return (macroConfig.series ?? []).map((series) => buildFredFetchTarget(series, macroConfig))
    case 'treasury-filtered':
      return (macroConfig.treasuryEndpoints ?? []).map((endpoint) => buildTreasuryFetchTarget(endpoint, macroConfig))
    default:
      return []
  }
}

/** First probe target for connection tests — credential query params applied later. */
export function resolveMacroProbeTarget(config: IntelligenceSourceConfig): MetricFetchTarget | undefined {
  const targets = resolveMacroMetricFetchTargets(config)
  return targets[0]
}

function buildBlsFetchTarget(series: MacroSeriesDefinition[], macroConfig: ReturnType<typeof readMacroAdapterConfig>): MetricFetchTarget {
  const seriesIds = series.map((row) => row.providerSeriesId).filter(Boolean) as string[]
  const defaults = macroConfig.requestDefaults ?? {}
  const body = JSON.stringify({
    seriesid: seriesIds,
    startyear: String(defaults.startyear ?? '2018'),
    endyear: String(defaults.endyear ?? '2026'),
    latest: defaults.latest ?? true
  })

  return {
    url: macroConfig.endpointUrl,
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
    metricKey: 'bls-batch',
    seriesId: seriesIds.join(',')
  }
}

function buildBeaFetchTarget(
  series: MacroSeriesDefinition,
  macroConfig: ReturnType<typeof readMacroAdapterConfig>
): MetricFetchTarget {
  const defaults = macroConfig.requestDefaults ?? {}
  const params = new URLSearchParams()
  params.set('method', String(defaults.method ?? 'GetData'))
  params.set('datasetname', String(series.dataset ?? 'NIPA'))
  params.set('TableName', String(series.table ?? ''))
  params.set('LineNumber', String(series.lineCode ?? ''))
  params.set('Frequency', series.frequency === 'quarterly' ? 'Q' : 'M')
  params.set('Year', String(defaults.Year ?? 'ALL'))

  const base = macroConfig.endpointUrl.replace(/\/$/, '')
  return {
    url: `${base}/?${params.toString()}`,
    metricKey: series.key,
    seriesId: `${series.table}:${series.lineCode}`
  }
}

function buildFredFetchTarget(
  series: MacroSeriesDefinition,
  macroConfig: ReturnType<typeof readMacroAdapterConfig>
): MetricFetchTarget {
  const defaults = macroConfig.requestDefaults ?? {}
  const params = new URLSearchParams()
  params.set('series_id', String(series.providerSeriesId ?? ''))
  params.set('file_type', String(defaults.file_type ?? 'json'))
  params.set('sort_order', String(defaults.sort_order ?? 'desc'))
  params.set('limit', String(defaults.limit ?? 5))

  const base = macroConfig.endpointUrl.split('?')[0]!
  return {
    url: `${base}?${params.toString()}`,
    metricKey: series.key,
    seriesId: series.providerSeriesId
  }
}

function buildTreasuryFetchTarget(
  endpoint: MacroTreasuryEndpointDefinition,
  macroConfig: ReturnType<typeof readMacroAdapterConfig>
): MetricFetchTarget {
  const params = new URLSearchParams()
  params.set('fields', endpoint.fields.join(','))
  params.set('sort', endpoint.sort)
  params.set('page[size]', String(endpoint.pageSize))
  for (const filter of endpoint.filters) {
    params.append('filter', filter)
  }

  const base = macroConfig.endpointUrl.replace(/\/$/, '')
  return {
    url: `${base}/${endpoint.path}?${params.toString()}`,
    metricKey: endpoint.key,
    seriesId: endpoint.path
  }
}

function readMacroAdapterConfig(sourceId: MacroSourceId, adapterConfig: Record<string, unknown>) {
  const defaults = macroAdapterConfigForSource(sourceId)
  const runtime = adapterConfig as Partial<ReturnType<typeof macroAdapterConfigForSource>>
  return {
    ...defaults,
    ...runtime,
    series: (runtime.series as MacroSeriesDefinition[] | undefined) ?? defaults.series,
    treasuryEndpoints:
      (runtime.treasuryEndpoints as MacroTreasuryEndpointDefinition[] | undefined) ?? defaults.treasuryEndpoints,
    requestDefaults: {
      ...defaults.requestDefaults,
      ...(runtime.requestDefaults ?? {})
    }
  }
}
