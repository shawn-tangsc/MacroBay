import type { AnalysisConclusion, AnalysisConclusionDirection } from '../../../contracts/marketAnalysisContracts'
import {
  MARKET_ANALYSIS_IPC_METHODS
} from '../../../contracts/marketAnalysisIpcContracts'
import {
  isCanonicalTime,
  isExactRecord,
  isText,
  sanitizeDetail,
  sanitizePage,
  sanitizeSettings
} from './marketAnalysisTimelineSanitizers'
import { listUnavailable, readFailureReason, unavailable, type MarketAnalysisTimelineReadFailure } from './marketAnalysisTimelineReadFailure'

// 「渲染层能认哪些触发原因码」随校验器一起搬进了 `marketAnalysisTimelineSanitizers`；
// 这一处对外名字与路径不变（多处引用从这里取）。
export { explainableTriggerReasonCodes } from './marketAnalysisTimelineSanitizers'

const PRODUCT_ID = 'market-intelligence'

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

export type MarketAnalysisAttempt = Readonly<{ id: string; status: string; failureCode: string | null; queuedAt: string; evidenceCount: number }>

export type MarketAnalysisTimelineEntry = Readonly<{
  id: string
  eventGroupId: string
  analysisRunId: string | null
  kind: 'event' | 'analysis' | 'review' | 'prediction-update' | 'system'
  /** 还没发布或没跑成：`running` / `failed`（不用 `pending`——那是预测条目的「待验证」）。 */
  status: 'published' | 'stale' | 'superseded' | 'running' | 'failed'
  /** 同一次运行不变的键：`running` → `published`/`failed`，界面靠它就地换状态；缺省退 `analysisRunId ?? id`。 */
  runKey?: string
  /** 运行自己的失败码（只对 `failed` 行有意义）；未知码由界面兜一句「解析失败」，不印码。 */
  failureCode?: string | null
  occurredAt: string
  summaryRef: string | null
  safeTitle: string
  safeExcerpt: string | null
  /** Language-neutral direction key published with the entry, when the summary has one. */
  direction?: AnalysisConclusionDirection | null
  version: number
  /** Why the newest automatic decision happened, or why it did not; tokens only. */
  triggerStatus: MarketAnalysisTriggerStatus | null
  /** Which kind of event this row belongs to; null against an older main process. */
  groupType: string | null
  /** The group's own subject, so two rows published seconds apart are told apart. */
  groupSubject: string | null
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
    /** v2 摘要记录正文的生成语言；旧记录没有这个字段。 */
    proseLanguage?: 'zh-CN' | 'en-US'
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
  listTimeline: (input?: { cursor?: string }) => Promise<{ state: 'available'; page: MarketAnalysisTimelinePage } | { state: 'unavailable'; reason: MarketAnalysisTimelineReadFailure }>
  /**
   * 既有入口：`retryRunId` 重跑失败的那次；`mode: 'refresh'` 为同一事件组再分析一次；
   * `eventGroupId` 让「重新生成」指着读者正在看的那一组，而不是「最近一条」。
   */
  requestInitialAnalysis: (retryRunId?: string, mode?: 'initial' | 'refresh', eventGroupId?: string) => Promise<{ state: 'queued'; itemId: string } | { state: 'unavailable'; reason: 'not-eligible' | 'not-ready' | 'failed' | 'already-available' }>
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
      // 没有 preload 桥就是模块没起来，与「读到了但没内容」是两件事。
      if (!window.platform?.products?.invoke) return listUnavailable('product-runtime-unavailable')
      return sanitizePage(await window.platform.products.invoke(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.listTimeline, input)) ?? listUnavailable('read-failed')
    } catch (error) {
      // 原因不吞：吞掉就变成一句无原因的「读不到」，界面只能靠猜，最后画成「暂无」。
      return listUnavailable(readFailureReason(error))
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
  async requestInitialAnalysis(retryRunId, mode = 'initial', eventGroupId) {
    try {
      if (!window.platform?.products?.invoke) return { state: 'unavailable', reason: 'failed' }
      const payload = eventGroupId ? { eventGroupId } : retryRunId ? { retryRunId } : mode === 'refresh' ? { mode } : {}
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
