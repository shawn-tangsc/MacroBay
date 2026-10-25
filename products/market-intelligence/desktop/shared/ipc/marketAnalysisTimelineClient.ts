import {
  MARKET_ANALYSIS_IPC_METHODS
} from '../../../contracts/marketAnalysisIpcContracts'
import { MARKET_ANALYSIS_CONTRACT_POLICY } from '../../../contracts/marketAnalysisContracts'
import type { AnalysisConclusion, AnalysisConclusionDirection } from '../../../contracts/marketAnalysisContracts'

const PRODUCT_ID = 'market-intelligence'
const MAX_TIMELINE_ITEMS = 50
/**
 * Bound on a list the model authored: the same ceiling the summary validator upstream enforces, so
 * this side can never refuse a collection the service itself accepted.
 */
const MAX_MODEL_LIST_ITEMS = MARKET_ANALYSIS_CONTRACT_POLICY.maximumCollectionItems
/** Bound on the change list a run detail may carry, mirroring the frozen record. */
const MAX_CHANGE_FACTS = 200

/** Structured "what changed" for a run, safe for the renderer. */
export type MarketAnalysisChangeView = Readonly<{
  /**
   * Present only when an older service sent the compact encoding. The view is
   * rendered from `facts`, and the encoding is unbounded in size (a large diff
   * reaches tens of thousands of characters), so it is never required.
   */
  summary?: string
  facts: readonly Readonly<{
    domain: string
    subject: string | null
    /** The fact's own name when `subject` is only its kind; absent on older snapshots. */
    subjectLabel?: string | null
    metric: string
    unit: string | null
    kind: 'added' | 'removed' | 'changed'
    previousValue: string | number | null
    value: string | number | null
  }>[]
  missingDomainsAdded: readonly string[]
  missingDomainsRemoved: readonly string[]
  caveatsAdded: number
  caveatsRemoved: number
  evidenceRefsAdded: number
  evidenceRefsRemoved: number
}>
const MAX_TEXT_LENGTH = 2_000
const CANONICAL_UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u

export type MarketAnalysisAttempt = Readonly<{ id: string; status: string; failureCode: string | null; queuedAt: string; evidenceCount: number }>

export type MarketAnalysisTimelineEntry = Readonly<{
  id: string
  eventGroupId: string
  analysisRunId: string | null
  kind: 'event' | 'analysis' | 'review' | 'prediction-update' | 'system'
  status: 'published' | 'stale' | 'superseded'
  occurredAt: string
  summaryRef: string | null
  safeTitle: string
  safeExcerpt: string | null
  /** Language-neutral direction key published with the entry, when the summary has one. */
  direction?: AnalysisConclusionDirection | null
  version: number
  /** Why the newest automatic decision happened, or why it did not; tokens only. */
  triggerStatus: MarketAnalysisTriggerStatus | null
}>

export type MarketAnalysisTriggerStatus = Readonly<{
  triggerKey: string
  reasonCode: string
  decidedAt: string
  /** Which open a session-slot run served, and whether it was caught up rather than on time. */
  slotOpenAt?: string
  slotDelayed?: boolean
}>

export type MarketAnalysisTimelinePage = Readonly<{
  schemaVersion: 1
  items: readonly MarketAnalysisTimelineEntry[]
  nextCursor: string | null
}>

