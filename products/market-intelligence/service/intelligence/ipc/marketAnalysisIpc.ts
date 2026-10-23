import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import { MARKET_ANALYSIS_IPC_METHODS } from '../../../contracts/marketAnalysisIpcContracts'
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
    getAnalysisSettings?: () => Promise<MarketAnalysisSettings>
    updateAnalysisSettings?: (patch: Readonly<{ enabled?: boolean; providerId?: string; modelId?: string }>) => Promise<MarketAnalysisSettings>
  } = {}): void {
  const service = createAnalysisTimelineService({ repository, createFollowUpSession: createAnalysisFollowUpSession(sessions) })
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
    const run = repository.listRuns()[0]
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
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => !['retryRunId', 'mode'].includes(key))) throw new Error('analysis-invalid-request')
    const retryRunId = (payload as { retryRunId?: unknown }).retryRunId
    if (retryRunId !== undefined && (typeof retryRunId !== 'string' || !retryRunId)) throw new Error('analysis-invalid-request')
    const mode = (payload as { mode?: unknown }).mode
    if (mode !== undefined && mode !== 'initial' && mode !== 'refresh') throw new Error('analysis-invalid-request')
    if (mode === 'refresh' && retryRunId !== undefined) throw new Error('analysis-invalid-request')
    return sessions.requestInitialAnalysis(undefined, retryRunId, (mode ?? 'initial') as 'initial' | 'refresh', 'manual')
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
