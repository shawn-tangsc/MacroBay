import { hashPayload } from '@platform/jobs'

import { normalizeEventType } from '../application/eventTypeNormalizer'
import { isMacroSourceId } from '../application/macroSourceCatalogMetadata'
import { normalizePublishedAt } from '../application/publishedAtNormalizer'
import { resolveMetricFetchTargets, type MetricFetchTarget } from './resolveMetricFetchTargets'
import type { MetricIntelligenceEventDraft } from '../schema/intelligenceMetricEvent'
import type { IntelligenceSourceConfig } from '../schema/intelligenceSource'
import { parseAlternativeFearGreedPayload } from './metricParsers/alternativeFearGreedParser'
import { parseBinanceFundingRatePayload } from './metricParsers/binanceFuturesPositioningParser'
import { parseBinanceSpotMarketPayload } from './metricParsers/binanceSpotMarketParser'
import { parseBeaEconomicSeriesPayload } from './metricParsers/beaEconomicSeriesParser'
import { parseBlsEconomicSeriesPayload } from './metricParsers/blsEconomicSeriesParser'
import { parseCoingeckoGlobalPayload } from './metricParsers/coingeckoMarketParser'
import { parseDefillamaTvlPayload } from './metricParsers/defillamaParser'
import { parseFredRatesLiquidityPayload } from './metricParsers/fredRatesLiquidityParser'
import { parseTreasuryFiscalDataPayload } from './metricParsers/treasuryFiscalDataParser'
import type { AppendRawRecordInput } from '../schema/intelligenceRecord'
import type { IntelligenceSourceAdapter, NormalizedIntelligenceItemDraft, ParsedIntelligenceRecord } from './sourceAdapter'

const PARSER_VERSION = 'metric-rest-api-v1'

export const METRIC_SOURCE_IDS = [
  'alternative-fear-greed',
  'coingecko-market',
  'defillama-tvl',
  'binance-spot-market',
  'binance-futures-positioning',
  'bls-economic-series',
  'bea-economic-series',
  'fred-rates-liquidity',
  'treasury-fiscal-data'
] as const

export const metricRestApiAdapter: IntelligenceSourceAdapter = {
  adapterType: 'rest-api-poller',
  parserVersion: PARSER_VERSION,
  supportedSourceIds: [...METRIC_SOURCE_IDS],
  async collect({ config, runId, fetchText, fetchMetricTarget }) {
    const targets = resolveMetricFetchTargets(config)
    if (!targets.length || (!fetchText && !fetchMetricTarget)) return []

    const records: AppendRawRecordInput[] = []
    for (const target of targets) {
      const body = await fetchMetricTargetBody(target, config.sourceId, fetchText, fetchMetricTarget)
      const payloadHash = hashPayload(body)
      const dedupeSuffix = target.metricKey ?? target.symbol ?? target.seriesId ?? 'single'
      records.push({
        sourceId: config.sourceId,
        runId,
        payloadFormat: 'json' as const,
        payloadRefType: 'inline' as const,
        payloadBody: body,
        payloadHash,
        sourceDedupeKey: `metric-fetch:${config.sourceId}:${dedupeSuffix}:${payloadHash.slice(0, 16)}`,
        parserVersion: PARSER_VERSION,
        payloadMetaJson: JSON.stringify({
          metricKey: target.metricKey,
          seriesId: target.seriesId,
          symbol: target.symbol
        })
      })
    }
    return records
  },
  parseRawRecord({ config, rawRecord }) {
    const payload = JSON.parse(rawRecord.payloadBody ?? '{}')
    const payloadMeta = parsePayloadMeta(rawRecord.payloadMetaJson)
    const metricEvents = parseMetricDrafts(config.sourceId, payload, config, payloadMeta)
    const primary = metricEvents[0]
    if (!primary) {
      throw new Error(`Metric parser returned no observations for ${config.sourceId}.`)
    }

    const bodyText = `${primary.metricName}: ${primary.actual}`
    return {
      title: primary.metricName,
      summary: `${primary.metricKey} ${primary.actual}${primary.unit ? ` ${primary.unit}` : ''}`,
      bodyText,
      bodyHash: hashPayload(bodyText),
      eventType: 'macro',
      severityHint: 'info',
      metricEvents,
      sourceMeta: { metricKey: primary.metricKey }
    }
  },
  normalizeParsedItem({ config, parsed, detectedAt }) {
    return normalizeMetricDrafts({ config, parsed, detectedAt })[0]!
  },
  normalizeParsedItems({ config, parsed, detectedAt }) {
    return normalizeMetricDrafts({ config, parsed, detectedAt })
  }
}