export type MarketAnalysisTimelineDetail = Readonly<{
  run: Readonly<{
    id: string
    eventGroupId: string
    analysisPhase: 'initial' | 'review' | 'correction'
    status: 'queued' | 'running' | 'succeeded' | 'invalid-output' | 'failed' | 'cancelled' | 'stale' | 'superseded'
    asOf: string
    dataCutoff: string
    evidenceCount: number
    /** Structured "what changed" for this run's snapshot; null when unavailable. */
    change: MarketAnalysisChangeView | null
  }>
  summary: Readonly<{
    id: string
    version: number
    /** Legacy summaries published before the structured conclusion existed. */
    eventAssessment?: string
    /** Current summaries: language-neutral direction key plus prose fields. */
    conclusion?: AnalysisConclusion

    knownFacts: readonly Readonly<{ statement: string }>[]
    transmissionHypotheses: readonly Readonly<{ statement: string }>[]
    marketReaction: readonly Readonly<{ statement: string }>[]
    supportingEvidence: readonly Readonly<{ statement: string }>[]
    counterEvidence: readonly Readonly<{ statement: string }>[]
    nextCatalysts: readonly Readonly<{ statement: string }>[]
    /**
     * One operation direction per horizon. Optional: a summary published before this field existed
     * simply renders without the block, and it must not turn the whole detail into "unavailable".
     */
    directions?: readonly Readonly<{ horizon: string; direction: string; rationale: string; confidence: string }>[]
    evidenceCount: number
    dataCaveats: readonly string[]
    createdAt: string
  }>
  predictions: readonly Readonly<{
    id: string
    asset: 'BTC' | 'ETH'
    baseCase: string
    conditions: readonly string[]
    invalidation: string
    status: 'pending' | 'confirmed' | 'partially-confirmed' | 'invalidated' | 'expired' | 'insufficient-data'
    verificationDueAt: string
  }>[]
}>

/** The switches the panel owns: whether the capability runs, and the model it may call. */
export type MarketAnalysisSettingsView = Readonly<{
  enabled: boolean
  providerId: string
  modelId: string
  updatedAt: string
}>

export type MarketAnalysisSettingsPatch = Readonly<{ enabled?: boolean; providerId?: string; modelId?: string }>

export type MarketAnalysisSettingsSaveResult =
  | { state: 'saved'; settings: MarketAnalysisSettingsView }
  /** `analysis-model-unconfigured` / `analysis-model-unavailable` are answers, not failures. */
  | { state: 'refused'; reason: 'model-unconfigured' | 'model-unavailable' | 'failed' }

export type MarketAnalysisTimelineClient = Readonly<{
  getSettings: () => Promise<MarketAnalysisSettingsView | undefined>
  saveSettings: (patch: MarketAnalysisSettingsPatch) => Promise<MarketAnalysisSettingsSaveResult>
  listTimeline: (input?: { cursor?: string }) => Promise<{ state: 'available'; page: MarketAnalysisTimelinePage } | { state: 'unavailable' }>
  requestInitialAnalysis: (retryRunId?: string, mode?: 'initial' | 'refresh') => Promise<{ state: 'queued'; itemId: string } | { state: 'unavailable'; reason: 'not-eligible' | 'not-ready' | 'failed' | 'already-available' }>
  getLatestAttempt: () => Promise<MarketAnalysisAttempt | null>
  getDetail: (entry: MarketAnalysisTimelineEntry) => Promise<{ state: 'available'; detail: MarketAnalysisTimelineDetail } | { state: 'unavailable' }>
}>

