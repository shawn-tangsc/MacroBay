/**
 * `marketAnalysisTimelineClient` 的形状校验：IPC 回来的东西一律当作 `unknown`，逐字段验，
 * 不合形状就判「读不到」（返回 `undefined` / `null`），绝不放行半成品给渲染层。
 *
 * 2026-11-16 从客户端文件里整块搬出来（那一个文件 579 行、基线 570，只许变小）：判据、
 * 上限常量、白名单、注释全部原样搬，客户端只留「调 IPC + 交给校验器」。
 * 类型反向以 `import type` 取：运行时不构成环。
 */
import { MARKET_ANALYSIS_CONTRACT_POLICY } from '../../../contracts/marketAnalysisContracts'
import type { AnalysisConclusion, AnalysisConclusionDirection } from '../../../contracts/marketAnalysisContracts'
import { SUMMARY_OPTIONAL_FIELDS, SUMMARY_REQUIRED_FIELDS } from './marketAnalysisSummaryWhitelist'
import { marketAnalysisTimelineLimits, timelineItemsWithinLimit } from '../../../contracts/marketAnalysisTimelineLimits'
import type {
  MarketAnalysisChangeView,
  MarketAnalysisSettingsView,
  MarketAnalysisTimelineDetail,
  MarketAnalysisTimelineEntry,
  MarketAnalysisTimelinePage,
  MarketAnalysisTriggerStatus
} from './marketAnalysisTimelineClient'

/**
 * 一页的上限不是「页面大小」：首页还会补进最多 20 条还没发布的运行，两者相加才是传输上限。
 * 数字与理由都在 `contracts/marketAnalysisTimelineLimits`（服务侧读同一组数）。
 */
const MAX_PAGE_ITEMS = marketAnalysisTimelineLimits.maximumItems

/**
 * 一条结论里最多渲染多少行（事实 / 传导 / 证据 / 预测）。这是**版面与读屏的渲染上限**，
 * 与「一页时间轴能放几条」是两件事——它们曾经共用过一个常量，于是把页面容差提到 70 时
 * 顺手把这里也放宽了，既有用例当场红（`knownFacts` 54 条不再被截到 50）。各归各位。
 */
const MAX_RENDERED_ROWS = 50
/**
 * Bound on a list the model authored: the same ceiling the summary validator upstream enforces, so
 * this side can never refuse a collection the service itself accepted.
 */
const MAX_MODEL_LIST_ITEMS = MARKET_ANALYSIS_CONTRACT_POLICY.maximumCollectionItems
/** Bound on the change list a run detail may carry, mirroring the frozen record. */
const MAX_CHANGE_FACTS = 200
const MAX_TEXT_LENGTH = 2_000
const CANONICAL_UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u

export function sanitizeSettings(value: unknown): MarketAnalysisSettingsView | undefined {
  if (!isExactRecord(value, ['enabled', 'providerId', 'modelId', 'updatedAt'])) return undefined
  // Empty model halves are a real state (nothing chosen yet), so they are strings, not "text".
  if (typeof value.enabled !== 'boolean' || typeof value.providerId !== 'string' || typeof value.modelId !== 'string' ||
    value.providerId.length > MAX_TEXT_LENGTH || value.modelId.length > MAX_TEXT_LENGTH || !isCanonicalTime(value.updatedAt)) return undefined
  return { enabled: value.enabled, providerId: value.providerId, modelId: value.modelId, updatedAt: value.updatedAt }
}

