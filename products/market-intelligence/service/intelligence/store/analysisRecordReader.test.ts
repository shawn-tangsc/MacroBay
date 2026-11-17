import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it } from 'vitest'

import type {
  AnalysisRun, AnalysisSummary, EvidenceSnapshot, EventGroup, TimelineEntry
} from '../../../contracts/marketAnalysisContracts'
import type { AnalysisKind } from '../../../contracts/analysisKinds'
import { buildAnalysisSnapshotHash } from '../analysis/analysisHash'
import { createMarketAnalysisRepository, type MarketAnalysisRepository } from './marketAnalysisRepository'
import { createMarketAnalysisSqlite } from './marketAnalysisSqlite'

/**
 * R39 §1.2b / §5 的四条判据（先红后绿，红证在本次提交说明里）：
 * 1. 写侧不带类别必须失败（run 与摘要两道关口）；
 * 2. 新闻线的运行不进市场时间轴（时间轴用例在 `analysisTimelinePendingRun.e2e.test.ts`）；
 * 3. 没有回填机会的旧行（归档还原、回退后旧版写入）读成 market；
 * 4. 更新的新闻运行不冒充「最近一次尝试」。
 *
 * 另加一条迁移用例：新装 → 删列删索引 → 重开，验证 ALTER + 回填 + 重建索引，且只碰
 * `analysis_kind` 这一列（payload/status/时间原样）。
 */
const asOf = '2026-09-25T08:30:00.000Z'
const later = '2026-09-25T08:31:00.000Z'
const itemId = 'item-rss:guid:news-1'

function group(id = 'mi-eg-1'): EventGroup {
  return {
    id, schemaVersion: 1, status: 'monitoring', groupType: 'macro', mergeKey: `US.CPI|${id}`,
    firstObservedAt: asOf, lastObservedAt: asOf, reviewDeadlineAt: '2026-09-25T09:00:00.000Z',
    eventRefs: [itemId], triggerCount: 1, reviewCount: 0, currentSummaryId: null,
    supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: asOf
  }
}

function snapshot(id = 'mi-es-1', eventGroupId = 'mi-eg-1'): EvidenceSnapshot {
  const facts = [{
    factId: 'fact-A', domain: 'macro' as const, subject: 'US CPI', metric: 'actual', value: '3.2', unit: 'percent',
    sourceId: 'source-fed', sourceLabel: '官方', observedAt: asOf, asOf, freshness: 'fresh' as const,
    confidence: 1, comparability: 'comparable' as const, evidenceRefId: 'ev-A'
  }]
  const evidenceRefs = [{
    evidenceRefId: 'ev-A', sourceId: 'source-fed', sourceLabel: '官方', itemId, occurredAt: asOf,
    publishedAt: asOf, detectedAt: asOf, computedAt: null, visibleAt: asOf,
    excerptHash: createHash('sha256').update('ev-A').digest('hex')
  }]
  return {
    id, schemaVersion: 1, eventGroupId, asOf, dataCutoff: asOf,
    snapshotHash: buildAnalysisSnapshotHash({ profileId: 'crypto-market-analysis-v1', asOf, dataCutoff: asOf, facts, missingDomains: [], caveats: [], evidenceRefs }),
    profileId: 'crypto-market-analysis-v1', facts, missingDomains: [], caveats: [], evidenceRefs,
    sourceHealth: [{ sourceId: 'source-fed', status: 'healthy' as const, asOf }], createdAt: asOf,
    policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1'
  }
}

function run(id: string, analysisKind: AnalysisKind, idempotencyKey: string, queuedAt = asOf): AnalysisRun {
  return {
    id, schemaVersion: 1, analysisKind, eventGroupId: 'mi-eg-1', snapshotId: 'mi-es-1',
    snapshotHash: snapshot().snapshotHash, analysisPhase: 'initial', triggerKey: `${analysisKind}.manual`,
    idempotencyKey, status: 'queued', attempt: 1, retryOfRunId: null, modelProviderId: 'provider', modelId: 'model',
    policyVersion: 'policy.v1', promptVersion: `${analysisKind}-prompt.v1`, skillVersion: `${analysisKind}-skill.v1`,
    outputSchemaVersion: 1, jobRunId: null, traceId: null, failureCode: null, failureDetailCode: null,
    validationMode: null, queuedAt, startedAt: null, completedAt: null
  }
}