export const marketAnalysisTimelineClient: MarketAnalysisTimelineClient = {
  async getSettings() {
    try {
      if (!window.platform?.products?.invoke) return undefined
      const value = await window.platform.products.invoke(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.getSettings, {})
      return sanitizeSettings(value)
    } catch {
      return undefined
    }
  },
  async saveSettings(patch) {
    try {
      if (!window.platform?.products?.invoke) return { state: 'refused', reason: 'failed' }
      const saved = sanitizeSettings(await window.platform.products.invoke(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.saveSettings, patch))
      return saved ? { state: 'saved', settings: saved } : { state: 'refused', reason: 'failed' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('analysis-model-unconfigured')) return { state: 'refused', reason: 'model-unconfigured' }
      if (message.includes('analysis-model-unavailable')) return { state: 'refused', reason: 'model-unavailable' }
      return { state: 'refused', reason: 'failed' }
    }
  },
  async listTimeline(input = {}) {
    try {
      if (!window.platform?.products?.invoke) return unavailable()
      return sanitizePage(await window.platform.products.invoke(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.listTimeline, input)) ?? unavailable()
    } catch {
      return unavailable()
    }
  },
  async getLatestAttempt() {
    try {
      const value = await window.platform.products.invoke(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.getLatestAttempt, {})
      if (!isExactRecord(value, ['id', 'status', 'failureCode', 'queuedAt', 'evidenceCount']) || !isText(value.id) ||
        !['queued', 'running', 'succeeded', 'invalid-output', 'failed', 'cancelled', 'stale', 'superseded'].includes(value.status as string) ||
        (value.failureCode !== null && !isText(value.failureCode)) || !isCanonicalTime(value.queuedAt) ||
        !Number.isSafeInteger(value.evidenceCount) || Number(value.evidenceCount) < 0) return null
      return value as MarketAnalysisAttempt
    } catch { return null }
  },
  async requestInitialAnalysis(retryRunId, mode = 'initial') {
    try {
      if (!window.platform?.products?.invoke) return { state: 'unavailable', reason: 'failed' }
      const payload = retryRunId ? { retryRunId } : mode === 'refresh' ? { mode } : {}
      const result = await window.platform.products.invoke(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.requestInitialAnalysis, payload)
      if (!isExactRecord(result, ['itemId', 'queued']) || typeof result.itemId !== 'string' || result.queued !== true) return { state: 'unavailable', reason: 'failed' }
      return { state: 'queued', itemId: result.itemId }
    } catch (error) {
      // The main process' refusals are answers, not failures: it says this when a usable analysis
      // already exists, including the run it just completed. Collapsing that into 'failed' is what put
      // "重新分析未发布" on screen for a re-analysis that had succeeded.
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('analysis-already-available')) return { state: 'unavailable', reason: 'already-available' }
      // The main process answers this before its runtime is wired, which is exactly what a click
      // during a restart hits. Naming it keeps the panel from blaming the model configuration.
      if (message.includes('analysis-initial-request-unavailable')) return { state: 'unavailable', reason: 'not-ready' }
      return { state: 'unavailable', reason: message === 'analysis-not-eligible' ? 'not-eligible' : 'failed' }
    }
  },
  async getDetail(entry) {
    if (!entry.analysisRunId || !entry.summaryRef) return unavailable()
    try {
      if (!window.platform?.products?.invoke) return unavailable()
      const [run, summary, predictions] = await Promise.all([
        window.platform.products.invoke(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.getAnalysisRun, { id: entry.analysisRunId }),
        window.platform.products.invoke(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.getSummary, { id: entry.summaryRef }),
        window.platform.products.invoke(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.listPredictions, { summaryId: entry.summaryRef })
      ])
      return sanitizeDetail(entry, run, summary, predictions) ?? unavailable()
    } catch {
      return unavailable()
    }
  }
}

function sanitizeSettings(value: unknown): MarketAnalysisSettingsView | undefined {
  if (!isExactRecord(value, ['enabled', 'providerId', 'modelId', 'updatedAt'])) return undefined
  // Empty model halves are a real state (nothing chosen yet), so they are strings, not "text".
  if (typeof value.enabled !== 'boolean' || typeof value.providerId !== 'string' || typeof value.modelId !== 'string' ||
    value.providerId.length > MAX_TEXT_LENGTH || value.modelId.length > MAX_TEXT_LENGTH || !isCanonicalTime(value.updatedAt)) return undefined
  return { enabled: value.enabled, providerId: value.providerId, modelId: value.modelId, updatedAt: value.updatedAt }
}

function sanitizePage(value: unknown): { state: 'available'; page: MarketAnalysisTimelinePage } | undefined {
  if (!isExactRecord(value, ['schemaVersion', 'items', 'nextCursor']) || value.schemaVersion !== 1 || !Array.isArray(value.items) || value.items.length > MAX_TIMELINE_ITEMS || (value.nextCursor !== null && !isText(value.nextCursor))) return undefined
  const items = value.items.map(sanitizeEntry)
  if (items.some((item) => !item)) return undefined
  return { state: 'available', page: { schemaVersion: 1, items: items as MarketAnalysisTimelineEntry[], nextCursor: value.nextCursor } }
}