export function sanitizePage(value: unknown): { state: 'available'; page: MarketAnalysisTimelinePage } | undefined {
  if (!isExactRecord(value, ['schemaVersion', 'items', 'nextCursor']) || value.schemaVersion !== 1 || !Array.isArray(value.items) || !timelineItemsWithinLimit(value.items.length) || (value.nextCursor !== null && !isText(value.nextCursor))) return undefined
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
export const explainableTriggerReasonCodes: readonly string[] = Object.freeze(['significance-confirmed', 'significance-below-threshold', 'calendar-unavailable', 'provider-surprise-confirmed', 'semantic-no-op', 'interval-active', 'same-release-coalesced', 'same-release-abandoned', 'hour-budget-exhausted', 'day-budget-exhausted', 'global-day-budget-exhausted', 'schedule-reserve-exhausted', 'session-slot-asia', 'session-slot-europe', 'session-slot-us', 'invalid-significance-input', 'manual-request', 'severity-confirmed', 'medium-score-confirmed', 'market-reaction-confirmed', 'restart-initial-compensated', 'restart-review-compensated', 'signal-high-triggered', 'signal-medium-triggered', 'signal-cooldown-active', 'signal-low-marker-only', 'signal-calendar-owned', 'signal-freeze-unavailable'])

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
  //
  // `runKey` / `failureCode` and the two run states (`running` / `failed`) are the same kind of
  // addition: an older main process never sends them, and a renderer that demanded them would
  // turn a whole page into "unavailable" instead of one row without a key.
  if (!isExactRecordWithOptionals(value, ['id', 'eventGroupId', 'analysisRunId', 'kind', 'status', 'occurredAt', 'summaryRef', 'safeTitle', 'safeExcerpt', 'version'], ['triggerStatus', 'direction', 'groupType', 'groupSubject', 'runKey', 'failureCode']) ||
    !isText(value.id) || !isText(value.eventGroupId) || (value.analysisRunId !== null && !isText(value.analysisRunId)) ||
    !['event', 'analysis', 'review', 'prediction-update', 'system'].includes(value.kind as string) ||
    !['published', 'stale', 'superseded', 'running', 'failed'].includes(value.status as string) || !isCanonicalTime(value.occurredAt) ||
    (value.summaryRef !== null && !isText(value.summaryRef)) || !titleIsReadable(value.status as string, value.safeTitle) ||
    (value.safeExcerpt !== null && !isText(value.safeExcerpt)) || typeof value.version !== 'number' || !Number.isSafeInteger(value.version) || value.version < 1) return undefined
  const optional = value as { groupType?: unknown; groupSubject?: unknown; runKey?: unknown; failureCode?: unknown }
  return {
    ...(value as MarketAnalysisTimelineEntry),
    direction: sanitizeDirectionKey((value as { direction?: unknown }).direction) ?? null,
    triggerStatus: sanitizeTriggerStatus((value as { triggerStatus?: unknown }).triggerStatus),
    // Both are optional against an older main process, and a non-text value is dropped rather than
    // rendered: the panel prints these strings directly.
    groupType: isText(optional.groupType) ? optional.groupType : null,
    groupSubject: isText(optional.groupSubject) ? optional.groupSubject : null,
    // 运行词与失败码：`runKey` 老主进程没有就整字段不出现（界面按 `analysisRunId ?? id` 退）；
    // `failureCode` 同理——没发就不出现，发了但不是文本按「没有」处理。宁可少一个键，
    // 也不把一个来路不明的串印到读者面前；老载荷的形状也因此逐字节不变。
    ...(isText(optional.runKey) ? { runKey: optional.runKey } : {}),
    ...(optional.failureCode === undefined ? {} : { failureCode: isText(optional.failureCode) ? optional.failureCode : null })
  }
}

/**
 * 标题可读性：发布行必须有标题（`safeTitle` 是读者看的那一行字）；**`running` / `failed` 行
 * 没有摘要，服务侧按约定给空串**，此时标题由状态词承担（「正在解析」/「解析失败」走文案键）。
 * 只给这两档开这个口子，其余状态多一个空标题就整条丢掉——那是坏数据，不是无标题。
 */
function titleIsReadable(status: string, title: unknown): boolean {
  if (status === 'running' || status === 'failed') return title === '' || isText(title)
  return isText(title)
}

export function sanitizeDetail(entry: MarketAnalysisTimelineEntry, run: unknown, summary: unknown, predictions: unknown): { state: 'available'; detail: MarketAnalysisTimelineDetail } | undefined {
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

export function sanitizeSummary(value: unknown): MarketAnalysisTimelineDetail['summary'] | undefined {
  // 白名单只从 `marketAnalysisSummaryWhitelist` 读（守卫用例与这里同一份）。可选键缺席一律不判错：
  // 两种契约世代的摘要都要能渲染，少一个可选字段不许把详情变成「读不到」。
  if (!isExactRecordWithOptionals(value, SUMMARY_REQUIRED_FIELDS, SUMMARY_OPTIONAL_FIELDS) ||
    (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3) ||
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
  // `proseLanguage` 只认这两种；旧记录没有它、脏值也不认（不标注），但都不影响详情可用。
  const proseLanguage = value.proseLanguage === 'zh-CN' || value.proseLanguage === 'en-US' ? value.proseLanguage : undefined
  return {
    id: value.id,
    version: value.version,
    ...(eventAssessment ? { eventAssessment } : {}),
    ...(conclusion ? { conclusion } : {}),
    ...(proseLanguage ? { proseLanguage } : {}),
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
  // `newsImpact` 是 R37 加给按条解读的字段（schema 3）：详情抽屉不渲染它，但它存在时
  // 不能把整份结论判成不可读——多一个可选字段就让时间轴详情打不开，是今天线上那次
  // 「读取失败」的直接原因。
  if (!isExactRecordWithOptionals(value, ['direction', 'summary', 'change', 'causalChain', 'conditions', 'macro', 'evidenceStrength', 'dataGaps'], ['newsImpact'])) return false
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
    ? (directions as NonNullable<MarketAnalysisTimelineDetail['summary']['directions']>).slice(0, MAX_RENDERED_ROWS)
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
  return claims.some(item => !item) ? undefined : (claims as readonly Readonly<{ statement: string }>[]).slice(0, MAX_RENDERED_ROWS)
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
  return predictions.some((item) => !item) ? undefined : (predictions as MarketAnalysisTimelineDetail['predictions']).slice(0, MAX_RENDERED_ROWS)
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

export function isExactRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
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

export function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT_LENGTH
}

export function isCanonicalTime(value: unknown): value is string {
  if (!isText(value) || !CANONICAL_UTC_MILLIS.test(value)) return false
  try { return new Date(value).toISOString() === value } catch { return false }
}
