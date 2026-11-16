import { describe, expect, it } from 'vitest'

import type { AnalysisRun, AnalysisSummary, EventGroup } from '../../../contracts/marketAnalysisContracts'
import { createNewsInterpretationReader } from './analysisNewsInterpretationRead'

/**
 * 「AI 解读」的只读判读（R37 §9.2/§9.3）。
 *
 * `available` 的判据是「**有已发布摘要、且此刻读得到**」：摘要行会被结论保留策略删掉，而运行行
 * 可能因为被别的账本引用而留下——那种组合只回 `runId` 就是「成功但空节」，所以它必须报 `none`，
 * 让菜单回到「AI 解读」、读者重跑一次。
 */
const asOf = '2026-11-16T09:30:00.000Z'

const item = {
  itemId: 'item-1', sourceId: 'coindesk-rss', title: 'JPMorgan and DBS complete cross-border payment trial',
  summary: 'no direct market impact', publishedAt: '2026-11-16T08:46:00.000Z', detectedAt: '2026-11-16T08:47:00.000Z',
  sourceCategory: 'news', sourceTrust: 'high', eventType: 'news', primaryRawRecordId: 'raw-1',
  canonicalDedupeKey: 'k', severityHint: 'info', timelineStatus: 'evaluated', normalizerVersion: 'v1'
}

const group: EventGroup = {
  id: 'mi-eg-1', schemaVersion: 1, status: 'open', groupType: 'sentiment', mergeKey: 'sentiment|item-1',
  firstObservedAt: asOf, lastObservedAt: asOf, reviewDeadlineAt: asOf, eventRefs: ['item-1'],
  triggerCount: 1, reviewCount: 0, currentSummaryId: 'mi-as-1', supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: asOf
}

const run = (status: AnalysisRun['status']): AnalysisRun => ({
  id: 'mi-ar-1', schemaVersion: 1, eventGroupId: group.id, snapshotId: 'mi-es-1', snapshotHash: 'snap-hash',
  analysisPhase: 'initial', triggerKey: 'manual.initial', idempotencyKey: 'key', status, attempt: 1,
  retryOfRunId: null, modelProviderId: null, modelId: null, policyVersion: 'p', promptVersion: 'v',
  skillVersion: 's', outputSchemaVersion: 3, jobRunId: null, traceId: null, failureCode: null, failureDetailCode: null,
  validationMode: 'strict', queuedAt: asOf, startedAt: asOf, completedAt: asOf
})

const snapshot = {
  id: 'mi-es-1', schemaVersion: 3, eventGroupId: group.id, asOf, dataCutoff: asOf, snapshotHash: 'snap-hash',
  profileId: 'crypto-market-analysis-v1',
  facts: [
    { factId: 'triggered-news:item-1', domain: 'sentiment', subject: '', subjectLabel: item.title, metric: 'news-sentiment', evidenceRefId: 'news:item-1' },
    { factId: 'mi-fact-etf', domain: 'capital', subject: 'BTC', metric: 'etf-net-flow', evidenceRefId: 'ev-etf' }
  ],
  missingDomains: [], caveats: [], evidenceRefs: [{ evidenceRefId: 'news:item-1' }, { evidenceRefId: 'ev-etf' }],
  sourceHealth: [], createdAt: asOf, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1',
  trigger: { source: 'intelligence-item', itemId: 'item-1', factId: 'triggered-news:item-1', evidenceRefId: 'news:item-1' }
}

const summary = { id: 'mi-as-1', analysisRunId: 'mi-ar-1', eventGroupId: group.id, createdAt: asOf } as AnalysisSummary

function reader(overrides: Readonly<{ run?: AnalysisRun; summary?: AnalysisSummary | undefined }> = {}) {
  return createNewsInterpretationReader({
    // 预计算在这条用例里不参与：链路上读不到上下文会让当前指纹为 null，判读逻辑仍可验。
    publicQueryService: {} as never,
    pipeline: { listItems: () => [item], listRevisions: () => [] } as never,
    repository: {
      listEventGroups: () => [group],
      listRuns: () => [overrides.run ?? run('succeeded')],
      getSnapshot: () => snapshot as never,
      getSummaryForRun: () => ('summary' in overrides ? overrides.summary : summary)
    } as never,
    timeZone: () => 'UTC',
    now: () => asOf
  })
}

describe('只读判读：哪条解读、能不能读', () => {
  it('reports available with the summary id the renderer needs for the body', async () => {
    const result = await reader()('item-1')
    expect(result).toMatchObject({ state: 'available', runId: 'mi-ar-1', summaryId: 'mi-as-1', snapshotHash: 'snap-hash', dataAsOf: asOf })
    if (result.state !== 'available') throw new Error('expected available')
    // 「available ⇒ 摘要可读」：有 id 就必须能取到那一条。
    expect(result.summaryId).toBe(summary.id)
    // 触发事实 subject 为空时，显示名走 subjectLabel（不是空串）。
    expect(result.subjectLabel).toBe(item.title)
    expect(result.evidenceScope).toMatchObject({ factCount: 2, evidenceRefCount: 2 })
  })

  it('reports none — not available — when the summary row is gone but the run succeeded', async () => {
    // 摘要被保留策略删掉、运行行因别的账本引用留下：只回 runId 就是「成功但空节」。
    const result = await reader({ summary: undefined })('item-1')
    expect(result).toMatchObject({ state: 'none' })
    // 成功过、只是摘要没了：这不是「点了失败」，不给失败态，否则读者会以为要重试。
    expect(result.state === 'none' ? result.lastRun : 'n/a').toBeUndefined()
  })

  it('reports the last run failure so the section can show a retry instead of waiting forever', async () => {
    // 线上那次：运行 invalid-output、没有摘要；只回 none 时界面停在「正在生成」。
    const rejected = { ...run('invalid-output'), failureCode: 'analysis-missing-evidence', failureDetailCode: 'missing-trigger-focus' } as AnalysisRun
    const result = await reader({ run: rejected })('item-1')
    expect(result).toMatchObject({
      state: 'none',
      lastRun: { runId: 'mi-ar-1', status: 'invalid-output', failureCode: 'analysis-missing-evidence', finishedAt: asOf }
    })
  })

  it('reports in-flight without a summary id while a run is still queued', async () => {
    const result = await reader({ run: run('queued') })('item-1')
    expect(result).toEqual({ itemId: 'item-1', state: 'in-flight', runId: 'mi-ar-1', currentEvidenceFingerprint: null })
    expect('summaryId' in result).toBe(false)
  })

  it('does not report a stalled run as in flight: a dead run must not read as "being generated"', async () => {
    // 22:07 排上、06:08 还是 running 的那种行：收尸之前也不许让界面继续等。
    const stalled = { ...run('running'), queuedAt: '2026-11-16T00:00:00.000Z', startedAt: '2026-11-16T00:00:00.000Z', completedAt: null }
    const result = await reader({ run: stalled })('item-1')
    expect(result.state).toBe('none')
  })

  it('reports none for an item that was never read', async () => {
    const result = await reader()('item-unknown')
    expect(result).toEqual({ itemId: 'item-unknown', state: 'none', currentEvidenceFingerprint: null })
  })
})
