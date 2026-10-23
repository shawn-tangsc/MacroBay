export type RawPayloadFormat = 'json' | 'html' | 'rss-item' | 'text'

export type RawPayloadRefType = 'inline' | 'file' | 'compressed-file'

export type RawProcessingState =
  | 'received'
  | 'parsed'
  | 'normalized'
  | 'ignored'
  | 'failed'
  | 'dead-letter'

export type IntelligenceIgnoredReasonCode =
  | 'focus-market-disabled'
  | 'scope-not-matched'
  | 'classification-confidence-low'
  | 'duplicate-known-item'
  | 'noise-policy-filtered'
  | 'payload-too-large'
  | 'parser-unsupported-shape'
  | 'source-not-implemented'

export type IgnoredRawRecordAudit = {
  ignoredReasonCode: IntelligenceIgnoredReasonCode
  classifierVersion: string
  classifierNotes?: string
}

export type RawStorageTier = 'hot' | 'warm' | 'cold'

export type RawArchiveStatus = 'none' | 'queued' | 'archived' | 'failed'

export type RawProcessingOwner = 'generic-intelligence' | 'macro-calendar'

export type RawIntelligenceRecord = {
  rawRecordId: string
  sourceId: string
  runId: string
  externalId?: string
  sourceUrl?: string
  publishedAtRaw?: string
  publishedAt?: string
  detectedAt: string
  payloadFormat: RawPayloadFormat
  payloadRefType: RawPayloadRefType
  payloadBody?: string
  payloadFileRef?: string
  payloadCodec?: 'plain' | 'gzip' | 'zstd'
  payloadSizeBytes?: number
  payloadHash: string
  payloadMetaJson?: string
  sourceDedupeKey: string
  processingOwner: RawProcessingOwner
  processingState: RawProcessingState
  parserVersion: string
  errorMessage?: string
  storageTier: RawStorageTier
  archiveStatus: RawArchiveStatus
}

export type SafeRawRecordSummary = Omit<RawIntelligenceRecord, 'payloadBody' | 'payloadFileRef'>

export type AppendRawRecordInput = Omit<
  RawIntelligenceRecord,
  'rawRecordId' | 'detectedAt' | 'processingOwner' | 'processingState' | 'storageTier' | 'archiveStatus'
> & {
  detectedAt?: string
  processingOwner?: RawProcessingOwner
  processingState?: RawProcessingState
  storageTier?: RawStorageTier
  archiveStatus?: RawArchiveStatus
}

export type IntelligenceEventClusterStatus = 'open' | 'updated' | 'resolved' | 'archived'

export type IntelligenceEventClusterType =
  | 'announcement'
  | 'incident'
  | 'macro-event'
  | 'regulatory-event'
  | 'news-event'

export type IntelligenceEventCluster = {
  clusterId: string
  clusterKey: string
  clusterType: IntelligenceEventClusterType
  title: string
  primaryItemId: string
  primarySourceId: string
  status: IntelligenceEventClusterStatus
  firstPublishedAt?: string
  lastPublishedAt?: string
  lastDetectedAt: string
  relatedSymbolsJson?: string
  relatedSourceIdsJson?: string
  clusterVersion: string
}

export type IntelligenceItemTimelineStatus =
  | 'new'
  | 'evaluated'
  | 'alerted'
  | 'suppressed'
  | 'archived'

export type IntelligenceItem = {
  itemId: string
  clusterId?: string
  primaryRawRecordId: string
  canonicalDedupeKey: string
  sourceId: string
  eventType: string
  title: string
  summary?: string
  url?: string
  sourceCategory: string
  sourceTrust: string
  publishedAt?: string
  detectedAt: string
  language?: string
  entitiesJson?: string
  symbolsJson?: string
  severityHint?: 'info' | 'warning' | 'critical'
  processingLabelsJson?: string
  timelineStatus: IntelligenceItemTimelineStatus
  normalizerVersion: string
}

export type IntelligenceItemRevisionKind = 'initial' | 'update' | 'correction' | 'resolution'

export type IntelligenceItemRevision = {
  revisionId: string
  itemId: string
  previousRevisionId?: string
  revisionKind: IntelligenceItemRevisionKind
  publishedAt?: string
  detectedAt: string
  title?: string
  summary?: string
  payloadDiffJson?: string
  revisionVersion: string
}
