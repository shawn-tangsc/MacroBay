export const MARKET_ANALYSIS_IPC_METHODS = Object.freeze({
  listTimeline: 'marketAnalysis.listTimeline',
  getTimelineEntry: 'marketAnalysis.getTimelineEntry',
  getAnalysisRun: 'marketAnalysis.getAnalysisRun',
  getSummary: 'marketAnalysis.getSummary',
  listPredictions: 'marketAnalysis.listPredictions',
  startFollowUp: 'marketAnalysis.startFollowUp',
  getWorkspaceBinding: 'marketAnalysis.getWorkspaceBinding',
  requestInitialAnalysis: 'marketAnalysis.requestInitialAnalysis',
  getLatestAttempt: 'marketAnalysis.getLatestAttempt',
  /** The facts the system holds for one calendar event the reader selected. */
  calendarEventContext: 'marketAnalysis.calendarEventContext',
  /** Whether the capability is on, and which model it may call. */
  getSettings: 'marketAnalysis.getSettings',
  saveSettings: 'marketAnalysis.saveSettings'
} as const)

export type MarketAnalysisIpcMethod = (typeof MARKET_ANALYSIS_IPC_METHODS)[keyof typeof MARKET_ANALYSIS_IPC_METHODS]

/**
 * Closed key set: a patch that names anything else is a boundary error, not a stored field.
 * `enabled` is optional so "only change the model" is expressible; a value of the wrong type or an
 * unknown key is refused rather than coerced, because it would otherwise persist as a silent default.
 */
export function isMarketAnalysisSettingsPatchInput(value: unknown): value is Readonly<{ enabled?: boolean; providerId?: string; modelId?: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false
  const candidate = value as Record<string, unknown>
  const keys = Object.keys(candidate)
  if (keys.some(key => !['enabled', 'providerId', 'modelId'].includes(key))) return false
  if (keys.length === 0) return false
  if (candidate.enabled !== undefined && typeof candidate.enabled !== 'boolean') return false
  if (candidate.providerId !== undefined && (typeof candidate.providerId !== 'string' || candidate.providerId.length > 200)) return false
  if (candidate.modelId !== undefined && (typeof candidate.modelId !== 'string' || candidate.modelId.length > 200)) return false
  return true
}

/**
 * The selected calendar event whose context is being asked for.
 *
 * `month` is part of the request because a 0xRouter event key carries none: without it the read
 * cannot be scoped, so the caller (which knows the month it rendered) must say so.
 */
export type MarketAnalysisCalendarEventContextInput = Readonly<{ eventKey: string; month: string; asOf: string }>

export type MarketAnalysisCalendarEventContextCaveat = 'calendar-unreadable' | 'no-facts-held' | 'insufficient-facts' | 'event-values-missing'

/** What the panel receives: the facts, the evidence behind them, and how complete they are. */
export type MarketAnalysisCalendarEventContextData = Readonly<{
  facts: readonly Readonly<{ factId: string; metric: string; value: string }>[]
  evidenceRefs: readonly string[]
  coverage: 'available' | 'partial' | 'unavailable'
  caveats: readonly MarketAnalysisCalendarEventContextCaveat[]
}>

/** Exact keys, a month that looks like one, and a parseable instant — the same strictness the other
 *  product queries use, so a malformed request fails at the boundary rather than reading nothing. */
export function isMarketAnalysisCalendarEventContextInput(value: unknown): value is MarketAnalysisCalendarEventContextInput {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false
  const candidate = value as Record<string, unknown>
  if (Object.keys(candidate).sort().join(',') !== 'asOf,eventKey,month') return false
  return typeof candidate.eventKey === 'string' && candidate.eventKey.length > 0
    && typeof candidate.month === 'string' && /^\d{4}-\d{2}$/.test(candidate.month)
    && typeof candidate.asOf === 'string' && Number.isFinite(Date.parse(candidate.asOf))
}

/**
 * 按条「AI 解读」的请求结果契约（R37 §9.4）。
 *
 * 端点为两件事负责：请求能不能排上、排上了是哪一条运行。模型跑成没跑成不归它（那是结果条与
 * 失败通知的事）。码是闭集：表外的码一律落默认，**不许把 `analysis-*` 全量直通**——界面每加一个
 * 码就要加一句，而多数码读者无从行动。
 */
export const NEWS_INTERPRETATION_FAILURE_CODES = Object.freeze({
  notEnabled: 'analysis-not-enabled',
  providerNotReady: 'analysis-provider-not-ready',
  requestUnavailable: 'analysis-initial-request-unavailable',
  requestFailed: 'analysis-initial-request-failed',
  eventGroupNotFound: 'analysis-event-group-not-found'
} as const)

export type NewsInterpretationFailureCode = (typeof NEWS_INTERPRETATION_FAILURE_CODES)[keyof typeof NEWS_INTERPRETATION_FAILURE_CODES]

/** 事实不够时还能说清是哪一种——两份可查原因都指向「我们的问题」，阅读动作是「查看原因」。 */
export const NEWS_INTERPRETATION_INSUFFICIENT_REASONS = Object.freeze({
  triggerEvidenceMissing: 'trigger-evidence-missing',
  marketFactsBelowMinimum: 'market-facts-below-minimum'
} as const)

export type NewsInterpretationInsufficientReason = (typeof NEWS_INTERPRETATION_INSUFFICIENT_REASONS)[keyof typeof NEWS_INTERPRETATION_INSUFFICIENT_REASONS]

/** 本来就不该单独解读的三档：条目不存在 / 源不在覆盖范围 / 过不了可分析过滤。 */
export const NEWS_INTERPRETATION_NOT_ELIGIBLE_REASONS = Object.freeze({
  itemNotFound: 'item-not-found',
  sourceNotCovered: 'source-not-covered',
  itemNotEligible: 'item-not-eligible'
} as const)

export type NewsInterpretationNotEligibleReason = (typeof NEWS_INTERPRETATION_NOT_ELIGIBLE_REASONS)[keyof typeof NEWS_INTERPRETATION_NOT_ELIGIBLE_REASONS]
