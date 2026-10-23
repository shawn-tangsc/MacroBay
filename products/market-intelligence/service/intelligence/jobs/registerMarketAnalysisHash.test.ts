import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { JobHandler, JobRuntime } from '@platform/jobs'
import type { IntelligenceItem, IntelligenceItemRevision } from '../schema/intelligenceRecord'
import type { IntelligencePipeline } from '../application/intelligencePipeline'
import type { MarketIntelligencePublicQueryService } from '../public-query/publicQueryService'
import { GROUP_MARKET_ANALYSIS_CHANGE_JOB } from './marketAnalysisJobIds'
import { registerMarketAnalysisRuntime } from './registerMarketAnalysisRuntime'

const asOf = '2026-10-02T00:01:00.000Z'
const publishedAt = '2026-10-02T00:00:00.000Z'
const baseItem: IntelligenceItem = {
  itemId: 'hash-item', primaryRawRecordId: 'hash-raw', canonicalDedupeKey: 'hash-key',
  sourceId: 'official-source', eventType: 'announcement', title: '市场事件',
  sourceCategory: 'announcement', sourceTrust: 'high', publishedAt, detectedAt: publishedAt,
  severityHint: 'critical', timelineStatus: 'evaluated', normalizerVersion: 'v1'
}

type Case = {
  name: string
  item: IntelligenceItem
  previous?: Partial<IntelligenceItemRevision>
  decision: 'queued' | 'skipped'
  reason: string
}

const cases: Case[] = [
  { name: '缺少摘要仍能分组并触发分析', item: baseItem, decision: 'queued', reason: 'severity-confirmed' },
  { name: '缺少发布时间可分组但不能成为已确认事件', item: { ...baseItem, publishedAt: undefined }, decision: 'skipped', reason: 'change-unconfirmed' },
  { name: '上一修订缺少所有可选字段仍能计算变更', item: baseItem, previous: {}, decision: 'queued', reason: 'severity-confirmed' },
  { name: '前后摘要均缺失且事实相同仍是语义无变化', item: baseItem, previous: { title: baseItem.title, publishedAt }, decision: 'skipped', reason: 'semantic-no-op' },
  { name: '完整字段相同仍是语义无变化', item: { ...baseItem, summary: '已确认事实' }, previous: { title: baseItem.title, summary: '已确认事实', publishedAt }, decision: 'skipped', reason: 'semantic-no-op' },
  { name: '空摘要与缺失摘要保持不同的哈希语义', item: { ...baseItem, summary: '' }, previous: { title: baseItem.title, publishedAt }, decision: 'queued', reason: 'severity-confirmed' }
]

describe('市场分析运行时可选字段哈希边界', () => {
  it.each(cases)('$name', async ({ item, previous, decision, reason }) => {
    const dataDir = await mkdtemp(join(tmpdir(), 'mi-analysis-hash-'))
    const handlers = new Map<string, JobHandler>()
    // 仅截断调度器：保留运行时字段投影、严格哈希、分组、策略及 SQLite 写入。
    const jobRuntime = {
      registerHandler: (id: string, handler: JobHandler) => { handlers.set(id, handler) },
      enqueueDefinition: async () => ({ id: 'next-stage' })
    } as unknown as JobRuntime
    const revisions: IntelligenceItemRevision[] = previous === undefined ? [] : [
      { revisionId: 'previous', itemId: item.itemId, revisionKind: 'initial', detectedAt: '2026-10-01T23:59:00.000Z', revisionVersion: 'v1', ...previous },
      { revisionId: 'current', itemId: item.itemId, revisionKind: 'update', detectedAt: publishedAt, revisionVersion: 'v1', title: item.title, summary: item.summary, publishedAt: item.publishedAt }
    ]
    const runtime = registerMarketAnalysisRuntime({
      jobRuntime,
      pipeline: { listItems: () => [item], listRevisions: () => revisions } as IntelligencePipeline,
      publicQueryService: {} as MarketIntelligencePublicQueryService,
      structuredModelInvocation: { invoke: async () => { throw new Error('分组阶段不得调用模型') } },
      dataDir, now: () => asOf
    })
    try {
      await handlers.get(GROUP_MARKET_ANALYSIS_CHANGE_JOB)!({ changeId: item.itemId, eventRef: item.itemId }, {
        jobRunId: 'hash-regression', signal: new AbortController().signal,
        log: async () => undefined, progress: async () => undefined
      })
      const groups = runtime.repository.listEventGroups()
      expect(groups).toHaveLength(1)
      expect(groups[0].eventRefs).toEqual([item.itemId])
      expect(runtime.repository.listTriggerLedger(groups[0].id)).toEqual([
        expect.objectContaining({ decision, reasonCode: reason, changeHash: expect.stringMatching(/^[a-f0-9]{64}$/u) })
      ])
      expect(runtime.repository.listRuns()).toEqual([])
    } finally {
      runtime.dispose()
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})
