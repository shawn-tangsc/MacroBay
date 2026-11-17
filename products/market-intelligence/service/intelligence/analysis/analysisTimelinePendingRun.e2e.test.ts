import { createHash } from 'node:crypto'

import { expect, it } from 'vitest'

import type { AnalysisSummary, EvidenceSnapshot, EventGroup, TimelineEntry } from '../../../contracts/marketAnalysisContracts'
import { buildAnalysisSnapshotHash } from './analysisHash'
import { createAnalysisTimelineService } from './analysisTimelineService'
import { createAnalysisRunService } from './analysisRunService'
import { createMarketAnalysisRepository } from '../store/marketAnalysisRepository'

/**
 * 判据（用户 2026-11-17）：排一次运行 → 打开时间轴**立刻**看到「正在解析」那一条；
 * 完成后同一条目变状态、**总条数不变**（不是多一行）。
 *
 * 真仓库（真 SQLite、真状态流转、真时间轴表）：进行中的行由「还没发布的运行」补出来，
 * 发布行由 `commitSuccessfulAnalysis` 写进去，两者是同一次运行（`analysisRunId` 相同）。
 */
const itemId = 'item-rss:guid:1c1bc29c'
const queuedAt = '2026-11-17T06:55:00.000Z'
const startedAt = '2026-11-17T06:56:00.000Z'
const publishedAt = '2026-11-17T06:58:00.000Z'
const headline = 'Bitcoin risks falling below $60,000 as Nvidia earnings threaten'

const group: EventGroup = {
  id: 'mi-eg-1', schemaVersion: 1, status: 'open', groupType: 'sentiment',
  // mergeKey 的第 4 段是主体（新闻标题），与生产里的分组键同形。
  mergeKey: `sentiment|news|sentiment|${headline}|${queuedAt.slice(0, 13)}`,
  firstObservedAt: queuedAt, lastObservedAt: queuedAt, reviewDeadlineAt: queuedAt, eventRefs: [itemId],
  triggerCount: 1, reviewCount: 0, currentSummaryId: null, supersededByGroupId: null,
  revision: 1, createdAt: queuedAt, updatedAt: queuedAt
}

const facts = [{
  factId: `triggered-news:${itemId}`, domain: 'sentiment' as const, subject: 'BTC', subjectLabel: headline,
  metric: 'news-sentiment', value: 'bearish · strength 3/5 · confidence 75%｜headline｜quote', unit: null,
  sourceId: 'coindesk-rss', sourceLabel: 'coindesk-rss', observedAt: queuedAt, asOf: queuedAt,
  freshness: 'fresh' as const, confidence: 0.75, comparability: 'not-comparable' as const, evidenceRefId: `news:${itemId}`
}]
const evidenceRefs = [{
  evidenceRefId: `news:${itemId}`, sourceId: 'coindesk-rss', sourceLabel: 'coindesk-rss', itemId,
  occurredAt: queuedAt, publishedAt: queuedAt, detectedAt: queuedAt, computedAt: null, visibleAt: queuedAt,
  excerptHash: createHash('sha256').update(itemId).digest('hex')
}]
const snapshot: EvidenceSnapshot = {
  id: 'mi-es-1', schemaVersion: 3, eventGroupId: group.id, asOf: queuedAt, dataCutoff: queuedAt,
  snapshotHash: buildAnalysisSnapshotHash({ profileId: 'crypto-market-analysis-v1', asOf: queuedAt, dataCutoff: queuedAt, facts, missingDomains: [], caveats: [], evidenceRefs }),
  profileId: 'crypto-market-analysis-v1', facts, missingDomains: [], caveats: [], evidenceRefs, sourceHealth: [],
  createdAt: queuedAt, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1',
  trigger: { source: 'intelligence-item', itemId, factId: `triggered-news:${itemId}`, evidenceRefId: `news:${itemId}` }
}