/**
 * Codes the renderer can translate; a status carrying anything else is treated as absent.
 *
 * This list is duplicated on purpose — importing the service's `triggerStatusPolicy` here would
 * pull service-only imports into the renderer bundle — so `triggerStatusCopy.test.ts` asserts it
 * matches the policy and the i18n registry key for key. It went out of step once already: the
 * `manual-request` token was added to the policy and the copy, and every reader-triggered row
 * silently lost its line here.
 */
export const explainableTriggerReasonCodes: readonly string[] = Object.freeze(['significance-confirmed', 'significance-below-threshold', 'provider-surprise-confirmed', 'semantic-no-op', 'interval-active', 'hour-budget-exhausted', 'day-budget-exhausted', 'schedule-reserve-exhausted', 'session-slot-asia', 'session-slot-europe', 'session-slot-us', 'invalid-significance-input', 'manual-request', 'severity-confirmed', 'medium-score-confirmed', 'market-reaction-confirmed', 'restart-initial-compensated', 'restart-review-compensated'])

function sanitizeTriggerStatus(value: unknown): MarketAnalysisTriggerStatus | null {
  if (value === null || value === undefined) return null
  // `slotOpenAt`/`slotDelayed` are optional: a newer renderer must keep working against a main
  // process that predates the session slots.
  if (!isExactRecordWithOptionals(value, ['triggerKey', 'reasonCode', 'decidedAt'], ['slotOpenAt', 'slotDelayed'])) return null
  const status = value as { triggerKey: unknown; reasonCode: unknown; decidedAt: unknown; slotOpenAt?: unknown; slotDelayed?: unknown }
  if (!isText(status.triggerKey) || !isText(status.reasonCode) || !isCanonicalTime(status.decidedAt)) return null
  // Unknown codes are dropped here too: the panel must never print a raw token.
  if (!explainableTriggerReasonCodes.includes(status.reasonCode)) return null
  const slotOpenAt = typeof status.slotOpenAt === 'string' && isCanonicalTime(status.slotOpenAt) ? status.slotOpenAt : undefined
  return {
    triggerKey: status.triggerKey, reasonCode: status.reasonCode, decidedAt: status.decidedAt,
    ...(slotOpenAt ? { slotOpenAt, slotDelayed: status.slotDelayed === true } : {})
  }
}

function sanitizeEntry(value: unknown): MarketAnalysisTimelineEntry | undefined {
  // `triggerStatus` is optional on purpose: a newer renderer must keep working against a
  // payload from an older main process (or a mixed build), where a mandatory key turned the
  // whole panel into "detail unavailable" instead of simply showing no decision yet.
  if (!isExactRecordWithOptionals(value, ['id', 'eventGroupId', 'analysisRunId', 'kind', 'status', 'occurredAt', 'summaryRef', 'safeTitle', 'safeExcerpt', 'version'], ['triggerStatus', 'direction']) ||
    !isText(value.id) || !isText(value.eventGroupId) || (value.analysisRunId !== null && !isText(value.analysisRunId)) ||
    !['event', 'analysis', 'review', 'prediction-update', 'system'].includes(value.kind as string) ||
    !['published', 'stale', 'superseded'].includes(value.status as string) || !isCanonicalTime(value.occurredAt) ||
    (value.summaryRef !== null && !isText(value.summaryRef)) || !isText(value.safeTitle) ||
    (value.safeExcerpt !== null && !isText(value.safeExcerpt)) || typeof value.version !== 'number' || !Number.isSafeInteger(value.version) || value.version < 1) return undefined
  return { ...(value as MarketAnalysisTimelineEntry), direction: sanitizeDirectionKey((value as { direction?: unknown }).direction) ?? null, triggerStatus: sanitizeTriggerStatus((value as { triggerStatus?: unknown }).triggerStatus) }
}

