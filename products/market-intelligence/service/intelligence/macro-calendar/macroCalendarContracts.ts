export const MACRO_CALENDAR_SCHEMA_VERSION = 1 as const

export type MacroCalendarEventFamily = 'fomc' | 'cpi' | 'core-cpi' | 'consumer-price-index' | 'employment-situation' | 'pce' | 'core-pce' | 'gdp'
export type MacroCalendarRevisionKind = 'schedule' | 'official-release' | 'schedule-correction' | 'official-revision' | 'cancellation'
export type MacroCalendarLifecycleState = 'scheduled' | 'released' | 'cancelled'
export type MacroCalendarCoverageState = 'available' | 'partial' | 'unavailable'
export type MacroCalendarProviderId = 'macro-calendar-fed' | 'macro-calendar-bls' | 'macro-calendar-bea'

export type MacroCalendarValue = {
  displayValue: string
  numericValue?: number
  numericLowerBound?: number
  numericUpperBound?: number
  unit?: string
}

export type MacroCalendarEvidenceRef = {
  providerId: MacroCalendarProviderId
  descriptorId: string
  sourceUrl: string
  rawRecordId?: string
  evidenceHash: string
  detectedAt: string
  fieldKinds: Array<'schedule' | 'actual' | 'previous' | 'cancellation'>
}

export type MacroCalendarRevision = {
  revisionId: string
  eventKey: string
  releaseGroupKey: string
  eventFamily: MacroCalendarEventFamily
  eventNameKey: string
  countryCode: 'US'
  importance: 'high'
  periodKey: string
  lifecycleState: MacroCalendarLifecycleState
  revisionKind: MacroCalendarRevisionKind
  scheduledDate: string
  scheduledAt?: string
  publishedAt?: string
  detectedAt: string
  recordedAt: string
  actual?: MacroCalendarValue
  previous?: MacroCalendarValue
  consensus?: MacroCalendarValue
  providerId: MacroCalendarProviderId
  descriptorId: string
  sourceUrl: string
  rawRecordId?: string
  evidenceHash: string
  evidenceRefs: MacroCalendarEvidenceRef[]
  snapshotHash: string
  replacesRevisionId?: string
  parserVersion: string
  caveats: string[]
}

export type MacroCalendarProviderHealthRevision = {
  providerId: MacroCalendarProviderId
  status: 'healthy' | 'degraded' | 'failed' | 'paused'
  updatedAt: string
  lastSuccessAt?: string
  lastFailureAt?: string
  consecutiveFailures: number
  checkpoint: { parserVersion?: string; scheduleHorizonEnd?: string; successfulEventKeys?: string[] }
  safeSummary?: string
}
