import { isMacroSourceId } from '../application/macroSourceCatalogMetadata'
import type { IntelligenceSourceConfig } from '../schema/intelligenceSource'

import { resolveMacroMetricFetchTargets, type MetricFetchTarget } from './resolveMacroMetricFetchTargets'

export type { MetricFetchTarget }

export function resolveMetricFetchTargets(config: IntelligenceSourceConfig): MetricFetchTarget[] {
  if (isMacroSourceId(config.sourceId)) {
    return resolveMacroMetricFetchTargets(config)
  }

  const endpointUrl = String(config.adapterConfig.endpointUrl ?? '').trim()
  if (!endpointUrl) return []

  const symbolParam = String(config.adapterConfig.symbolParam ?? '').trim()
  const symbols = normalizeSymbols(config.adapterConfig.symbols)
  const fallbackSymbol = String(config.adapterConfig.symbol ?? '').trim().toUpperCase()

  if (symbolParam && symbols.length > 0) {
    const baseUrl = endpointUrl.split('?')[0]!
    const staticParams = readStaticQueryParams(endpointUrl)
    return symbols.map((symbol) => ({
      symbol,
      url: buildSymbolUrl(baseUrl, symbolParam, symbol, staticParams, config.adapterConfig)
    }))
  }

  if (endpointUrl) {
    return [{ url: endpointUrl, symbol: fallbackSymbol || undefined }]
  }

  return []
}

function normalizeSymbols(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((entry) => String(entry).trim().toUpperCase()).filter(Boolean))].slice(0, 20)
}

function readStaticQueryParams(endpointUrl: string): URLSearchParams {
  const queryIndex = endpointUrl.indexOf('?')
  if (queryIndex < 0) return new URLSearchParams()
  return new URLSearchParams(endpointUrl.slice(queryIndex + 1))
}

function buildSymbolUrl(
  baseUrl: string,
  symbolParam: string,
  symbol: string,
  staticParams: URLSearchParams,
  adapterConfig: Record<string, unknown>
): string {
  const params = new URLSearchParams(staticParams)
  params.set(symbolParam, symbol)
  if (adapterConfig.limit !== undefined && !params.has('limit')) {
    params.set('limit', String(adapterConfig.limit))
  }
  const query = params.toString()
  return query ? `${baseUrl}?${query}` : baseUrl
}