function summary(runId: string): AnalysisSummary {
  return {
    id: 'mi-as-1', schemaVersion: 1, analysisKind: 'market', analysisRunId: runId, eventGroupId: group.id, version: 1,
    knownFacts: [{ factId: `triggered-news:${itemId}`, statement: '新闻被判定为偏空。', evidenceRefIds: [`news:${itemId}`] }],
    transmissionHypotheses: [{ statement: '风险偏好下降压低 BTC。', evidenceRefIds: [`news:${itemId}`] }],
    marketReaction: [{ statement: 'BTC 走弱。', factIds: [`triggered-news:${itemId}`], evidenceRefIds: [`news:${itemId}`] }],
    supportingEvidence: [{ statement: '页面报道债券收益率上行。', evidenceRefId: `news:${itemId}` }], counterEvidence: [],
    scenarios: [{ asset: 'BTC', horizon: '0-15m', baseCase: '偏空', conditions: ['资金继续流出'], invalidation: '资金转正', status: 'running' }],
    directions: [
      { horizon: 'short', direction: 'bearish', rationale: '新闻与价格同向。', confidence: 'medium', evidenceRefIds: [`news:${itemId}`] },
      { horizon: 'medium', direction: 'range', rationale: '中期缺方向。', confidence: 'low', evidenceRefIds: [`news:${itemId}`] },
      { horizon: 'long', direction: 'undecided', rationale: '长期证据不足。', confidence: 'low', evidenceRefIds: [`news:${itemId}`] }
    ],
    nextCatalysts: [{ statement: '关注下一次资金数据。', evidenceRefIds: [`news:${itemId}`] }], dataCaveats: [], evidenceRefs: [`news:${itemId}`],
    createdAt: publishedAt
  } as unknown as AnalysisSummary
}

const timelineRow = (runId: string): TimelineEntry => ({
  id: 'mi-tl-1', schemaVersion: 1, eventGroupId: group.id, analysisRunId: runId, kind: 'analysis',
  status: 'published', occurredAt: publishedAt, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成',
  safeExcerpt: '偏空。', direction: 'bearish', version: 1
})

it('shows the run while it is still being read, then turns that same row into the published one', () => {
  const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
  try {
    repository.appendEventGroup(group)
    repository.appendSnapshot(snapshot)
    const runs = createAnalysisRunService({ repository, now: () => queuedAt, idFactory: () => 'mi-ar-new' })
    const { run } = runs.enqueue({
      eventGroupId: group.id, snapshotId: snapshot.id, snapshotHash: snapshot.snapshotHash,
      analysisPhase: 'initial', triggerKey: 'manual.initial'
    })
    const service = createAnalysisTimelineService({ repository, timeZone: () => 'Asia/Shanghai' })

    // ① 刚排上：时间轴立刻出现那一条，状态是「正在解析」，正文还没有。
    const queued = service.listTimeline({ limit: 50 })
    expect(queued.items).toHaveLength(1)
    expect(queued.items[0]).toMatchObject({
      analysisRunId: run.id, runKey: run.id, kind: 'analysis', status: 'running', occurredAt: queuedAt,
      summaryRef: null, safeTitle: '', failureCode: null, groupType: 'sentiment', groupSubject: headline
    })

    // ② 开始跑：同一条，时刻换成开始时刻（读者看到的是「什么时候开始的」）。
    expect(repository.claimRun(run.id, startedAt)).toBe(true)
    expect(service.listTimeline({ limit: 50 }).items).toHaveLength(1)
    expect(service.listTimeline({ limit: 50 }).items[0]).toMatchObject({ analysisRunId: run.id, runKey: run.id, status: 'running', occurredAt: startedAt })

    // ③ 发布：同一次运行变成已发布行，条数仍是 1——不是删一行加一行。
    repository.commitSuccessfulAnalysis({ runId: run.id, summary: summary(run.id), predictions: [], timeline: timelineRow(run.id) })
    const published = service.listTimeline({ limit: 50 })
    expect(published.items).toHaveLength(1)
    // 同一次运行的 `runKey` 跨两态不变：界面靠它就地换状态，行不换身份。
    expect(published.items[0]).toMatchObject({ analysisRunId: run.id, runKey: run.id, status: 'published', summaryRef: 'mi-as-1', groupSubject: headline })
    expect(published.items[0]!.failureCode).toBeNull()
    // 同一分析运行只许一行：界面拿 `analysisRunId ?? id` 认行，撞 key 会让 React 复用错行。
    expect(published.items.filter(item => item.runKey === run.id)).toHaveLength(1)
    const keys = published.items.map(item => item.runKey)
    expect(new Set(keys).size).toBe(keys.length)
  } finally {
    repository.close()
  }
})