function sanitizeDetail(entry: MarketAnalysisTimelineEntry, run: unknown, summary: unknown, predictions: unknown): { state: 'available'; detail: MarketAnalysisTimelineDetail } | undefined {
  const safeRun = sanitizeRun(run)
  const safeSummary = sanitizeSummary(summary)
  const safePredictions = sanitizePredictions(predictions)
  if (!safeRun || !safeSummary || !safePredictions || safeRun.id !== entry.analysisRunId || safeRun.eventGroupId !== entry.eventGroupId || safeSummary.id !== entry.summaryRef) return undefined
  return { state: 'available', detail: { run: safeRun, summary: safeSummary, predictions: safePredictions } }
}

function sanitizeRun(value: unknown): MarketAnalysisTimelineDetail['run'] | undefined {
  const fields = ['id', 'eventGroupId', 'analysisPhase', 'status', 'failureCode', 'queuedAt', 'startedAt', 'completedAt', 'asOf', 'dataCutoff', 'evidenceCount']
  if (!isExactRecordWithOptionals(value, fields, ['change'])) return undefined
  // `change` is optional: the renderer can be newer than the service that answers
  // the IPC, and an absent optional field must not fail the whole detail.
  const change = sanitizeChangeView(value.change)
  if (!isText(value.id) || !isText(value.eventGroupId) || !['initial', 'review', 'correction'].includes(value.analysisPhase as string) ||
    !['queued', 'running', 'succeeded', 'invalid-output', 'failed', 'cancelled', 'stale', 'superseded'].includes(value.status as string) ||
    change === false ||
    !isCanonicalTime(value.asOf) || !isCanonicalTime(value.dataCutoff) || typeof value.evidenceCount !== 'number' || !Number.isSafeInteger(value.evidenceCount) || value.evidenceCount < 0) return undefined
  return { id: value.id, eventGroupId: value.eventGroupId, analysisPhase: value.analysisPhase as MarketAnalysisTimelineDetail['run']['analysisPhase'], status: value.status as MarketAnalysisTimelineDetail['run']['status'], asOf: value.asOf, dataCutoff: value.dataCutoff, evidenceCount: value.evidenceCount, change: change ?? null }
}

function sanitizeSummary(value: unknown): MarketAnalysisTimelineDetail['summary'] | undefined {
  const fields = ['id', 'schemaVersion', 'analysisRunId', 'eventGroupId', 'version', 'knownFacts', 'transmissionHypotheses', 'marketReaction', 'supportingEvidence', 'counterEvidence', 'scenarios', 'nextCatalysts', 'dataCaveats', 'evidenceRefs', 'createdAt']
  // `directions`, `eventAssessment` (legacy) and `conclusion` (structured) are all optional: a
  // summary from either contract generation must render, and a missing optional field must never
  // turn the detail into "unavailable".
  if (!isExactRecordWithOptionals(value, fields, ['directions', 'eventAssessment', 'conclusion']) || value.schemaVersion !== 1 ||
    !isText(value.id) || typeof value.version !== 'number' || !Number.isSafeInteger(value.version) || value.version < 1 ||
    !isCanonicalTime(value.createdAt)) return undefined
  // Caveats are rendered, so an over-long list is truncated; the evidence references are only
  // counted (never sent on), so they are read whole and the audit count stays exact.
  const dataCaveats = readStringList(value.dataCaveats, MAX_MODEL_LIST_ITEMS)
  const evidenceRefs = readReferenceList(value.evidenceRefs)
  if (!dataCaveats || !evidenceRefs) return undefined
  const conclusion = sanitizeConclusion((value as { conclusion?: unknown }).conclusion)
  if (conclusion === false) return undefined
  const eventAssessment = typeof value.eventAssessment === 'string' ? value.eventAssessment : undefined
  if (!conclusion && !eventAssessment) return undefined
  const knownFacts = sanitizeStatementClaims(value.knownFacts, ['factId', 'statement', 'evidenceRefIds'])
  const transmissionHypotheses = sanitizeStatementClaims(value.transmissionHypotheses, ['statement', 'evidenceRefIds'])
  const marketReaction = sanitizeStatementClaims(value.marketReaction, ['statement', 'factIds', 'evidenceRefIds'])
  const supportingEvidence = sanitizeStatementClaims(value.supportingEvidence, ['statement', 'evidenceRefId'])
  const counterEvidence = sanitizeStatementClaims(value.counterEvidence, ['statement', 'evidenceRefId'])
  const nextCatalysts = sanitizeStatementClaims(value.nextCatalysts, ['statement', 'evidenceRefIds'])
  const directions = sanitizeDirections((value as { directions?: unknown }).directions)
  if (!knownFacts || !transmissionHypotheses || !marketReaction || !supportingEvidence || !counterEvidence || !nextCatalysts || directions === false) return undefined
  return {
    id: value.id,
    version: value.version,
    ...(eventAssessment ? { eventAssessment } : {}),
    ...(conclusion ? { conclusion } : {}),
    knownFacts,
    transmissionHypotheses,
    marketReaction,
    supportingEvidence,
    counterEvidence,
    nextCatalysts,
    ...(directions ? { directions } : {}),
    evidenceCount: evidenceRefs.length,
    dataCaveats,
    createdAt: value.createdAt
  }
}

