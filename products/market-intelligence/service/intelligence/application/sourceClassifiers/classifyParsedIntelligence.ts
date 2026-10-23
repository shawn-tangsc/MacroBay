import type { NormalizedIntelligenceItemDraft } from '../../adapters/sourceAdapter'
import type { ParsedIntelligenceRecord } from '../../adapters/sourceAdapter'
import type { MetricIntelligenceEventDraft } from '../../schema/intelligenceMetricEvent'
import { classifyExchangeAnnouncement } from './exchangeAnnouncementClassifier'
import { classifyFedText } from './fedTextClassifier'
import { classifyMarketStructureMetric } from './marketStructureMetricClassifier'
import { classifyRegulatorRelevance } from './regulatorRelevanceClassifier'
import { classifyStatusIncident } from './statusIncidentClassifier'
import type { ClassifiedSourceEvent, SourceClassifierInput } from './sourceClassifierTypes'

export const SOURCE_CLASSIFIER_VERSION = 'p0-core-v1'

export function classifyParsedIntelligence(input: {
  sourceId: string
  draft: NormalizedIntelligenceItemDraft
  parsed: ParsedIntelligenceRecord
}): ClassifiedSourceEvent {
  const classifierInput = buildClassifierInput(input)
  return dispatchClassifier(input.sourceId, classifierInput)
}

function buildClassifierInput(input: {
  sourceId: string
  draft: NormalizedIntelligenceItemDraft
  parsed: ParsedIntelligenceRecord
}): SourceClassifierInput {
  const metricDraft = parseMetricDraft(input.draft.metricEventJson)
  const incidentStatus = readIncidentStatus(input.parsed)

  return {
    sourceId: input.sourceId,
    title: input.draft.title,
    summary: input.draft.summary,
    bodyText: input.parsed.bodyText,
    eventType: input.draft.eventType,
    metricKey: metricDraft?.metricKey,
    metricKind: metricDraft?.metricKind,
    metricActual: metricDraft?.actual,
    metricPrevious: metricDraft?.previous,
    comparisonBasis: metricDraft?.comparisonBasis,
    incidentStatus,
    venue: resolveVenue(input.sourceId),
    symbols: input.draft.symbols
  }
}

function dispatchClassifier(sourceId: string, classifierInput: SourceClassifierInput): ClassifiedSourceEvent {
  if (sourceId === 'federal-reserve-rss') {
    return classifyFedText(classifierInput)
  }
  if (sourceId === 'sec-rss' || sourceId === 'cftc-rss') {
    return classifyRegulatorRelevance(classifierInput)
  }
  if (
    sourceId === 'binance-announcements' ||
    sourceId === 'binance-api-updates' ||
    sourceId.startsWith('okx-')
  ) {
    return classifyExchangeAnnouncement(classifierInput)
  }
  if (
    sourceId === 'coinbase-status' ||
    sourceId === 'kraken-status' ||
    sourceId === 'kraken-system-status' ||
    sourceId === 'solana-status'
  ) {
    return classifyStatusIncident(classifierInput)
  }
  if (
    sourceId === 'alternative-fear-greed' ||
    sourceId === 'coingecko-market' ||
    sourceId === 'defillama-tvl' ||
    sourceId === 'binance-spot-market' ||
    sourceId === 'binance-futures-positioning'
  ) {
    return classifyMarketStructureMetric({
      ...classifierInput,
      symbols: classifierInput.symbols ?? extractMetricSymbols(classifierInput)
    })
  }

  return {
    outcome: 'full-intelligence',
    eventSubtype: 'generic-source',
    confidence: 50,
    affectedScopes: [{ type: 'crypto-market', id: 'global' }],
    sentimentEligible: true,
    caveats: ['generic-source-parser']
  }
}

export function enrichDraftWithClassification(
  draft: NormalizedIntelligenceItemDraft,
  classification: ClassifiedSourceEvent
): NormalizedIntelligenceItemDraft {
  return {
    ...draft,
    eventSubtype: classification.eventSubtype,
    entities: classification.entities ?? draft.entities,
    symbols: classification.symbols ?? draft.symbols,
    severityHint:
      classification.outcome === 'context-only' ? 'info' : draft.severityHint,
    impactHintJson: classification.impactHint ? JSON.stringify(classification.impactHint) : draft.impactHintJson
  }
}

function parseMetricDraft(metricEventJson?: string): MetricIntelligenceEventDraft | undefined {
  if (!metricEventJson?.trim()) return undefined
  try {
    return JSON.parse(metricEventJson) as MetricIntelligenceEventDraft
  } catch {
    return undefined
  }
}

function readIncidentStatus(parsed: ParsedIntelligenceRecord): string | undefined {
  const meta = parsed.sourceMeta as { incidentStatus?: string } | undefined
  return meta?.incidentStatus
}

function resolveVenue(sourceId: string): string | undefined {
  if (sourceId.includes('coinbase')) return 'coinbase'
  if (sourceId.includes('kraken')) return 'kraken'
  if (sourceId.includes('binance')) return 'binance'
  if (sourceId.includes('okx')) return 'okx'
  return undefined
}

function extractMetricSymbols(input: SourceClassifierInput): string[] | undefined {
  if (!input.metricKey) return undefined
  const match = input.metricKey.match(/^([A-Z0-9]+)_/)
  if (!match?.[1]) return undefined
  const symbol = match[1].replace(/USDT$/, '')
  return symbol ? [symbol] : undefined
}