function parseMetricDrafts(
  sourceId: string,
  payload: unknown,
  config: IntelligenceSourceConfig,
  payloadMeta?: { metricKey?: string; seriesId?: string }
): MetricIntelligenceEventDraft[] {
  switch (sourceId) {
    case 'alternative-fear-greed':
      return parseAlternativeFearGreedPayload(payload, config)
    case 'coingecko-market':
      return parseCoingeckoGlobalPayload(payload, config)
    case 'defillama-tvl':
      return parseDefillamaTvlPayload(payload, config)
    case 'binance-spot-market':
      return parseBinanceSpotMarketPayload(payload, config)
    case 'binance-futures-positioning':
      return parseMetricPositioningPayload(payload, config)
    case 'bls-economic-series':
      return parseBlsEconomicSeriesPayload(payload, config)
    case 'bea-economic-series':
      return parseBeaEconomicSeriesPayload(payload, config)
    case 'fred-rates-liquidity':
      return parseFredRatesLiquidityPayload(payload, config, payloadMeta?.seriesId)
    case 'treasury-fiscal-data':
      return parseTreasuryFiscalDataPayload(payload, config, payloadMeta?.metricKey)
    default:
      throw new Error(`Metric parser not implemented for ${sourceId}.`)
  }
}

async function fetchMetricTargetBody(
  target: MetricFetchTarget,
  sourceId: string,
  fetchText?: (url: string) => Promise<string>,
  fetchMetricTarget?: (target: MetricFetchTarget, sourceId: string) => Promise<string>
): Promise<string> {
  if ((target.method && target.method !== 'GET') || target.body) {
    if (!fetchMetricTarget) {
      throw new Error(`Metric target for ${sourceId} requires fetchMetricTarget support.`)
    }
    return fetchMetricTarget(target, sourceId)
  }
  if (!fetchText) {
    throw new Error(`Metric target for ${sourceId} requires fetchText support.`)
  }
  return fetchText(target.url)
}

function parsePayloadMeta(payloadMetaJson?: string): { metricKey?: string; seriesId?: string } | undefined {
  if (!payloadMetaJson) return undefined
  try {
    return JSON.parse(payloadMetaJson) as { metricKey?: string; seriesId?: string }
  } catch {
    return undefined
  }
}

/**
 * Only funding rates travel this path.
 *
 * Open interest used to be parsed here from `/fapi/v1/openInterest` — a single point in
 * contracts with no consumer. It is replaced by the 15-minute notional history that
 * `open-interest` collects as its own time series, so this branch is now explicit about
 * what it refuses: an `adapterConfig.metricType` naming anything else fails loudly here
 * instead of being silently parsed as funding.
 */
function parseMetricPositioningPayload(payload: unknown, config: IntelligenceSourceConfig) {
  const metricType = String(config.adapterConfig.metricType ?? 'funding-rate')
  if (metricType !== 'funding-rate') {
    throw new Error(`binance-futures-positioning: unsupported metric type ${metricType}`)
  }
  return parseBinanceFundingRatePayload(payload, config)
}

function normalizeMetricDrafts(input: {
  config: IntelligenceSourceConfig
  parsed: ParsedIntelligenceRecord
  detectedAt: string
}): NormalizedIntelligenceItemDraft[] {
  const metricEvents = input.parsed.metricEvents ?? []
  const layer = input.config.category === 'macro' ? 'macro' : input.config.category === 'exchange-announcement' ? 'asset' : 'industry'
  const dataDomain = layer === 'macro' ? 'macro' : layer === 'asset' ? 'asset-market' : 'crypto-market'

  return metricEvents.map((metric) => {
    const periodKey = metric.period ?? metric.releaseTime
    const dedupeKey = `metric:${input.config.sourceId}:${metric.metricKey}:${periodKey}`
    const symbols = extractSymbolsFromMetric(metric)
    const eventType = normalizeEventType({
      eventType: metric.metricKind,
      sourceCategory: input.config.category,
      clusterType: layer === 'macro' ? 'macro-event' : 'news-event'
    })

    return {
      canonicalDedupeKey: dedupeKey,
      title: metric.metricName,
      summary: `${metric.metricKey}: ${metric.actual}${metric.unit ? ` ${metric.unit}` : ''}`,
      publishedAt: normalizePublishedAt(metric.releaseTime) ?? metric.releaseTime,
      detectedAt: input.detectedAt,
      symbols,
      eventType,
      severityHint: 'info',
      clusterKey: dedupeKey,
      clusterType: layer === 'macro' ? 'macro-event' : 'news-event',
      intelligenceLayer: layer,
      dataDomain,
      eventFamily: 'metric-event',
      eventSubtype: metric.metricKind,
      metricEventJson: JSON.stringify(metric)
    }
  })
}

function extractSymbolsFromMetric(metric: MetricIntelligenceEventDraft): string[] | undefined {
  const match = metric.metricKey.match(/^([A-Z0-9]+)_/)
  if (!match?.[1]) return undefined
  const symbol = match[1].replace(/USDT$|USDC$|BUSD$/, '')
  return symbol ? [symbol] : undefined
}

export function buildMetricDedupeKey(sourceId: string, metricKey: string, periodOrRelease: string): string {
  return `metric:${sourceId}:${metricKey}:${periodOrRelease}`
}
