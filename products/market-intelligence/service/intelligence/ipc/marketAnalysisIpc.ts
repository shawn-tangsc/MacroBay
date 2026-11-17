import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import { MARKET_ANALYSIS_IPC_METHODS, isNewsInterpretationReadInput, isNewsInterpretationRequestInput, type NewsInterpretationReadResult, type NewsInterpretationRequestResult } from '../../../contracts/marketAnalysisIpcContracts'
import { createAnalysisTimelineService } from '../analysis/analysisTimelineService'
import { macroCalendarEventContextReaders, type MacroCalendarEventContextQuerySources } from '../public-query/macroCalendarEventContextReaders'
import { macroCalendarEventContextFromReads } from '../public-query/macroCalendarEventContextAdapter'
import { isMarketAnalysisCalendarEventContextInput, isMarketAnalysisSettingsPatchInput, type MarketAnalysisCalendarEventContextInput } from '../../../contracts/marketAnalysisIpcContracts'
import type { MarketAnalysisRepository } from '../store/marketAnalysisRepository'
import { createAnalysisFollowUpSession, type AnalysisSessionDependencies } from '../analysis/analysisFollowUpSession'
import { MARKET_ANALYSIS_ERROR_CODES } from '../../../contracts/marketAnalysisContracts'

const PRODUCT_ID = 'market-intelligence'

import type { AnalysisTriggerSource } from '../analysis/analysisTriggerSourcePolicy'
import type { MarketAnalysisSettings } from '../application/marketAnalysisSettings'

export function registerMarketAnalysisIpc(register: ProductIpcRegistrar, repository: MarketAnalysisRepository,
  /** The two calendar month queries, so a selected event's context can be read on demand. */
  calendar: MacroCalendarEventContextQuerySources = {},
  sessions: AnalysisSessionDependencies & {
    requestInitialAnalysis?: (itemId: string | undefined, retryRunId: string | undefined, mode: 'initial' | 'refresh', source: AnalysisTriggerSource) => Promise<{ itemId: string; queued: true }>
    /** 只读：这条新闻有没有已有解读、是哪份证据的（R37）。 */
    readNewsInterpretation?: (itemId: string) => Promise<NewsInterpretationReadResult>
    /** 写：按这条新闻发起一次解读（R37 §1.1）。 */
    requestNewsInterpretation?: (itemId: string) => Promise<NewsInterpretationRequestResult>
    /** 读者时区：时间线的「哪个开盘」按它换算。 */
    timeZone?: () => string
    getAnalysisSettings?: () => Promise<MarketAnalysisSettings>
    updateAnalysisSettings?: (patch: Readonly<{ enabled?: boolean; providerId?: string; modelId?: string }>) => Promise<MarketAnalysisSettings>
  } = {}): void {
  const service = createAnalysisTimelineService({
    repository,
    timeZone: sessions.timeZone ?? (() => 'UTC'),
    createFollowUpSession: createAnalysisFollowUpSession(sessions)
  })
  register(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.listTimeline, (payload) => service.listTimeline(asTimelineInput(payload)))
  register(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.getTimelineEntry, (payload) => service.getTimelineEntry(requiredId(payload, 'id')))
  register(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.getAnalysisRun, (payload) => service.getAnalysisRun(requiredId(payload, 'id')))
  register(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.getSummary, (payload) => service.getSummary(requiredId(payload, 'id')))
  register(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.listPredictions, (payload) => service.listPredictions(requiredId(payload, 'summaryId')))
  register(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.getWorkspaceBinding, (payload) => {
    const eventGroupId = requiredId(payload, 'eventGroupId')
    const group = repository.getEventGroup(eventGroupId)
    if (!group?.currentSummaryId) throw new Error('analysis-not-available')
    const summary = repository.getSummary(group.currentSummaryId)
    if (!summary) throw new Error('analysis-not-available')
    return { agentId: 'crypto-market-analyst', eventGroupId, analysisRunId: summary.analysisRunId, summaryId: summary.id }
  })
  register(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.startFollowUp, (payload) => service.startFollowUp(asFollowUpInput(payload)))
  register(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.calendarEventContext, (payload) =>
    macroCalendarEventContextFromReads(macroCalendarEventContextReaders(calendar), asCalendarEventContextInput(payload)))
  register(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.getLatestAttempt, () => {
    // 只认市场线的最近一次运行（R39 §5.3）：否则一条新闻解读会冒充「最近一次尝试」。
    const run = repository.records.latestAttempt({ analysisKind: 'market' })
    if (!run) return null
    const knownCode = Object.values(MARKET_ANALYSIS_ERROR_CODES).find(code => code === run.failureCode)
    return { id: run.id, status: run.status, failureCode: run.failureCode ? knownCode ?? 'analysis-provider-error' : null,
      queuedAt: run.queuedAt, evidenceCount: repository.getSnapshot(run.snapshotId)?.evidenceRefs.length ?? 0 }
  })
  register(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.getSettings, async () => {
    if (!sessions.getAnalysisSettings) throw new Error('analysis-settings-unavailable')
    return sessions.getAnalysisSettings()
  })
  register(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.saveSettings, async (payload) => {
    if (!sessions.updateAnalysisSettings) throw new Error('analysis-settings-unavailable')
    if (!isMarketAnalysisSettingsPatchInput(payload)) throw new Error('analysis-invalid-request')
    return sessions.updateAnalysisSettings(payload)
  })
  register(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.requestInitialAnalysis, async (payload) => {
    if (!sessions.requestInitialAnalysis) throw new Error('analysis-initial-request-unavailable')
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => !['retryRunId', 'mode', 'eventGroupId'].includes(key))) throw new Error('analysis-invalid-request')
    const retryRunId = (payload as { retryRunId?: unknown }).retryRunId
    if (retryRunId !== undefined && (typeof retryRunId !== 'string' || !retryRunId)) throw new Error('analysis-invalid-request')
    const mode = (payload as { mode?: unknown }).mode
    if (mode !== undefined && mode !== 'initial' && mode !== 'refresh') throw new Error('analysis-invalid-request')
    if (mode === 'refresh' && retryRunId !== undefined) throw new Error('analysis-invalid-request')
    const eventGroupId = (payload as { eventGroupId?: unknown }).eventGroupId
    if (eventGroupId !== undefined) {
      // 「重新生成这一条」：同一事件组再分析一次，产生**新**记录；旧记录不动（结论可追溯）。
      // 仍走这一个入口——不是新 IPC，也不在旧记录上覆盖。
      if (typeof eventGroupId !== 'string' || !eventGroupId || retryRunId !== undefined || mode !== undefined) throw new Error('analysis-invalid-request')
      const group = repository.getEventGroup(eventGroupId)
      const itemId = group?.eventRefs[0]
      if (!itemId) throw new Error('analysis-not-eligible')
      return sessions.requestInitialAnalysis(itemId, undefined, 'refresh', 'manual')
    }
    return sessions.requestInitialAnalysis(undefined, retryRunId, (mode ?? 'initial') as 'initial' | 'refresh', 'manual')
  })
  register(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.readNewsInterpretation, async (payload) => {
    // 每条命令自己的载荷校验：不认识的形状一律边界错误，不做兼容读取器。
    if (!isNewsInterpretationReadInput(payload)) throw new Error('market-analysis-invalid-input')
    if (!sessions.readNewsInterpretation) throw new Error('analysis-initial-request-unavailable')
    return sessions.readNewsInterpretation(payload.itemId)
  })
  register(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.requestNewsInterpretation, async (payload) => {
    if (!isNewsInterpretationRequestInput(payload)) throw new Error('market-analysis-invalid-input')
    if (!sessions.requestNewsInterpretation) throw new Error('analysis-initial-request-unavailable')
    return sessions.requestNewsInterpretation(payload.itemId)
  })
}

