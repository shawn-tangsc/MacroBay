import type { MacroEconomicCalendarImportance } from '../../../contracts/macro/economicCalendarQueryContracts'

export const MACRO_CALENDAR_SCHEMA_VERSION = 1 as const

export type MacroCalendarEventFamily = 'fomc' | 'cpi' | 'core-cpi' | 'consumer-price-index' | 'employment-situation' | 'pce' | 'core-pce' | 'gdp'
export type MacroCalendarRevisionKind = 'schedule' | 'official-release' | 'schedule-correction' | 'official-revision' | 'cancellation'
export type MacroCalendarLifecycleState = 'scheduled' | 'released' | 'cancelled'
export type MacroCalendarCoverageState = 'available' | 'partial' | 'unavailable'
/**
 * 日历这条链上**真实存在**的 provider id（用户 2026-11-19）：
 * 前三个是官方采集（Fed/BLS/BEA），`0xrouter` 是历史回填那条腿——它一直在写标准表与健康记录，
 * 只是类型声明漏了它，于是调用点只能 `as never` 强转（等于类型在说谎）。补进来、强转删掉。
 */
export type MacroCalendarProviderId = 'macro-calendar-fed' | 'macro-calendar-bls' | 'macro-calendar-bea' | '0xrouter'

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