function summary(id: string, analysisRunId: string, analysisKind: AnalysisKind): AnalysisSummary {
  return {
    id, schemaVersion: 1, analysisKind, analysisRunId, eventGroupId: 'mi-eg-1', version: 1,
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
    nextCatalysts: [{ statement: '联储讲话', evidenceRefIds: ['ev-A'] }], dataCaveats: [], evidenceRefs: ['ev-A'], createdAt: later
  }
}

function timeline(summaryId: string, analysisRunId: string): TimelineEntry {
  return {
    id: 'mi-tl-1', schemaVersion: 1, eventGroupId: 'mi-eg-1', analysisRunId, kind: 'analysis',
    status: 'published', occurredAt: later, summaryRef: summaryId, safeTitle: '市场分析', safeExcerpt: '摘要', version: 1
  }
}

function seed(repository: MarketAnalysisRepository): void {
  repository.appendEventGroup(group())
  repository.appendSnapshot(snapshot())
}

function publish(repository: MarketAnalysisRepository, value: AnalysisRun): void {
  expect(repository.claimRun(value.id, later)).toBe(true)
  const record = summary(`mi-as-${value.id}`, value.id, value.analysisKind)
  repository.commitSuccessfulAnalysis({ runId: value.id, summary: record, predictions: [], timeline: timeline(record.id, value.id) })
}

it('refuses a run or a summary written without an analysis kind', () => {
  const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
  try {
    seed(repository)
    const bareRun = { ...run('mi-ar-bare', 'market', 'bare-run') } as Record<string, unknown>
    delete bareRun.analysisKind
    expect(() => repository.enqueueRun(bareRun as unknown as AnalysisRun)).toThrow('storage-analysis-kind-missing')
    // 显式 null 同样拒：否则它会被 SQLite 收下，读侧再兜成 market——正是这条规则要防的。
    expect(() => repository.enqueueRun({ ...run('mi-ar-null', 'market', 'null-run'), analysisKind: null as never })).toThrow('storage-analysis-kind-missing')
    expect(() => repository.enqueueRun({ ...run('mi-ar-bogus', 'market', 'bogus-run'), analysisKind: 'calendar' as never })).toThrow('analysis-run-invalid')
    expect(repository.getRun('mi-ar-bare')).toBeUndefined()
    expect(repository.getRun('mi-ar-null')).toBeUndefined()

    const queued = repository.enqueueRun(run('mi-ar-1', 'market', 'run-1')).run
    expect(repository.claimRun(queued.id, later)).toBe(true)
    const bareSummary = { ...summary('mi-as-bare', queued.id, 'market') } as Record<string, unknown>
    delete bareSummary.analysisKind
    expect(() => repository.commitSuccessfulAnalysis({
      runId: queued.id, summary: bareSummary as unknown as AnalysisSummary, predictions: [], timeline: timeline('mi-as-bare', queued.id)
    })).toThrow('storage-analysis-kind-missing')
    expect(() => repository.commitSuccessfulAnalysis({
      runId: queued.id, summary: { ...summary('mi-as-null', queued.id, 'market'), analysisKind: null } as unknown as AnalysisSummary,
      predictions: [], timeline: timeline('mi-as-null', queued.id)
    })).toThrow('storage-analysis-kind-missing')
    // 拒绝之后没有留下半条记录：摘要没写，运行仍是 running。
    expect(repository.getSummaryForRun(queued.id)).toBeUndefined()
    expect(repository.getRun(queued.id)?.status).toBe('running')
  } finally {
    repository.close()
  }
})

it('reads a row with a null kind as market when it had no backfill chance', () => {
  const sqlite = createMarketAnalysisSqlite(':memory:')
  const repository = createMarketAnalysisRepository({ storage: sqlite })
  try {
    seed(repository)
    const market = repository.enqueueRun(run('mi-ar-1', 'market', 'run-1')).run
    publish(repository, market)
    // 模拟「旧归档还原回来的行」「回退后旧版写入的行」：列与载荷都没有类别。
    sqlite.database.exec('update mi_analysis_runs set analysis_kind = null')
    sqlite.database.exec('update mi_analysis_summaries set analysis_kind = null')
    sqlite.database.exec("update mi_analysis_summaries set payload_json = json_remove(payload_json, '$.analysisKind')")

    expect(repository.getRun(market.id)?.analysisKind).toBe('market')
    expect(repository.records.latestAttempt({ analysisKind: 'market' })).toMatchObject({ id: market.id, analysisKind: 'market' })
    expect(repository.records.getRecordForRun({ analysisKind: 'market', runId: market.id })?.summary)
      .toMatchObject({ id: `mi-as-${market.id}`, analysisKind: 'market' })
    expect(repository.records.latestForItem({ analysisKind: 'market', itemId })?.run.id).toBe(market.id)
    expect(repository.records.latestAttempt({ analysisKind: 'news' })).toBeUndefined()
  } finally {
    repository.close()
    sqlite.close()
  }
})

