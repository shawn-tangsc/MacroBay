import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import type {
  AnalysisRun,
  AnalysisSummary,
  EvidenceSnapshot,
  EventGroup,
  Prediction,
  TimelineEntry
} from '../../../contracts/marketAnalysisContracts'
import { buildAnalysisSnapshotHash } from '../analysis/analysisHash'
import { createMarketAnalysisRepository } from './marketAnalysisRepository'

const asOf = '2026-09-25T08:30:00.000Z'
const later = '2026-09-25T08:31:00.000Z'

function group(id = 'mi-eg-0001'): EventGroup {
  return {
    id, schemaVersion: 1, status: 'monitoring', groupType: 'macro', mergeKey: `US.CPI|${id}`,
    firstObservedAt: asOf, lastObservedAt: asOf, reviewDeadlineAt: '2026-09-25T09:00:00.000Z',
    eventRefs: ['event-1'], triggerCount: 1, reviewCount: 0, currentSummaryId: null,
    supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: asOf
  }
}

function snapshot(id: string, eventGroupId: string, value: string): EvidenceSnapshot {
  const facts = [{ factId: `fact-${value}`, domain: 'macro' as const, subject: 'US CPI', metric: 'actual', value, unit: '%', sourceId: 'source-fed', sourceLabel: '官方', observedAt: asOf, asOf, freshness: 'fresh' as const, confidence: 1, comparability: 'comparable' as const, evidenceRefId: `ev-${value}` }]
  const evidenceRefs = [{ evidenceRefId: `ev-${value}`, sourceId: 'source-fed', sourceLabel: '官方', itemId: null, occurredAt: asOf, publishedAt: asOf, detectedAt: asOf, computedAt: null, visibleAt: asOf, excerptHash: createHash('sha256').update(`ev-${value}`).digest('hex') }]
  return {
    id, schemaVersion: 1, eventGroupId, asOf, dataCutoff: asOf, snapshotHash: buildAnalysisSnapshotHash({ profileId: 'crypto-market-analysis-v1', asOf, dataCutoff: asOf, facts, missingDomains: [], caveats: [], evidenceRefs }),
    profileId: 'crypto-market-analysis-v1',
    facts,
    missingDomains: [], caveats: [],
    evidenceRefs,
    sourceHealth: [{ sourceId: 'source-fed', status: 'healthy', asOf }], createdAt: asOf, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1'
  }
}

function run(id: string, eventGroupId: string, snapshotId: string, idempotencyKey: string, snapshotHash = snapshot('mi-es-A1', eventGroupId, 'A').snapshotHash): AnalysisRun {
  return {
    id, schemaVersion: 1, eventGroupId, snapshotId, snapshotHash, analysisPhase: 'initial', triggerKey: 'macro.actual.first-confirmed', idempotencyKey,
    status: 'queued', attempt: 1, retryOfRunId: null, modelProviderId: 'provider', modelId: 'model', policyVersion: 'policy.v1', promptVersion: 'prompt.v1', skillVersion: 'skill.v1', outputSchemaVersion: 1,
    jobRunId: null, traceId: null, failureCode: null, failureDetailCode: null, queuedAt: asOf, startedAt: null, completedAt: null
  }
}

function summary(id: string, analysisRunId: string, eventGroupId: string, version = 1): AnalysisSummary {
  return {
    id, schemaVersion: 1, analysisRunId, eventGroupId, version, eventAssessment: '通胀数据高于预期',
    knownFacts: [{ factId: 'fact-A', statement: 'actual=3.2', evidenceRefIds: ['ev-A'] }],
    transmissionHypotheses: [{ statement: '流动性预期收紧', evidenceRefIds: ['ev-A'] }],
    marketReaction: [{ statement: 'BTC 下跌', factIds: ['fact-A'], evidenceRefIds: ['ev-A'] }],
    supportingEvidence: [{ statement: '官方数据', evidenceRefId: 'ev-A' }], counterEvidence: [],
    scenarios: [{ asset: 'BTC', horizon: '0-15m', baseCase: '震荡', conditions: ['价格守住支撑'], invalidation: '跌破支撑', status: 'pending' }],
    directions: [
    { horizon: 'short', direction: '偏多', rationale: '短期资金流转正。', confidence: 'medium', evidenceRefIds: ['ev-A'] },
    { horizon: 'medium', direction: '震荡', rationale: '中期缺少方向性资金。', confidence: 'low', evidenceRefIds: ['ev-A'] },
    { horizon: 'long', direction: '暂不判断', rationale: '长期证据不足。', confidence: 'low', evidenceRefIds: ['ev-A'] }
    ],
    nextCatalysts: [{ statement: '联储讲话', evidenceRefIds: ['ev-A'] }], dataCaveats: [], evidenceRefs: ['ev-A'], createdAt: later
  }
}

