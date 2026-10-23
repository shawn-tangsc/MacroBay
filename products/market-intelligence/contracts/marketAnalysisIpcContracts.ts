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

export type MarketAnalysisCalendarEventContextCaveat = 'no-facts-held' | 'insufficient-facts' | 'event-values-missing'

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
