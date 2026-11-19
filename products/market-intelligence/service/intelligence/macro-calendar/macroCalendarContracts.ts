import type { MacroEconomicCalendarImportance } from '../../../contracts/macro/economicCalendarQueryContracts'

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
  /**
   * 记录自己带的重要性。列是 `not null`，但读取时按三档校验：读到不认识的文本就是「没有值」，
   * 不拿某一档顶上（详情那一行会写「未提供」）。
   */
  importance?: MacroEconomicCalendarImportance
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

/**
 * **标准表写入失败码（闭集）**——注意：**写入失败不是来源失败**（架构师 2026-11-19）。
 * 把 provider 标成 `failed` 会让读者去查网络与凭据，而真相是我们的库没写进去。
 * - `standard-write-failed`：写库抛错/约束失败；
 * - `value-shape-rejected`：行被值形状守卫拒收（`values_json` 不是展示串）。
 */
export type MacroCalendarWriteFailureCode = 'standard-write-failed' | 'value-shape-rejected'

/** 最近一次写入失败：与 `status` 并列，**不改 `status`**。 */
export type MacroCalendarWriteFailure = Readonly<{
  /** UTC ISO；这次写入失败的时刻。 */
  at: string
  /** 这一批失败了几行（`DualWriteCounts.failed`）。 */
  failedRows: number
  firstErrorCode: MacroCalendarWriteFailureCode
}>

export type MacroCalendarProviderHealthRevision = {
  providerId: MacroCalendarProviderId
  status: 'healthy' | 'degraded' | 'failed' | 'paused'
  updatedAt: string
  lastSuccessAt?: string
  lastFailureAt?: string
  consecutiveFailures: number
  checkpoint: { parserVersion?: string; scheduleHorizonEnd?: string; successfulEventKeys?: string[] }
  safeSummary?: string
  /**
   * 最近一次标准表写入失败（用户 2026-11-19 定）：**没有就不写**，不编默认值。
   * 它进 `materialSignature`，失败状态变化会单独记一条历史。
   */
  lastWriteFailure?: MacroCalendarWriteFailure
}
