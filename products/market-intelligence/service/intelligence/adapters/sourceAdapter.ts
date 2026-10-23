import type { AppendRawRecordInput } from '../schema/intelligenceRecord'
import type { IntelligenceSourceConfig } from '../schema/intelligenceSource'

import type { MetricIntelligenceEventDraft } from '../schema/intelligenceMetricEvent'
import type { IntelligenceLayer, IntelligenceDataDomain, IntelligenceEventFamily } from '../schema/intelligenceLayer'

export type ParsedIntelligenceRecord = {
  externalId?: string
  sourceUrl?: string
  publishedAtRaw?: string
  publishedAt?: string
  title: string
  summary?: string
  bodyText: string
  bodyHash: string
  entities?: string[]
  symbols?: string[]
  vendorIncidentId?: string
  eventType: string
  severityHint?: 'info' | 'warning' | 'critical'
  metricEvents?: MetricIntelligenceEventDraft[]
  sourceMeta?: Record<string, unknown>
}

export type NormalizedIntelligenceItemDraft = {
  canonicalDedupeKey: string
  title: string
  summary?: string
  url?: string
  publishedAt?: string
  detectedAt: string
  entities?: string[]
  symbols?: string[]
  eventType: string
  severityHint?: 'info' | 'warning' | 'critical'
  clusterKey: string
  clusterType: 'announcement' | 'incident' | 'macro-event' | 'regulatory-event' | 'news-event'
  intelligenceLayer?: IntelligenceLayer
  dataDomain?: IntelligenceDataDomain
  eventFamily?: IntelligenceEventFamily
  eventSubtype?: string
  metricEventJson?: string
  impactHintJson?: string
}

export type IntelligenceAdapterError = {
  code: string
  message: string
  retryable?: boolean
}

export type IntelligenceSourceAdapter = {
  adapterType: IntelligenceSourceConfig['adapterType']
  parserVersion: string
  supportedSourceIds: string[]
  collect: (input: {
    config: IntelligenceSourceConfig
    runId: string
    fetchText?: (url: string) => Promise<string>
    fetchMetricTarget?: (target: import('./resolveMetricFetchTargets').MetricFetchTarget, sourceId: string) => Promise<string>
  }) => Promise<AppendRawRecordInput[]>
  parseRawRecord: (input: {
    config: IntelligenceSourceConfig
    rawRecord: AppendRawRecordInput & { rawRecordId?: string }
  }) => ParsedIntelligenceRecord
  normalizeParsedItem: (input: {
    config: IntelligenceSourceConfig
    parsed: ParsedIntelligenceRecord
    rawRecordId: string
    detectedAt: string
  }) => NormalizedIntelligenceItemDraft
  normalizeParsedItems?: (input: {
    config: IntelligenceSourceConfig
    parsed: ParsedIntelligenceRecord
    rawRecordId: string
    detectedAt: string
  }) => NormalizedIntelligenceItemDraft[]
}

export function createAdapterError(code: string, message: string, retryable = false): IntelligenceAdapterError {
  return { code, message, retryable }
}
