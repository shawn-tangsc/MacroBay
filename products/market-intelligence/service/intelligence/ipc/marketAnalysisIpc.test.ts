import { describe, expect, it, vi } from 'vitest'

import { MARKET_ANALYSIS_IPC_METHODS } from '../../../contracts/marketAnalysisIpcContracts'
import { registerMarketAnalysisIpc } from './marketAnalysisIpc'

const timelineEntry = {
  id: 'mi-tl-1', schemaVersion: 1 as const, eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1',
  kind: 'analysis' as const, status: 'published' as const, occurredAt: '2026-09-28T00:00:00.000Z',
  summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '摘要', version: 1
}

function harness() {
  const handlers = new Map<string, (payload: unknown) => unknown | Promise<unknown>>()
  const repository = {
    listTimeline: vi.fn((input: { eventGroupId?: string; cursor?: string | null; limit?: number }) => ({
      items: input.cursor === 'opaque-next' ? [] : [timelineEntry], nextCursor: input.cursor ? null : 'opaque-next'
    })),
    getTimelineEntry: vi.fn(() => timelineEntry),
    listRuns: vi.fn(() => [{ id: 'mi-ar-failed', eventGroupId: 'mi-eg-1', status: 'invalid-output', failureCode: 'analysis-invalid-output-schema', queuedAt: '2026-09-28T00:00:00.000Z', snapshotId: 'mi-es-1', privateBody: 'never-display' }]),
    getEventGroup: vi.fn((id: string) => id === 'mi-eg-1' ? { id, currentSummaryId: 'mi-as-1' } : undefined),
    getRun: vi.fn(() => ({
      id: 'mi-ar-1', eventGroupId: 'mi-eg-1', analysisPhase: 'initial' as const, status: 'succeeded' as const,
      failureCode: null, queuedAt: '2026-09-28T00:00:00.000Z', startedAt: '2026-09-28T00:00:01.000Z', completedAt: '2026-09-28T00:00:02.000Z'
    })),
    getSnapshot: vi.fn(() => ({ asOf: '2026-09-28T00:00:00.000Z', dataCutoff: '2026-09-28T00:00:00.000Z', evidenceRefs: ['evidence-1'] })),
    getSummaryForRun: vi.fn(() => ({ id: 'mi-as-1', analysisRunId: 'mi-ar-1', eventGroupId: 'mi-eg-1' })),
    getSummary: vi.fn(() => ({
      id: 'mi-as-1', schemaVersion: 1 as const, analysisRunId: 'mi-ar-1', eventGroupId: 'mi-eg-1', version: 1,
      eventAssessment: '市场情绪偏谨慎', knownFacts: [], transmissionHypotheses: [], marketReaction: [],
      supportingEvidence: [], counterEvidence: [], scenarios: [], nextCatalysts: [], dataCaveats: [], evidenceRefs: [], createdAt: '2026-09-28T00:00:02.000Z'
    })),
    listPredictions: vi.fn(() => [{
      id: 'mi-pr-1', summaryId: 'mi-as-1', asset: 'BTC' as const, horizonStart: '2026-09-28T00:00:00.000Z',
      horizonEnd: '2026-09-28T01:00:00.000Z', baseCase: '震荡', conditions: [], invalidation: '跌破',
      nextCatalyst: null, status: 'pending' as const, verificationDueAt: '2026-09-28T01:00:00.000Z', createdAt: '2026-09-28T00:00:02.000Z'
    }])
  }
  registerMarketAnalysisIpc((productId, method, handler) => {
    expect(productId).toBe('market-intelligence')
    handlers.set(method, handler)
  }, repository as never)
  return { handlers, repository }
}