it('migrates a database that predates the kind column without touching anything else', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mi-analysis-kind-'))
  const filePath = join(directory, 'analysis.db')
  try {
    const firstSqlite = createMarketAnalysisSqlite(filePath)
    const first = createMarketAnalysisRepository({ storage: firstSqlite })
    seed(first)
    const market = first.enqueueRun(run('mi-ar-1', 'market', 'run-1')).run
    publish(first, market)
    first.close()
    firstSqlite.close()

    // 把一个「R39 之前安装的库」还原出来：两列与两条索引都不存在，行还在。
    const stripped = createMarketAnalysisSqlite(filePath)
    stripped.database.exec('drop index if exists idx_mi_analysis_run_kind_queued')
    stripped.database.exec('drop index if exists idx_mi_analysis_summary_kind_group')
    stripped.database.exec('alter table mi_analysis_runs drop column analysis_kind')
    stripped.database.exec('alter table mi_analysis_summaries drop column analysis_kind')
    const beforeRun = stripped.database.prepare('select status, queued_at from mi_analysis_runs where id = ?').get(market.id) as Record<string, unknown>
    const beforeSummary = stripped.database.prepare('select payload_json from mi_analysis_summaries where analysis_run_id = ?').get(market.id) as Record<string, unknown>
    stripped.close()

    const reopenedSqlite = createMarketAnalysisSqlite(filePath)
    const reopened = createMarketAnalysisRepository({ storage: reopenedSqlite })
    try {
      const runColumns = (reopenedSqlite.database.prepare('pragma table_info(mi_analysis_runs)').all() as Record<string, unknown>[]).map(row => String(row.name))
      const summaryColumns = (reopenedSqlite.database.prepare('pragma table_info(mi_analysis_summaries)').all() as Record<string, unknown>[]).map(row => String(row.name))
      expect(runColumns).toContain('analysis_kind')
      expect(summaryColumns).toContain('analysis_kind')
      expect(reopenedSqlite.database.prepare("select name from sqlite_schema where type = 'index' and name in ('idx_mi_analysis_run_kind_queued','idx_mi_analysis_summary_kind_group') order by name").all())
        .toEqual([{ name: 'idx_mi_analysis_run_kind_queued' }, { name: 'idx_mi_analysis_summary_kind_group' }])
      expect(reopenedSqlite.database.prepare('select analysis_kind from mi_analysis_runs where id = ?').get(market.id))
        .toEqual({ analysis_kind: 'market' })
      expect(reopenedSqlite.database.prepare('select analysis_kind, analysis_run_id from mi_analysis_summaries').get())
        .toEqual({ analysis_kind: 'market', analysis_run_id: market.id })
      // 回填只碰这一列：状态、时间、正文原样。
      expect(reopenedSqlite.database.prepare('select status, queued_at from mi_analysis_runs where id = ?').get(market.id)).toEqual(beforeRun)
      expect(reopenedSqlite.database.prepare('select payload_json from mi_analysis_summaries where analysis_run_id = ?').get(market.id)).toEqual(beforeSummary)
      expect(reopened.records.latestAttempt({ analysisKind: 'market' })?.id).toBe(market.id)
    } finally {
      reopened.close()
      reopenedSqlite.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('keeps a newer succeeded news run out of the latest market attempt', () => {
  const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
  try {
    seed(repository)
    const market = repository.enqueueRun(run('mi-ar-market', 'market', 'market-run', asOf)).run
    const news = repository.enqueueRun(run('mi-ar-news', 'news', 'news-run', later)).run
    publish(repository, news)

    // 新闻运行更新且已成功——不带类别过滤就会拿到它。
    expect(repository.records.latestAttempt({ analysisKind: 'market' })?.id).toBe(market.id)
    expect(repository.records.latestAttempt({ analysisKind: 'news' })?.id).toBe(news.id)
    expect(repository.records.latestForItem({ analysisKind: 'market', itemId })?.run.id).toBe(market.id)
  } finally {
    repository.close()
  }
})