function sanitizeConclusion(value: unknown): AnalysisConclusion | undefined | false {
  if (value === undefined || value === null) return undefined
  if (!isExactRecord(value, ['direction', 'summary', 'change', 'causalChain', 'conditions', 'macro', 'evidenceStrength', 'dataGaps'])) return false
  const direction = sanitizeDirectionKey(value.direction)
  if (!direction || !isText(value.summary) || !isText(value.change) || !isText(value.causalChain) ||
    !(value.macro === null || isText(value.macro)) || !(value.evidenceStrength === null || isText(value.evidenceStrength))) return false
  const conditions = readStringList(value.conditions, MAX_MODEL_LIST_ITEMS)
  const dataGaps = readStringList(value.dataGaps, MAX_MODEL_LIST_ITEMS)
  if (!conditions || !dataGaps) return false
  return {
    direction,
    summary: value.summary,
    change: value.change,
    causalChain: value.causalChain,
    conditions,
    macro: value.macro as string | null,
    evidenceStrength: value.evidenceStrength as string | null,
    dataGaps
  }
}

function sanitizeDirectionKey(value: unknown): AnalysisConclusionDirection | undefined {
  return value === 'bullish' || value === 'bearish' || value === 'range' || value === 'undecided' || value === 'mixed'
    ? value
    : undefined
}

/**
 * The operation directions, or `false` when the payload is malformed.
 *
 * `undefined` means "this summary predates the field": the block is simply not rendered. Direction
 * terms are passed through as text rather than filtered here — the panel colours a term it knows and
 * shows the rest plainly, and the validator upstream already restricts them to the five.
 */
function sanitizeDirections(value: unknown): NonNullable<MarketAnalysisTimelineDetail['summary']['directions']> | undefined | false {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) return false
  const directions = value.map(entry => {
    // `evidenceRefIds` is part of the stored shape even though the block does not print it: an
    // exact-key check that omitted it would reject every real payload and blank the whole detail.
    if (!isExactRecord(entry, ['horizon', 'direction', 'rationale', 'confidence', 'evidenceRefIds']) ||
      !isText(entry.horizon) || !isText(entry.direction) || !isText(entry.rationale) || !isText(entry.confidence) ||
      !readReferenceList(entry.evidenceRefIds)) return undefined
    return { horizon: entry.horizon, direction: entry.direction, rationale: entry.rationale, confidence: entry.confidence }
  })
  return directions.every(Boolean)
    ? (directions as NonNullable<MarketAnalysisTimelineDetail['summary']['directions']>).slice(0, MAX_TIMELINE_ITEMS)
    : false
}