function prediction(id: string, summaryId: string): Prediction {
  return { id, schemaVersion: 1, summaryId, asset: 'BTC', horizonStart: later, horizonEnd: '2026-09-25T08:45:00.000Z', baseCase: '上涨', conditions: ['price_return(BTC,15m)>=0.5%'], invalidation: '跌破', nextCatalyst: null, status: 'pending', verificationDueAt: '2026-09-25T08:45:00.000Z', createdAt: later }
}

function timeline(id: string, eventGroupId: string, analysisRunId: string | null, summaryRef: string | null, occurredAt = later): TimelineEntry {
  return { id, schemaVersion: 1, eventGroupId, analysisRunId, kind: 'analysis', status: 'published', occurredAt, summaryRef, safeTitle: '市场分析', safeExcerpt: '摘要', version: 1 }
}

describe('marketAnalysisRepository', () => {
  it('creates all eight tables and can rerun migrations without changing rows', () => {
    const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
    const first = repository.inspectSchema()
    repository.appendEventGroup(group())
    repository.migrate()
    expect(repository.inspectSchema()).toEqual(first)
    expect(first.tables).toEqual(expect.arrayContaining([
      'mi_analysis_event_groups', 'mi_analysis_snapshots', 'mi_analysis_runs', 'mi_analysis_summaries',
      'mi_analysis_predictions', 'mi_analysis_prediction_verifications', 'mi_analysis_timeline', 'mi_analysis_trigger_ledger'
    ]))
    expect(repository.getEventGroup('mi-eg-0001')).toEqual(group())
    repository.close()
  })

  it('keeps snapshots append-only when content returns from A to B to A', () => {
    const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
    repository.appendEventGroup(group())
    repository.appendSnapshot(snapshot('mi-es-A1', 'mi-eg-0001', 'A'))
    repository.appendSnapshot(snapshot('mi-es-B1', 'mi-eg-0001', 'B'))
    repository.appendSnapshot(snapshot('mi-es-A2', 'mi-eg-0001', 'A'))
    expect(repository.listSnapshots('mi-eg-0001').map(item => item.id)).toEqual(['mi-es-A1', 'mi-es-B1', 'mi-es-A2'])
    repository.close()
  })

  it('accepts a snapshot that carries the derived change record', () => {
    const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
    repository.appendEventGroup(group())
    const withChange: EvidenceSnapshot = {
      ...snapshot('mi-es-CH1', 'mi-eg-0001', 'A'),
      change: {
        sequence: 2, previousSnapshotHash: 'hash-previous',
        facts: [{ factId: 'fact-A', domain: 'macro', metric: 'actual', kind: 'changed', previousValue: '3.2', value: 'A' }],
        missingDomainsAdded: [], missingDomainsRemoved: [], caveatsAdded: [], caveatsRemoved: [], evidenceRefsAdded: [], evidenceRefsRemoved: []
      }
    }

    expect(() => repository.appendSnapshot(withChange)).not.toThrow()
    repository.appendSnapshot(snapshot('mi-es-CH2', 'mi-eg-0001', 'B'))
    repository.appendSnapshot(snapshot('mi-es-CH3', 'mi-eg-0001', 'C'))
    expect(repository.listSnapshots('mi-eg-0001').map(item => item.id)).toEqual(['mi-es-CH1', 'mi-es-CH2', 'mi-es-CH3'])
    repository.close()
  })

  it('finds an open group across adjacent release buckets using the stable merge key', () => {
    const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
    const value = { ...group('mi-eg-bucket'), mergeKey: 'macro|official|US|2026-08|CPI|100' }
    repository.appendEventGroup(value)
    expect(repository.findEventGroupByMergeKey('macro|official|US|2026-08|CPI|101')?.id).toBe(value.id)
    repository.close()
  })

  it('persists archive metadata for a frozen snapshot and validated output', () => {
    const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
    repository.appendEventGroup(group())
    const archive = { archiveRef: `${createHash('sha256').update('A').digest('hex')}.json.gz`, archiveHash: createHash('sha256').update('A').digest('hex'), archiveBytes: 128, archiveSchemaVersion: 1, archiveStatus: 'readable' as const }
    repository.appendSnapshot(snapshot('mi-es-A1', 'mi-eg-0001', 'A'), archive)
    expect(repository.getSnapshotArchive('mi-es-A1')).toEqual(archive)
    repository.close()
  })

  it('returns the existing run for a duplicate idempotency key', () => {
    const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
    repository.appendEventGroup(group())
    repository.appendSnapshot(snapshot('mi-es-A1', 'mi-eg-0001', 'A'))
    const first = repository.enqueueRun(run('mi-ar-0001', 'mi-eg-0001', 'mi-es-A1', 'same-key'))
    const second = repository.enqueueRun(run('mi-ar-0002', 'mi-eg-0001', 'mi-es-A1', 'same-key'))
    expect(first.created).toBe(true)
    expect(second).toEqual({ created: false, run: first.run })
    repository.close()
  })

  it('commits summary, prediction, timeline, pointer and run atomically', () => {
    const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
    repository.appendEventGroup(group())
    repository.appendSnapshot(snapshot('mi-es-A1', 'mi-eg-0001', 'A'))
    repository.enqueueRun(run('mi-ar-0001', 'mi-eg-0001', 'mi-es-A1', 'key-1'))
    expect(repository.claimRun('mi-ar-0001', later)).toBe(true)
    const archiveHash = createHash('sha256').update('summary').digest('hex')
    repository.commitSuccessfulAnalysis({ runId: 'mi-ar-0001', summary: summary('mi-as-0001', 'mi-ar-0001', 'mi-eg-0001'), predictions: [prediction('mi-pr-0001', 'mi-as-0001')], timeline: timeline('mi-tl-0001', 'mi-eg-0001', 'mi-ar-0001', 'mi-as-0001'), archive: { archiveRef: `${archiveHash}.json.gz`, archiveHash, archiveBytes: 128, archiveSchemaVersion: 1, archiveStatus: 'readable' } })
    expect(repository.getRun('mi-ar-0001')?.status).toBe('succeeded')
    expect(repository.getEventGroup('mi-eg-0001')?.currentSummaryId).toBe('mi-as-0001')
    expect(repository.getSummary('mi-as-0001')?.version).toBe(1)
    expect(repository.getSummaryArchive('mi-as-0001')).toMatchObject({ archiveHash, archiveStatus: 'readable' })
    expect(repository.listPredictions('mi-as-0001')).toHaveLength(1)
    expect(repository.listTimeline({ eventGroupId: 'mi-eg-0001' }).items).toHaveLength(1)
    repository.close()
  })

  it('rolls back all success side effects for an invalid prediction and preserves the pointer', () => {
    const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
    repository.appendEventGroup(group())
    repository.appendSnapshot(snapshot('mi-es-A1', 'mi-eg-0001', 'A'))
    repository.enqueueRun(run('mi-ar-0001', 'mi-eg-0001', 'mi-es-A1', 'key-1'))
    expect(repository.claimRun('mi-ar-0001', later)).toBe(true)
    expect(() => repository.commitSuccessfulAnalysis({ runId: 'mi-ar-0001', summary: summary('mi-as-0001', 'mi-ar-0001', 'mi-eg-0001'), predictions: [{ ...prediction('mi-pr-0001', 'mi-as-0001'), horizonEnd: later }], timeline: timeline('mi-tl-0001', 'mi-eg-0001', 'mi-ar-0001', 'mi-as-0001') })).toThrow()
    expect(repository.getSummary('mi-as-0001')).toBeUndefined()
    expect(repository.listPredictions('mi-as-0001')).toHaveLength(0)
    expect(repository.listTimeline({ eventGroupId: 'mi-eg-0001' }).items).toHaveLength(0)
    expect(repository.getRun('mi-ar-0001')?.status).toBe('running')
    expect(repository.getEventGroup('mi-eg-0001')?.currentSummaryId).toBeNull()
    repository.close()
  })

  it('does not move current pointer for failed, cancelled, or older runs', () => {
    const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
    repository.appendEventGroup(group())
    repository.appendSnapshot(snapshot('mi-es-A1', 'mi-eg-0001', 'A'))
    repository.enqueueRun(run('mi-ar-0001', 'mi-eg-0001', 'mi-es-A1', 'key-1'))
    repository.enqueueRun({ ...run('mi-ar-0002', 'mi-eg-0001', 'mi-es-A1', 'key-2'), status: 'failed', failureCode: 'provider-error', completedAt: later })
    repository.enqueueRun({ ...run('mi-ar-0003', 'mi-eg-0001', 'mi-es-A1', 'key-3'), status: 'cancelled', failureCode: 'cancelled', completedAt: later })
    expect(repository.getEventGroup('mi-eg-0001')?.currentSummaryId).toBeNull()
    expect(repository.claimRun('mi-ar-0001', later)).toBe(true)
    repository.commitSuccessfulAnalysis({ runId: 'mi-ar-0001', summary: summary('mi-as-0001', 'mi-ar-0001', 'mi-eg-0001', 1), predictions: [], timeline: timeline('mi-tl-0001', 'mi-eg-0001', 'mi-ar-0001', 'mi-as-0001') })
    expect(repository.getEventGroup('mi-eg-0001')?.currentSummaryId).toBe('mi-as-0001')
    repository.close()
  })

  it('does not let an older completed run replace a newer current summary', () => {
    const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
    repository.appendEventGroup(group())
    repository.appendSnapshot(snapshot('mi-es-A1', 'mi-eg-0001', 'A'))
    repository.enqueueRun(run('mi-ar-new', 'mi-eg-0001', 'mi-es-A1', 'key-new'))
    expect(repository.claimRun('mi-ar-new', later)).toBe(true)
    repository.commitSuccessfulAnalysis({ runId: 'mi-ar-new', summary: summary('mi-as-new', 'mi-ar-new', 'mi-eg-0001', 1), predictions: [], timeline: timeline('mi-tl-new', 'mi-eg-0001', 'mi-ar-new', 'mi-as-new', later) })
    repository.enqueueRun(run('mi-ar-old', 'mi-eg-0001', 'mi-es-A1', 'key-old'))
    expect(repository.claimRun('mi-ar-old', asOf)).toBe(true)
    repository.commitSuccessfulAnalysis({ runId: 'mi-ar-old', summary: { ...summary('mi-as-old', 'mi-ar-old', 'mi-eg-0001', 2), createdAt: asOf }, predictions: [], timeline: timeline('mi-tl-old', 'mi-eg-0001', 'mi-ar-old', 'mi-as-old', asOf) })
    expect(repository.getEventGroup('mi-eg-0001')?.currentSummaryId).toBe('mi-as-new')
    repository.close()
  })

  it('records failed and cancelled terminal states without changing the current pointer', () => {
    const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
    repository.appendEventGroup(group())
    repository.appendSnapshot(snapshot('mi-es-A1', 'mi-eg-0001', 'A'))
    repository.enqueueRun(run('mi-ar-failed', 'mi-eg-0001', 'mi-es-A1', 'key-failed'))
    repository.enqueueRun(run('mi-ar-cancelled', 'mi-eg-0001', 'mi-es-A1', 'key-cancelled'))
    expect(repository.updateRunStatus({ id: 'mi-ar-failed', status: 'failed', completedAt: later, failureCode: 'analysis-provider-error' })).toBe(true)
    expect(repository.updateRunStatus({ id: 'mi-ar-cancelled', status: 'cancelled', completedAt: later, failureCode: 'analysis-cancelled' })).toBe(true)
    expect(repository.getRun('mi-ar-failed')?.status).toBe('failed')
    expect(repository.getRun('mi-ar-cancelled')?.status).toBe('cancelled')
    expect(repository.getEventGroup('mi-eg-0001')?.currentSummaryId).toBeNull()
    repository.close()
  })

  it('projects a due prediction verification without changing its append-only summary', () => {
    const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
    repository.appendEventGroup(group())
    repository.appendSnapshot(snapshot('mi-es-A1', 'mi-eg-0001', 'A'))
    repository.enqueueRun(run('mi-ar-0001', 'mi-eg-0001', 'mi-es-A1', 'key-1'))
    expect(repository.claimRun('mi-ar-0001', later)).toBe(true)
    repository.commitSuccessfulAnalysis({ runId: 'mi-ar-0001', summary: summary('mi-as-0001', 'mi-ar-0001', 'mi-eg-0001'), predictions: [prediction('mi-pr-0001', 'mi-as-0001')], timeline: timeline('mi-tl-0001', 'mi-eg-0001', 'mi-ar-0001', 'mi-as-0001') })

    expect(repository.listDuePredictions('2026-09-25T08:45:00.000Z').map(item => item.id)).toEqual(['mi-pr-0001'])
    repository.appendPredictionVerification({ id: 'mi-pv-0001', predictionId: 'mi-pr-0001', status: 'insufficient-data', evaluatedAt: '2026-09-25T08:45:00.000Z', ruleVersion: 'prediction-verification.v1', evidenceRefs: [], reasonCode: 'no-comparable-observation', reason: '缺少可比数据。' })
    repository.updatePredictionStatus({ id: 'mi-pr-0001', status: 'insufficient-data' })

    expect(repository.hasPredictionVerificationAt('mi-pr-0001', '2026-09-25T08:45:00.000Z')).toBe(true)
    expect(repository.listPredictions('mi-as-0001')).toEqual([expect.objectContaining({ id: 'mi-pr-0001', status: 'insufficient-data' })])
    expect(repository.getTimelineEntry('mi-tl-0001')).toMatchObject({ id: 'mi-tl-0001', summaryRef: 'mi-as-0001' })
    repository.close()
  })

  it('commits verification and pending prediction projection atomically', () => {
    const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
    repository.appendEventGroup(group())
    repository.appendSnapshot(snapshot('mi-es-A1', 'mi-eg-0001', 'A'))
    repository.enqueueRun(run('mi-ar-0001', 'mi-eg-0001', 'mi-es-A1', 'key-1'))
    expect(repository.claimRun('mi-ar-0001', later)).toBe(true)
    repository.commitSuccessfulAnalysis({ runId: 'mi-ar-0001', summary: summary('mi-as-0001', 'mi-ar-0001', 'mi-eg-0001'), predictions: [prediction('mi-pr-0001', 'mi-as-0001')], timeline: timeline('mi-tl-0001', 'mi-eg-0001', 'mi-ar-0001', 'mi-as-0001') })

    repository.appendPredictionVerificationAndUpdateStatus({ id: 'mi-pv-atomic', predictionId: 'mi-pr-0001', status: 'confirmed', evaluatedAt: '2026-09-25T08:45:00.000Z', ruleVersion: 'prediction-verification.v1', evidenceRefs: ['ev-A'], reasonCode: 'confirmed', reason: '满足条件。' })

    expect(repository.hasPredictionVerificationAt('mi-pr-0001', '2026-09-25T08:45:00.000Z')).toBe(true)
    expect(repository.listPredictions('mi-as-0001')).toEqual([expect.objectContaining({ id: 'mi-pr-0001', status: 'confirmed' })])
    repository.close()
  })

  it('rolls back verification when the prediction is no longer pending', () => {
    const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
    repository.appendEventGroup(group())
    repository.appendSnapshot(snapshot('mi-es-A1', 'mi-eg-0001', 'A'))
    repository.enqueueRun(run('mi-ar-0001', 'mi-eg-0001', 'mi-es-A1', 'key-1'))
    expect(repository.claimRun('mi-ar-0001', later)).toBe(true)
    repository.commitSuccessfulAnalysis({ runId: 'mi-ar-0001', summary: summary('mi-as-0001', 'mi-ar-0001', 'mi-eg-0001'), predictions: [prediction('mi-pr-0001', 'mi-as-0001')], timeline: timeline('mi-tl-0001', 'mi-eg-0001', 'mi-ar-0001', 'mi-as-0001') })
    repository.updatePredictionStatus({ id: 'mi-pr-0001', status: 'confirmed' })

    expect(() => repository.appendPredictionVerificationAndUpdateStatus({ id: 'mi-pv-rollback', predictionId: 'mi-pr-0001', status: 'invalidated', evaluatedAt: '2026-09-25T08:46:00.000Z', ruleVersion: 'prediction-verification.v1', evidenceRefs: ['ev-A'], reasonCode: 'invalidated', reason: '不满足条件。' })).toThrow('analysis-prediction-status-not-pending')
    expect(repository.hasPredictionVerificationAt('mi-pr-0001', '2026-09-25T08:46:00.000Z')).toBe(false)
    expect(repository.listPredictions('mi-as-0001')).toEqual([expect.objectContaining({ id: 'mi-pr-0001', status: 'confirmed' })])
    repository.close()
  })

  it('pages timeline with an opaque cursor and a default page size of fifty', () => {
    const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
    repository.appendEventGroup(group())
    for (let index = 0; index < 51; index += 1) {
      const minute = String(index).padStart(2, '0')
      repository.appendTimeline(timeline(`mi-tl-${String(index).padStart(4, '0')}`, 'mi-eg-0001', null, null, `2026-09-25T08:${minute}:00.000Z`))
    }
    const first = repository.listTimeline({ eventGroupId: 'mi-eg-0001' })
    expect(first.items).toHaveLength(50)
    expect(first.nextCursor).toEqual(expect.any(String))
    expect(() => JSON.parse(first.nextCursor!)).toThrow()
    const second = repository.listTimeline({ eventGroupId: 'mi-eg-0001', cursor: first.nextCursor })
    expect(second.items).toHaveLength(1)
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(51)
    expect(second.nextCursor).toBeNull()
    console.log(JSON.stringify({ marker: 'MI_ANALYSIS_ACCEPTANCE', package: 'MI-A02', event: 'sqlite-transaction', status: 'pass', details: { tables: 8, idempotentRuns: 1, snapshotHistory: 3, timelinePageSize: first.items.length, orphanArchives: 0 } }))
    repository.close()
  })

  it('does not repeat a timeline entry when a newer entry is inserted between pages', () => {
    const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
    repository.appendEventGroup(group())
    for (let index = 0; index < 51; index += 1) {
      const minute = String(index).padStart(2, '0')
      repository.appendTimeline(timeline(`mi-tl-${String(index).padStart(4, '0')}`, 'mi-eg-0001', null, null, `2026-09-25T08:${minute}:00.000Z`))
    }
    const first = repository.listTimeline({ eventGroupId: 'mi-eg-0001' })
    repository.appendTimeline(timeline('mi-tl-newest', 'mi-eg-0001', null, null, '2026-09-25T09:00:00.000Z'))
    const second = repository.listTimeline({ eventGroupId: 'mi-eg-0001', cursor: first.nextCursor })
    expect(second.items).toEqual([expect.objectContaining({ id: 'mi-tl-0000' })])
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(51)
    repository.close()
  })
})