function asTimelineInput(payload: unknown): { eventGroupId?: string; cursor?: string | null; limit?: number } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
  const value = payload as Record<string, unknown>
  if (value.eventGroupId !== undefined && (typeof value.eventGroupId !== 'string' || !value.eventGroupId)) throw new Error('analysis-invalid-request')
  if (value.cursor !== undefined && value.cursor !== null && (typeof value.cursor !== 'string' || !value.cursor)) throw new Error('analysis-invalid-cursor')
  if (value.limit !== undefined && (!Number.isSafeInteger(value.limit) || Number(value.limit) < 1 || Number(value.limit) > 50)) throw new Error('analysis-invalid-request')
  return { ...(typeof value.eventGroupId === 'string' ? { eventGroupId: value.eventGroupId } : {}), ...(typeof value.cursor === 'string' ? { cursor: value.cursor } : {}), ...(value.cursor === null ? { cursor: null } : {}), ...(typeof value.limit === 'number' ? { limit: value.limit } : {}) }
}

function requiredId(payload: unknown, key: string): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('analysis-invalid-request')
  const value = (payload as Record<string, unknown>)[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error('analysis-invalid-request')
  return value
}

function asCalendarEventContextInput(payload: unknown): MarketAnalysisCalendarEventContextInput {
  // Same throw style as the other guards in this file.
  if (!isMarketAnalysisCalendarEventContextInput(payload)) throw new Error('analysis-invalid-request')
  return payload
}

function asFollowUpInput(payload: unknown): { eventGroupId: string; analysisRunId: string; existingSessionId?: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('analysis-invalid-request')
  const value = payload as Record<string, unknown>
  if (Object.keys(value).some(key => !['eventGroupId', 'analysisRunId', 'existingSessionId'].includes(key))) throw new Error('analysis-invalid-request')
  if (typeof value.eventGroupId !== 'string' || !value.eventGroupId || typeof value.analysisRunId !== 'string' || !value.analysisRunId) throw new Error('analysis-invalid-request')
  if (value.existingSessionId !== undefined && (typeof value.existingSessionId !== 'string' || !value.existingSessionId)) throw new Error('analysis-invalid-request')
  return {
    eventGroupId: value.eventGroupId,
    analysisRunId: value.analysisRunId,
    ...(typeof value.existingSessionId === 'string' ? { existingSessionId: value.existingSessionId } : {})
  }
}

/**
 * 按条「AI 解读」的两条命令接到哪个运行时方法上（R37）。
 *
 * 与 IPC 注册放在一处：注册的会话契约变了，这里跟着变；装配文件只交一次。两条一起给，免得接了
 * 一条忘了另一条。
 */
type NewsInterpretationSessions = Readonly<{
  readNewsInterpretation: (itemId: string) => Promise<NewsInterpretationReadResult>
  requestNewsInterpretation: (itemId: string) => Promise<NewsInterpretationRequestResult>
}>

export function newsInterpretationWiring(runtime: NewsInterpretationSessions): NewsInterpretationSessions {
  return {
    readNewsInterpretation: itemId => runtime.readNewsInterpretation(itemId),
    requestNewsInterpretation: itemId => runtime.requestNewsInterpretation(itemId)
  }
}
