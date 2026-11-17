import { createHash } from 'node:crypto'

import { it } from 'vitest'

import type { AnalysisRun, AnalysisSummary, EvidenceSnapshot, EventGroup, TimelineEntry } from '../../../contracts/marketAnalysisContracts'
import { marketAnalysisTimelineLimits } from '../../../contracts/marketAnalysisTimelineLimits'
import { sanitizePage } from '../../../desktop/shared/ipc/marketAnalysisTimelineSanitizers'
import { buildAnalysisSnapshotHash } from './analysisHash'
import { createAnalysisTimelineService } from './analysisTimelineService'
import { createAnalysisRunService } from './analysisRunService'
import { createMarketAnalysisRepository } from '../store/marketAnalysisRepository'

const asOf = '2026-11-17T12:00:00.000Z'
const group: EventGroup = {
  id: 'mi-eg-1', schemaVersion: 1, status: 'open', groupType: 'macro', mergeKey: 'US.CPI|macro|official|cpi|2026-11',
  firstObservedAt: asOf, lastObservedAt: asOf, reviewDeadlineAt: asOf, eventRefs: ['event-1'],
  triggerCount: 0, reviewCount: 0, currentSummaryId: null, supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: asOf
}
const facts = [{ factId: 'fact-A', domain: 'macro' as const, subject: 'US CPI', metric: 'actual', value: '3.2', unit: 'percent', sourceId: 'source-fed', sourceLabel: '官方', observedAt: asOf, asOf, freshness: 'fresh' as const, confidence: 1, comparability: 'comparable' as const, evidenceRefId: 'ev-A' }]
const evidenceRefs = [{ evidenceRefId: 'ev-A', sourceId: 'source-fed', sourceLabel: '官方', itemId: null, occurredAt: asOf, publishedAt: asOf, detectedAt: asOf, computedAt: null, visibleAt: asOf, excerptHash: createHash('sha256').update('ev-A').digest('hex') }]
const snapshot: EvidenceSnapshot = {
  id: 'mi-es-1', schemaVersion: 1, eventGroupId: group.id, asOf, dataCutoff: asOf,
  snapshotHash: buildAnalysisSnapshotHash({ profileId: 'crypto-market-analysis-v1', asOf, dataCutoff: asOf, facts, missingDomains: [], caveats: [], evidenceRefs }),
  profileId: 'crypto-market-analysis-v1', facts, missingDomains: [], caveats: [], evidenceRefs,
  sourceHealth: [{ sourceId: 'source-fed', status: 'healthy', asOf }], createdAt: asOf, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1'
}

function summaryFor(id: string, runId: string, version: number): AnalysisSummary {
  return {
    id, schemaVersion: 1, analysisKind: 'market', analysisRunId: runId, eventGroupId: group.id, version, eventAssessment: '通胀数据高于预期',
    knownFacts: [{ factId: 'fact-A', statement: 'actual=3.2', evidenceRefIds: ['ev-A'] }],
    transmissionHypotheses: [{ statement: '流动性预期收紧', evidenceRefIds: ['ev-A'] }],
    marketReaction: [{ statement: 'BTC 下跌', factIds: ['fact-A'], evidenceRefIds: ['ev-A'] }],
    supportingEvidence: [{ statement: '官方数据', evidenceRefId: 'ev-A' }], counterEvidence: [],
    scenarios: [{ asset: 'BTC', horizon: '0-15m', baseCase: '震荡', conditions: ['守住支撑'], invalidation: '跌破支撑', status: 'pending' }],
    directions: [
      { horizon: 'short', direction: '偏多', rationale: '短期资金流转正。', confidence: 'medium', evidenceRefIds: ['ev-A'] },
      { horizon: 'medium', direction: '震荡', rationale: '中期缺少方向性资金。', confidence: 'low', evidenceRefIds: ['ev-A'] },
      { horizon: 'long', direction: '暂不判断', rationale: '长期证据不足。', confidence: 'low', evidenceRefIds: ['ev-A'] }
    ],
    nextCatalysts: [{ statement: '联储讲话', evidenceRefIds: ['ev-A'] }], dataCaveats: [], evidenceRefs: ['ev-A'], createdAt: asOf
  } as unknown as AnalysisSummary
}

const timelineFor = (id: string, runId: string, summaryRef: string, occurredAt: string): TimelineEntry => ({
  id, schemaVersion: 1, eventGroupId: group.id, analysisRunId: runId, kind: 'analysis', status: 'published',
  occurredAt, summaryRef, safeTitle: '市场分析已生成', safeExcerpt: '偏空。', version: 1
})

it('a full first page — 50 published rows plus 20 unpublished runs — is still one readable page', () => {
  const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
  try {
    repository.appendEventGroup(group)
    repository.appendSnapshot(snapshot)
    const runs = createAnalysisRunService({ repository, now: () => asOf, idFactory: (() => { let n = 0; return () => `mi-ar-p${++n}` })() })
    // 50 条已发布行
    for (let index = 0; index < marketAnalysisTimelineLimits.pageItems; index += 1) {
      const { run } = runs.enqueue({ eventGroupId: group.id, snapshotId: snapshot.id, snapshotHash: snapshot.snapshotHash, analysisPhase: 'initial', triggerKey: `published.${index}` })
      repository.claimRun(run.id, asOf)
      repository.commitSuccessfulAnalysis({
        runId: run.id, summary: summaryFor(`mi-as-${index}`, run.id, index + 1), predictions: [],
        timeline: timelineFor(`mi-tl-${index}`, run.id, `mi-as-${index}`, new Date(Date.parse(asOf) - index * 60_000).toISOString())
      })
    }
    // 20 条跑挂了的运行（没有摘要、没有时间轴行）
    const failures = createAnalysisRunService({ repository, now: () => asOf, idFactory: (() => { let n = 0; return () => `mi-ar-f${++n}` })() })
    for (let index = 0; index < marketAnalysisTimelineLimits.unpublishedItems; index += 1) {
      const { run } = failures.enqueue({ eventGroupId: group.id, snapshotId: snapshot.id, snapshotHash: snapshot.snapshotHash, analysisPhase: 'initial', triggerKey: `failed.${index}` })
      repository.claimRun(run.id, asOf)
      repository.updateRunStatus({ id: run.id, status: 'failed', failureCode: 'analysis-provider-error', completedAt: asOf })
    }

    const service = createAnalysisTimelineService({ repository, timeZone: () => 'Asia/Shanghai' })
    const page = service.listTimeline({})
    console.log(JSON.stringify({
      marker: 'FULL_PAGE', items: page.items.length, published: page.items.filter(item => item.status === 'published').length,
      failed: page.items.filter(item => item.status === 'failed').length, maximum: marketAnalysisTimelineLimits.maximumItems
    }))
    // 满页边界：50 + 20 = 70 条，一条不少也不多。
    if (page.items.length !== marketAnalysisTimelineLimits.maximumItems) throw new Error(`page=${page.items.length}`)
    // 整页仍可读（渲染侧校验按同一个上限）。
    if (sanitizePage(JSON.parse(JSON.stringify(page)))?.state !== 'available') throw new Error('sanitizer rejected the full page')
    // 读者要能选出一条 published 看详情。
    if (!page.items.some(item => item.status === 'published' && item.summaryRef)) throw new Error('no published row')
  } finally {
    repository.close()
  }
}, 120_000)
