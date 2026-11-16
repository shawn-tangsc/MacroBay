import { createHash } from 'node:crypto'

import { expect, it } from 'vitest'

import type { EventGroup, EvidenceSnapshot } from '../../../contracts/marketAnalysisContracts'
import { buildAnalysisSnapshotHash } from './analysisHash'
import { createNewsInterpretationReader } from './analysisNewsInterpretationRead'
import { createAnalysisRunService } from './analysisRunService'
import { createMarketAnalysisRepository } from '../store/marketAnalysisRepository'

/**
 * 判据（用户 2026-11-17 现场）：跑一次运行 → 中途杀掉应用 → 重开 → 那条新闻的「AI 解读」
 * 不许再显示正在生成，必须落到「失败 + 再试一次」。
 *
 * 用真仓库（真 SQLite、真迁移、真状态流转），只有「当前证据指纹」那一步的预计算在这条用例里
 * 不参与——它查的是上下文，与这次要验的「陈尸怎么收」无关。
 */
const itemId = 'item-rss:guid:1c1bc29c'
const queuedAt = '2026-11-16T22:07:17.000Z'
const restartAt = '2026-11-17T06:08:00.000Z'

const item = {
  itemId, sourceId: 'coindesk-rss', title: 'Bitcoin risks falling below $60,000 as Nvidia earnings threaten',
  summary: '', publishedAt: '2026-11-16T22:00:00.000Z', detectedAt: '2026-11-16T22:01:00.000Z',
  sourceCategory: 'news', sourceTrust: 'high', eventType: 'news', primaryRawRecordId: 'raw-1',
  canonicalDedupeKey: 'k', severityHint: 'info', timelineStatus: 'evaluated', normalizerVersion: 'v1'
}

const group: EventGroup = {
  id: 'mi-eg-1', schemaVersion: 1, status: 'open', groupType: 'sentiment', mergeKey: `sentiment|${itemId}`,
  firstObservedAt: queuedAt, lastObservedAt: queuedAt, reviewDeadlineAt: queuedAt, eventRefs: [itemId],
  triggerCount: 1, reviewCount: 0, currentSummaryId: null, supersededByGroupId: null,
  revision: 1, createdAt: queuedAt, updatedAt: queuedAt
}

const facts = [
  {
    factId: `triggered-news:${itemId}`, domain: 'sentiment' as const, subject: 'BTC', subjectLabel: item.title,
    metric: 'news-sentiment', value: 'bearish · strength 3/5 · confidence 75%｜headline｜quote', unit: null,
    sourceId: 'coindesk-rss', sourceLabel: 'coindesk-rss', observedAt: '2026-11-16T22:05:00.000Z', asOf: queuedAt,
    freshness: 'fresh' as const, confidence: 0.75, comparability: 'not-comparable' as const, evidenceRefId: `news:${itemId}`
  }
]
const evidenceRefs = [{
  evidenceRefId: `news:${itemId}`, sourceId: 'coindesk-rss', sourceLabel: 'coindesk-rss', itemId,
  occurredAt: '2026-11-16T22:00:00.000Z', publishedAt: '2026-11-16T22:00:00.000Z', detectedAt: '2026-11-16T22:01:00.000Z',
  computedAt: null, visibleAt: '2026-11-16T22:01:00.000Z', excerptHash: createHash('sha256').update(itemId).digest('hex')
}]
const snapshot: EvidenceSnapshot = {
  id: 'mi-es-1', schemaVersion: 3, eventGroupId: group.id, asOf: queuedAt, dataCutoff: queuedAt,
  snapshotHash: buildAnalysisSnapshotHash({ profileId: 'crypto-market-analysis-v1', asOf: queuedAt, dataCutoff: queuedAt, facts, missingDomains: [], caveats: [], evidenceRefs }),
  profileId: 'crypto-market-analysis-v1', facts, missingDomains: [], caveats: [], evidenceRefs, sourceHealth: [],
  createdAt: queuedAt, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1',
  trigger: { source: 'intelligence-item', itemId, factId: `triggered-news:${itemId}`, evidenceRefId: `news:${itemId}` }
}

