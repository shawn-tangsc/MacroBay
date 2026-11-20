import { expect, it } from 'vitest'

import type { AnalysisRun, EvidenceSnapshot, EventGroup } from '../../../contracts/marketAnalysisContracts'
import { buildAnalysisSnapshotHash } from './analysisHash'
import { createAnalysisRunService } from './analysisRunService'
import { createAnalysisFailedRunReader } from './analysisFailedRunRead'
import { createMarketAnalysisRepository } from '../store/marketAnalysisRepository'

const asOf = '2026-11-18T06:00:00.000Z'
const later = '2026-11-18T06:20:00.000Z'

function group(id = 'mi-eg-failed'): EventGroup {
  return {
    id, schemaVersion: 1, status: 'monitoring', groupType: 'macro', mergeKey: `US.CPI|${id}`,
    firstObservedAt: asOf, lastObservedAt: asOf, reviewDeadlineAt: '2026-11-18T07:00:00.000Z',
    eventRefs: ['event-1'], triggerCount: 1, reviewCount: 0, currentSummaryId: null,
    supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: asOf
  }
}

function snapshot(eventGroupId = 'mi-eg-failed'): EvidenceSnapshot {
  return {
    id: 'mi-es-failed', schemaVersion: 1, eventGroupId, asOf, dataCutoff: asOf,
    snapshotHash: buildAnalysisSnapshotHash({ profileId: 'crypto-market-analysis-v1', asOf, dataCutoff: asOf, facts: [], missingDomains: [], caveats: [], evidenceRefs: [] }),
    profileId: 'crypto-market-analysis-v1', facts: [], missingDomains: [], caveats: [], evidenceRefs: [],
    sourceHealth: [], createdAt: asOf, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1'
  }
}

function failRun(repository: ReturnType<typeof createMarketAnalysisRepository>, id: string, index: number, analysisKind: 'market' | 'news' = 'market', failureCode = 'analysis-timeout'): AnalysisRun {
  const service = createAnalysisRunService({ repository, now: () => asOf, idFactory: () => id })
  const run = service.enqueue({
    analysisKind, eventGroupId: 'mi-eg-failed', snapshotId: 'mi-es-failed', snapshotHash: snapshot().snapshotHash,
    analysisPhase: 'initial', triggerKey: `manual.refresh.${index}`
  }).run
  expect(repository.claimRun(run.id, later)).toBe(true)
  repository.updateRunStatus({ id: run.id, status: 'failed', failureCode, failureDetailCode: 'timeout', completedAt: later })
  return run
}

it('pages 120 failed runs 50/50/20 with a replayable cursor, no duplicates, and leaves listTimeline untouched', () => {
  const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
  try {
    repository.appendEventGroup(group())
    repository.appendSnapshot(snapshot())
    for (let index = 0; index < 120; index += 1) failRun(repository, `mi-ar-f-${String(index).padStart(3, '0')}`, index)
    // 新闻线的失败留在新闻抽屉：市场失败页只认市场线（A 的读侧隔离）。
    failRun(repository, 'mi-ar-news-failed', 999, 'news')

    const first = repository.listFailedRuns({ limit: 50 })
    const second = repository.listFailedRuns({ limit: 50, cursor: first.nextCursor })
    const third = repository.listFailedRuns({ limit: 50, cursor: second.nextCursor })
    expect([first.items.length, second.items.length, third.items.length]).toEqual([50, 50, 20])
    expect(third.nextCursor).toBeNull()
    const ids = [...first.items, ...second.items, ...third.items].map(run => run.id)
    expect(new Set(ids).size).toBe(120)
    expect(ids).not.toContain('mi-ar-news-failed')
    // 无状态、可重放：同一个游标再读一次，返回同一页。
    expect(repository.listFailedRuns({ limit: 50, cursor: first.nextCursor }).items.map(run => run.id))
      .toEqual(second.items.map(run => run.id))
    // 旧读口逐字不变：失败运行不进时间轴，已发布行的 JSON 形状一个字段都没动。
    expect(JSON.stringify(repository.listTimeline({}))).toBe('{"items":[],"nextCursor":null}')
    repository.appendTimeline({
      id: 'mi-tl-golden', schemaVersion: 1, eventGroupId: 'mi-eg-failed', analysisRunId: null, kind: 'analysis',
      status: 'published', occurredAt: asOf, summaryRef: null, safeTitle: 'golden', safeExcerpt: null, direction: null, version: 1
    })
    expect(JSON.stringify(repository.listTimeline({}))).toBe(JSON.stringify({
      items: [{
        id: 'mi-tl-golden', schemaVersion: 1, eventGroupId: 'mi-eg-failed', analysisRunId: null, kind: 'analysis',
        status: 'published', occurredAt: asOf, summaryRef: null, safeTitle: 'golden', safeExcerpt: null,
        direction: null, version: 1
      }],
      nextCursor: null
    }))
  } finally {
    repository.close()
  }
})

it('rejects an undecodable cursor instead of silently starting over', () => {
  // 静默回到第一页会让「加载更多」无限循环；解不开的游标必须是边界错误。
  const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
  try {
    expect(() => repository.listFailedRuns({ cursor: 'not-a-cursor' })).toThrow('analysis-invalid-cursor')
    expect(() => repository.listFailedRuns({ cursor: Buffer.from('{"not":"a-run-cursor"}').toString('base64url') }))
      .toThrow('analysis-invalid-cursor')
  } finally {
    repository.close()
  }
})

it('maps runs to failed timeline entries the renderer sanitizer accepts, hiding unknown codes', () => {
  const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
  try {
    repository.appendEventGroup(group())
    repository.appendSnapshot(snapshot())
    failRun(repository, 'mi-ar-known', 0, 'market', 'analysis-timeout')
    failRun(repository, 'mi-ar-unknown', 1, 'market', 'provider-vendor-mystery-500')

    const page = createAnalysisFailedRunReader(repository).list({ limit: 50 })
    expect(page.schemaVersion).toBe(1)
    const known = page.items.find(item => item.id === 'run:mi-ar-known')!
    const unknown = page.items.find(item => item.id === 'run:mi-ar-unknown')!
    expect(known).toMatchObject({
      id: 'run:mi-ar-known', analysisRunId: 'mi-ar-known', status: 'failed', summaryRef: null,
      safeTitle: '', safeExcerpt: null, runKey: 'mi-ar-known', failureCode: 'analysis-timeout'
    })
    // 未知码不印：收敛到渲染侧文案表认得的默认码，绝不把原始码发给读者。
    expect(unknown.failureCode).toBe('analysis-provider-error')
  } finally {
    repository.close()
  }
})