/**
 * A list of claims, however long it is.
 *
 * The cap is a rendering bound, not a validity rule: a model that cites fifty-four facts published a
 * perfectly valid conclusion, and rejecting it because the list is long blanked the whole detail —
 * the reader saw "详情暂不可用" for the newest, richest analysis in the store. Over-long lists are
 * truncated; only a malformed item fails.
 */
function sanitizeStatementClaims(value: unknown, fields: readonly string[]): readonly Readonly<{ statement: string }>[] | undefined {
  if (!Array.isArray(value)) return undefined
  const claims = value.map(item => {
    if (!isExactRecord(item, fields) || !isText(item.statement)) return undefined
    return { statement: item.statement }
  })
  return claims.some(item => !item) ? undefined : (claims as readonly Readonly<{ statement: string }>[]).slice(0, MAX_TIMELINE_ITEMS)
}

function sanitizePredictions(value: unknown): MarketAnalysisTimelineDetail['predictions'] | undefined {
  if (!Array.isArray(value)) return undefined
  const predictions = value.map((item) => {
    const fields = ['id', 'summaryId', 'asset', 'horizonStart', 'horizonEnd', 'baseCase', 'conditions', 'invalidation', 'nextCatalyst', 'status', 'verificationDueAt', 'createdAt']
    if (!isExactRecord(item, fields) || !isText(item.id) || !['BTC', 'ETH'].includes(item.asset as string) || !isText(item.baseCase) ||
      !isText(item.invalidation) || !['pending', 'confirmed', 'partially-confirmed', 'invalidated', 'expired', 'insufficient-data'].includes(item.status as string) || !isCanonicalTime(item.verificationDueAt)) return undefined
    const conditions = readStringList(item.conditions, MAX_MODEL_LIST_ITEMS)
    if (!conditions) return undefined
    return { id: item.id, asset: item.asset as 'BTC' | 'ETH', baseCase: item.baseCase, conditions, invalidation: item.invalidation, status: item.status as MarketAnalysisTimelineDetail['predictions'][number]['status'], verificationDueAt: item.verificationDueAt }
  })
  return predictions.some((item) => !item) ? undefined : (predictions as MarketAnalysisTimelineDetail['predictions']).slice(0, MAX_TIMELINE_ITEMS)
}

/**
 * Exact-record guard that tolerates absent optional fields.
 *
 * Required fields must all be present with own enumerable values, no unknown
 * field may appear, and an optional field may be present (then it is validated by
 * the caller) or absent. This is what lets a newer renderer read a response from
 * an older service without turning the whole DTO into "unavailable".
 */
/**
 * Validates the structured change view.
 *
 * Returns `undefined` when the field is absent (accepted: the service may be older),
 * `false` when it is present but malformed, and the view when it is valid. A plain
 * string is accepted as the legacy compact encoding so an older service still works.
 */
function sanitizeChangeView(value: unknown): MarketAnalysisChangeView | null | undefined | false {
  if (value === undefined || value === null) return value
  if (isText(value)) return { summary: value, facts: [], missingDomainsAdded: [], missingDomainsRemoved: [], caveatsAdded: 0, caveatsRemoved: 0, evidenceRefsAdded: 0, evidenceRefsRemoved: 0 }
  if (!isExactRecordWithOptionals(value, ['facts', 'missingDomainsAdded', 'missingDomainsRemoved', 'caveatsAdded', 'caveatsRemoved', 'evidenceRefsAdded', 'evidenceRefsRemoved'], ['summary'])) return false
  if (!Array.isArray(value.facts) || value.facts.length > MAX_CHANGE_FACTS) return false
  if (!isTextArray(value.missingDomainsAdded) || !isTextArray(value.missingDomainsRemoved)) return false
  for (const count of [value.caveatsAdded, value.caveatsRemoved, value.evidenceRefsAdded, value.evidenceRefsRemoved]) {
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return false
  }
  const facts = value.facts.map(sanitizeChangeFact)
  if (facts.some(fact => !fact)) return false
  return {
    ...(isText(value.summary) ? { summary: value.summary } : {}),
    facts: facts as MarketAnalysisChangeView['facts'],
    missingDomainsAdded: value.missingDomainsAdded,
    missingDomainsRemoved: value.missingDomainsRemoved,
    caveatsAdded: value.caveatsAdded as number,
    caveatsRemoved: value.caveatsRemoved as number,
    evidenceRefsAdded: value.evidenceRefsAdded as number,
    evidenceRefsRemoved: value.evidenceRefsRemoved as number
  }
}