describe('marketAnalysisIpc', () => {
  it('returns the latest persisted attempt without private provider or snapshot content', () => {
    const { handlers } = harness()
    expect(handlers.get('marketAnalysis.getLatestAttempt')?.({})).toEqual({
      id: 'mi-ar-failed', status: 'invalid-output', failureCode: 'analysis-invalid-output-schema', queuedAt: '2026-09-28T00:00:00.000Z', evidenceCount: 1
    })
  })
  it('supports timeline pagination through the product IPC boundary', async () => {
    const { handlers, repository } = harness()
    expect(handlers.get(MARKET_ANALYSIS_IPC_METHODS.listTimeline)?.({ eventGroupId: 'mi-eg-1', limit: 1 })).toEqual({
      schemaVersion: 1, items: [expect.objectContaining({ id: 'mi-tl-1' })], nextCursor: 'opaque-next'
    })
    expect(handlers.get(MARKET_ANALYSIS_IPC_METHODS.listTimeline)?.({ eventGroupId: 'mi-eg-1', cursor: 'opaque-next', limit: 1 })).toMatchObject({ items: [], nextCursor: null })
    expect(repository.listTimeline).toHaveBeenNthCalledWith(2, { eventGroupId: 'mi-eg-1', cursor: 'opaque-next', limit: 1 })
  })

  it('rejects malformed cursor and invalid event-group payloads before repository access', async () => {
    const { handlers, repository } = harness()
    expect(() => handlers.get(MARKET_ANALYSIS_IPC_METHODS.listTimeline)?.({ cursor: 7 })).toThrow('analysis-invalid-cursor')
    expect(() => handlers.get(MARKET_ANALYSIS_IPC_METHODS.listTimeline)?.({ eventGroupId: '' })).toThrow('analysis-invalid-request')
    expect(() => handlers.get(MARKET_ANALYSIS_IPC_METHODS.getWorkspaceBinding)?.({ eventGroupId: 'missing' })).toThrow('analysis-not-available')
    expect(repository.listTimeline).not.toHaveBeenCalled()
  })

  it('returns safe timeline, run, summary, prediction and workspace DTOs', async () => {
    const { handlers } = harness()
    expect(handlers.get(MARKET_ANALYSIS_IPC_METHODS.getTimelineEntry)?.({ id: 'mi-tl-1' })).toEqual(expect.objectContaining({ id: 'mi-tl-1' }))
    expect(handlers.get(MARKET_ANALYSIS_IPC_METHODS.getAnalysisRun)?.({ id: 'mi-ar-1' })).toEqual(expect.objectContaining({ id: 'mi-ar-1', status: 'succeeded', evidenceCount: 1 }))
    expect(handlers.get(MARKET_ANALYSIS_IPC_METHODS.getSummary)?.({ id: 'mi-as-1' })).toEqual(expect.objectContaining({ id: 'mi-as-1', version: 1 }))
    expect(handlers.get(MARKET_ANALYSIS_IPC_METHODS.listPredictions)?.({ summaryId: 'mi-as-1' })).toEqual([expect.objectContaining({ id: 'mi-pr-1', status: 'pending' })])
    expect(handlers.get(MARKET_ANALYSIS_IPC_METHODS.getWorkspaceBinding)?.({ eventGroupId: 'mi-eg-1' })).toEqual({ agentId: 'crypto-market-analyst', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', summaryId: 'mi-as-1' })
    console.log(JSON.stringify({ marker: 'MI_ANALYSIS_ACCEPTANCE', package: 'MI-A06', event: 'timeline-ipc', status: 'pass', details: { pageItems: 1, nextCursor: false, summaryVersion: 1, predictionStatus: 'pending', followUpSessionCreated: false } }))
  })

  it('validates the follow-up binding before reporting that the Agent is not yet enabled', async () => {
    const { handlers } = harness()
    await expect(handlers.get(MARKET_ANALYSIS_IPC_METHODS.startFollowUp)?.({ eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1' })).rejects.toThrow('analysis-follow-up-unavailable')
    expect(() => handlers.get(MARKET_ANALYSIS_IPC_METHODS.startFollowUp)?.({ eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', extra: true })).toThrow('analysis-invalid-request')
  })
})