function readerFor(repository: ReturnType<typeof createMarketAnalysisRepository>, now: string) {
  return createNewsInterpretationReader({
    publicQueryService: {} as never,
    pipeline: { listItems: () => [item], listRevisions: () => [] } as never,
    repository,
    timeZone: () => 'UTC',
    now: () => now
  })
}

it('a run killed mid-call reads as failure + retry after the restart, never as "being generated"', async () => {
  const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
  try {
    repository.appendEventGroup(group)
    repository.appendSnapshot(snapshot)
    const first = createAnalysisRunService({ repository, now: () => queuedAt, idFactory: () => 'mi-ar-b4db8df4' })
    const { run } = first.enqueue({
      eventGroupId: group.id, snapshotId: snapshot.id, snapshotHash: snapshot.snapshotHash,
      analysisPhase: 'initial', triggerKey: 'manual.initial'
    })
    // 真实时序：认领 → 写调用存档 → 调用发出去了（存档停在 inflight，正是现场那一行）。
    expect(repository.claimRun(run.id, queuedAt)).toBe(true)
    repository.analysisIo.begin({ analysisRunId: run.id, callIndex: 1, callKind: 'initial', prompt: [] })

    // 重启前：运行确实在跑，读者的那一节应当显示「正在解读」。
    await expect(readerFor(repository, '2026-11-16T22:09:00.000Z')(itemId)).resolves.toMatchObject({ state: 'in-flight', runId: run.id })

    // 启动对账（应用重开时跑的就是这一步）。
    const afterRestart = createAnalysisRunService({ repository, now: () => restartAt, idFactory: () => 'mi-ar-next' })
    expect(afterRestart.recover().failed).toEqual([run.id])
    expect(repository.getRun(run.id)).toMatchObject({
      status: 'failed', failureCode: 'analysis-run-interrupted', failureDetailCode: 'runtime-stopped'
    })
    // 调用存档不许被改：它是「这次调用真的发出去过、再没回来」的证据。
    expect(repository.analysisIo.readByRunId(run.id)[0]).toMatchObject({ outputStatus: 'inflight' })

    // 读者看到的：不是「正在生成」，而是失败 + 可重试。
    await expect(readerFor(repository, restartAt)(itemId)).resolves.toMatchObject({
      state: 'none',
      lastRun: { runId: run.id, status: 'failed', failureCode: 'analysis-run-interrupted', finishedAt: restartAt }
    })
  } finally {
    repository.close()
  }
})

it('a run that stalls while the process stays up is swept, so the section stops waiting', () => {
  const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
  try {
    repository.appendEventGroup(group)
    repository.appendSnapshot(snapshot)
    const first = createAnalysisRunService({ repository, now: () => queuedAt, idFactory: () => 'mi-ar-b4db8df4' })
    const { run } = first.enqueue({
      eventGroupId: group.id, snapshotId: snapshot.id, snapshotHash: snapshot.snapshotHash,
      analysisPhase: 'initial', triggerKey: 'manual.initial'
    })
    repository.claimRun(run.id, queuedAt)

    // 进程没重启（没有启动对账），运行自己挂住了：周期性清点必须把它判掉。
    const later = createAnalysisRunService({ repository, now: () => restartAt, idFactory: () => 'mi-ar-next' })
    expect(later.sweepStalled()).toEqual([run.id])
    expect(repository.getRun(run.id)).toMatchObject({ status: 'failed', failureCode: 'analysis-run-interrupted', failureDetailCode: 'run-stalled' })
    // 同一轮再扫一次不会重复写：终态行不满足条件。
    expect(later.sweepStalled()).toEqual([])
  } finally {
    repository.close()
  }
})
