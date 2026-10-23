import type { IntelligenceImpactDraft } from '../../schema/intelligenceImpact'
import type { MetricIntelligenceEvent } from '../../schema/intelligenceMetricEvent'
import { extractBaseAsset } from '../../adapters/metricParsers/binanceSpotMarketParser'
import { parseProcessingLabels } from '../intelligenceItemLabels'
import { buildEvidence } from './impactRuleHelpers'
import type { ImpactRuleInput, ImpactRuleResult } from './impactRuleTypes'

export function evaluateMarketStructureRules(input: ImpactRuleInput): ImpactRuleResult[] {
  if (!input.metricEvent) return []

  const labels = parseProcessingLabels(input.item.processingLabelsJson)
  if (labels.relevanceOutcome === 'context-only' && labels.sentimentEligible === false) {
    return []
  }

  const metric = input.metricEvent
  const layer = input.sourceDefinition.intelligenceLayer ?? 'industry'

  if (metric.metricKey === 'CHAIN_TVL_TOTAL') {
    return tvlImpacts(metric, layer, labels)
  }

  if (metric.metricKind === 'fear-greed') {
    return fearGreedImpacts(metric, layer)
  }

  if (metric.metricKind === 'funding-rate') {
    return fundingImpacts(input, metric, layer, labels)
  }

  if (metric.metricKind === 'spot-market') {
    return spotImpacts(input, metric, layer, labels)
  }

  return []
}

function tvlImpacts(
  metric: MetricIntelligenceEvent,
  layer: IntelligenceImpactDraft['layer'],
  labels: ReturnType<typeof parseProcessingLabels>
): ImpactRuleResult[] {
  if (labels.relevanceOutcome === 'context-only') return []
  if (metric.surpriseDirection === 'up' || (metric.previous !== undefined && metric.actual > metric.previous)) {
    return [
      cryptoMarketImpact(metric, layer, 'bullish', 'industry.defi.tvl.growth.v1', 65, 'DeFi usage growth supports crypto-market sentiment.'),
      sectorImpact(metric, layer, 'bullish', 'industry.defi.tvl.growth.v1', 60, 'DeFi sector activity is expanding.')
    ]
  }
  if (metric.surpriseDirection === 'down' || (metric.previous !== undefined && metric.actual < metric.previous)) {
    return [
      cryptoMarketImpact(metric, layer, 'bearish', 'industry.defi.tvl.drawdown.v1', 65, 'DeFi activity drawdown weighs on crypto-market sentiment.'),
      sectorImpact(metric, layer, 'bearish', 'industry.defi.tvl.drawdown.v1', 60, 'DeFi sector activity is contracting.')
    ]
  }
  return []
}

function fearGreedImpacts(metric: MetricIntelligenceEvent, layer: IntelligenceImpactDraft['layer']): ImpactRuleResult[] {
  if (metric.actual <= 24) {
    return [cryptoMarketImpact(metric, layer, 'mixed', 'industry.fear.extreme.v1', 60, 'Extreme fear can signal capitulation but does not auto-flip bullish.')]
  }
  if (metric.actual >= 75) {
    return [cryptoMarketImpact(metric, layer, 'mixed', 'industry.greed.extreme.v1', 55, 'Extreme greed raises crowding and mean-reversion risk.')]
  }
  return []
}

function fundingImpacts(
  input: ImpactRuleInput,
  metric: MetricIntelligenceEvent,
  layer: IntelligenceImpactDraft['layer'],
  labels: ReturnType<typeof parseProcessingLabels>
): ImpactRuleResult[] {
  if (labels.relevanceOutcome === 'context-only') return []
  const symbol = resolveSymbol(metric, input.item.symbolsJson)
  if (metric.actual >= 0.05) {
    return [symbolImpact(metric, layer, symbol, 'mixed', 'micro.funding.crowded-long.v1', 65, 'High positive funding indicates crowded long positioning.', ['contrarian-metric'])]
  }
  if (metric.actual <= -0.02) {
    return [symbolImpact(metric, layer, symbol, 'mixed', 'micro.funding.short-crowded.v1', 60, 'Negative funding can indicate short crowding with stabilization potential.', ['contrarian-metric'])]
  }
  return []
}

function spotImpacts(
  input: ImpactRuleInput,
  metric: MetricIntelligenceEvent,
  layer: IntelligenceImpactDraft['layer'],
  labels: ReturnType<typeof parseProcessingLabels>
): ImpactRuleResult[] {
  if (labels.relevanceOutcome === 'context-only') return []
  const symbol = resolveSymbol(metric, input.item.symbolsJson)
  if (metric.actual > 2) {
    return [symbolImpact(metric, layer, symbol, 'bullish', 'micro.oi.rising-momentum.v1', 60, 'Strong 24h price momentum with volume supports micro bullish bias.')]
  }
  if (metric.actual < -2) {
    return [symbolImpact(metric, layer, symbol, 'bearish', 'micro.spot.weakness.v1', 60, 'Weak 24h price action signals micro bearish momentum.')]
  }
  return []
}

function cryptoMarketImpact(
  metric: MetricIntelligenceEvent,
  layer: IntelligenceImpactDraft['layer'],
  direction: IntelligenceImpactDraft['direction'],
  ruleId: string,
  confidence: number,
  reasoning: string
): ImpactRuleResult {
  return {
    layer,
    scopeType: 'crypto-market',
    scopeKey: 'global',
    direction,
    magnitude: direction === 'mixed' ? 2 : 3,
    confidence,
    horizon: '1d',
    reasoning,
    evidenceJson: buildEvidence(metric),
    ruleId,
    ruleVersion: 'v1'
  }
}

function sectorImpact(
  metric: MetricIntelligenceEvent,
  layer: IntelligenceImpactDraft['layer'],
  direction: IntelligenceImpactDraft['direction'],
  ruleId: string,
  confidence: number,
  reasoning: string
): ImpactRuleResult {
  return {
    layer,
    scopeType: 'sector',
    scopeKey: 'defi',
    direction,
    magnitude: 3,
    confidence,
    horizon: '1d',
    reasoning,
    evidenceJson: buildEvidence(metric),
    ruleId,
    ruleVersion: 'v1'
  }
}

function symbolImpact(
  metric: MetricIntelligenceEvent,
  layer: IntelligenceImpactDraft['layer'],
  symbol: string,
  direction: IntelligenceImpactDraft['direction'],
  ruleId: string,
  confidence: number,
  reasoning: string,
  caveats: string[] = []
): ImpactRuleResult {
  const evidence = buildEvidence(metric, caveats.map((caveat) => ({ label: 'caveat', value: caveat })))
  return {
    layer,
    scopeType: 'symbol',
    scopeKey: symbol,
    direction,
    magnitude: direction === 'mixed' ? 2 : 3,
    confidence,
    horizon: '1d',
    reasoning,
    evidenceJson: evidence,
    ruleId,
    ruleVersion: 'v1'
  }
}

function resolveSymbol(metric: MetricIntelligenceEvent, symbolsJson?: string): string {
  const fromJson = parseSymbols(symbolsJson)[0]
  if (fromJson) return fromJson
  const match = metric.metricKey.match(/^([A-Z0-9]+)_/)
  if (match?.[1]) return extractBaseAsset(match[1])
  return 'UNKNOWN'
}

function parseSymbols(symbolsJson?: string): string[] {
  if (!symbolsJson) return []
  try {
    const parsed = JSON.parse(symbolsJson) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