it('turns a run that dies without publishing into a failed row rather than leaving a spinner', () => {
  const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
  try {
    repository.appendEventGroup(group)
    repository.appendSnapshot(snapshot)
    const runs = createAnalysisRunService({ repository, now: () => queuedAt, idFactory: () => 'mi-ar-dead' })
    const { run } = runs.enqueue({
      eventGroupId: group.id, snapshotId: snapshot.id, snapshotHash: snapshot.snapshotHash,
      analysisPhase: 'initial', triggerKey: 'manual.initial'
    })
    repository.claimRun(run.id, startedAt)
    repository.updateRunStatus({ id: run.id, status: 'failed', failureCode: 'analysis-run-interrupted', failureDetailCode: 'run-stalled', completedAt: publishedAt })
    const service = createAnalysisTimelineService({ repository, timeZone: () => 'Asia/Shanghai' })

    const page = service.listTimeline({ limit: 50 })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      analysisRunId: run.id, runKey: run.id, status: 'failed', summaryRef: null,
      failureCode: 'analysis-run-interrupted'
    })
  } finally {
    repository.close()
  }
})

it('keeps a running and a failed news-line run off the market timeline', () => {
  const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
  try {
    repository.appendEventGroup(group)
    repository.appendSnapshot(snapshot)
    const base = {
      schemaVersion: 1 as const, analysisKind: 'news' as const, eventGroupId: group.id, snapshotId: snapshot.id,
      snapshotHash: snapshot.snapshotHash, analysisPhase: 'initial' as const, triggerKey: 'news.manual',
      modelProviderId: 'provider', modelId: 'model', policyVersion: 'policy.v1', promptVersion: 'news-prompt.v1',
      skillVersion: 'news-skill.v1', outputSchemaVersion: 1 as const, jobRunId: null, traceId: null,
      failureCode: null, failureDetailCode: null, validationMode: null, attempt: 1, retryOfRunId: null,
      startedAt: null as string | null, completedAt: null as string | null
    }
    const running = repository.enqueueRun({
      ...base, id: 'mi-ar-news-running', idempotencyKey: 'news-running', status: 'queued', queuedAt
    }).run
    const failed = repository.enqueueRun({
      ...base, id: 'mi-ar-news-failed', idempotencyKey: 'news-failed', status: 'queued', queuedAt: '2026-11-17T06:57:00.000Z'
    }).run
    repository.claimRun(running.id, startedAt)
    repository.claimRun(failed.id, startedAt)
    repository.updateRunStatus({ id: failed.id, status: 'failed', failureCode: 'analysis-run-interrupted', failureDetailCode: 'run-stalled', completedAt: publishedAt })

    const service = createAnalysisTimelineService({ repository, timeZone: () => 'Asia/Shanghai' })
    // 市场时间轴只认市场线：新闻解读正在跑或跑挂了，都不许在这里出现。
    expect(service.listTimeline({ limit: 50 }).items).toHaveLength(0)
  } finally {
    repository.close()
  }
})

it('does not inject unpublished rows into a page opened with a cursor', () => {
  // 正在跑的运行永远属于最新那一屏；往历史页里塞会让游标对不上。这条用替身仓库，
  // 真仓库的游标校验在 store 用例里另有覆盖。
  const service = createAnalysisTimelineService({
    timeZone: () => 'Asia/Shanghai',
    repository: {
      listTimeline: () => ({ items: [], nextCursor: 'opaque' }),
      records: { listRuns: () => [{ id: 'mi-ar-1', eventGroupId: group.id, analysisPhase: 'initial', status: 'running', snapshotId: snapshot.id, queuedAt, startedAt }] },
      getEventGroup: () => ({ id: group.id, currentSummaryId: null })
    } as never
  })
  expect(service.listTimeline({ limit: 50 }).items).toHaveLength(1)
  expect(service.listTimeline({ cursor: 'opaque', limit: 50 }).items).toHaveLength(0)
})