function sanitizeChangeFact(value: unknown): MarketAnalysisChangeView['facts'][number] | undefined {
  // An added fact has no previous value and a removed fact has no current value, so
  // both keys are optional on the wire. The service always sends them, but rejecting
  // a payload that omits one would turn the whole detail into "unavailable".
  const required = ['domain', 'subject', 'metric', 'unit', 'kind']
  if (!isExactRecordWithOptionals(value, required, ['previousValue', 'value', 'subjectLabel'])) return undefined
  if (!isText(value.domain) || (value.subject !== null && !isText(value.subject)) || !isText(value.metric) ||
    (value.unit !== null && !isText(value.unit)) || !['added', 'removed', 'changed'].includes(value.kind as string)) return undefined
  if (value.subjectLabel !== undefined && value.subjectLabel !== null && !isText(value.subjectLabel)) return undefined
  if (value.previousValue !== undefined && !isNullableScalar(value.previousValue)) return undefined
  if (value.value !== undefined && !isNullableScalar(value.value)) return undefined
  return {
    domain: value.domain,
    subject: value.subject as string | null,
    // Passed through, never invented: the name a reader sees must be the one main resolved, and an
    // older snapshot's absence has to stay an absence so the formatter falls back.
    ...(isText(value.subjectLabel) ? { subjectLabel: value.subjectLabel } : {}),
    metric: value.metric,
    unit: value.unit as string | null,
    kind: value.kind as 'added' | 'removed' | 'changed',
    previousValue: (value.previousValue ?? null) as string | number | null,
    value: (value.value ?? null) as string | number | null
  }
}

function isNullableScalar(value: unknown): boolean {
  return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

function isTextArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isText)
}

function isExactRecordWithOptionals(value: unknown, fields: readonly string[], optional: readonly string[]): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) return false
    const names = Object.getOwnPropertyNames(value)
    return names.every(name => fields.includes(name) || optional.includes(name)) &&
      fields.every((field) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, field)
        return descriptor?.enumerable === true && 'value' in descriptor
      })
  } catch {
    return false
  }
}

function isExactRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) return false
    const names = Object.getOwnPropertyNames(value)
    return names.length === fields.length && fields.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field)
      return descriptor?.enumerable === true && 'value' in descriptor
    })
  } catch {
    return false
  }
}

/**
 * Reads a list the renderer displays, truncating it to `limit` instead of rejecting a long one.
 *
 * Length is a rendering bound, never a validity rule. `isStringList` used to reject anything past
 * fifty items, so a summary that cited sixty-two evidence rows — the newest and richest analysis in
 * the store — turned its whole detail into 「最新结论详情暂不可用」, and the card healed by itself only
 * when a later, smaller run became the newest node. Only a malformed item fails now.
 */
function readStringList(value: unknown, limit: number): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.slice(0, limit)
  return items.every(isText) ? items as readonly string[] : undefined
}

/**
 * Reads a stored list of references (evidence and fact identifiers).
 *
 * These are counted rather than drawn, so they never reach a screen and are not truncated: the
 * audit "证据数量" has to be the number the run actually cited instead of a page-sized cap.
 */
function readReferenceList(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every(isText) ? value as readonly string[] : undefined
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT_LENGTH
}

function isCanonicalTime(value: unknown): value is string {
  if (!isText(value) || !CANONICAL_UTC_MILLIS.test(value)) return false
  try { return new Date(value).toISOString() === value } catch { return false }
}

function unavailable(): { state: 'unavailable' } {
  return { state: 'unavailable' }
}
