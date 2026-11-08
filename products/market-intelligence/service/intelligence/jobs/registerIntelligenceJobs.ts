import type { JobRuntime } from '@platform/jobs'

import type { IntelligenceArchiveService } from '../application/intelligenceArchiveService'
import type { IntelligencePipeline } from '../application/intelligencePipeline'
import type { IntelligenceReplayService } from '../application/intelligenceReplayService'
import type { IntelligenceTranslationService } from '../application/intelligenceTranslationService'
import type { createNewsSentimentEnrichmentService } from '../news-sentiment/newsSentimentEnrichmentService'
import type { createNewsSentimentScoringService } from '../news-sentiment/newsSentimentScoringService'
import { isDefillamaStablecoinRetiredPath } from '../application/sourceCatalog'
import { isZeroXRouterSource } from '../application/zeroXRouterSourcePolicy'
import type { TranslateIntelligenceItemsJobInput } from '../schema/intelligenceTranslation'
import { enqueueIntelligencePipelineJobs } from './enqueueIntelligencePipelineJobs'
import {
  INTELLIGENCE_ARCHIVE_COMPACTION_JOB,
  INTELLIGENCE_ASSESS_CHANGED_ITEMS_JOB,
  INTELLIGENCE_COLLECT_SOURCE_JOB,
  INTELLIGENCE_NORMALIZE_RAW_RECORDS_JOB,
  INTELLIGENCE_PARQUET_EXPORT_JOB,
  INTELLIGENCE_PURGE_JOB,
  INTELLIGENCE_REEVALUATE_CLUSTERS_JOB,
  INTELLIGENCE_REEVALUATE_SENTIMENT_SCOPES_JOB,
  INTELLIGENCE_ENRICH_NEWS_DOCUMENTS_JOB,
  INTELLIGENCE_REFRESH_SENTIMENT_AGGREGATES_JOB,
  INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB,
  INTELLIGENCE_REINDEX_JOB,
  INTELLIGENCE_REPLAY_WINDOW_JOB,
  INTELLIGENCE_TRANSLATE_ITEMS_JOB
} from './intelligenceJobIds'

export function registerIntelligenceJobs(
  jobRuntime: JobRuntime,
  deps: {
    pipeline: IntelligencePipeline
    archiveService?: IntelligenceArchiveService
    replayService?: IntelligenceReplayService
    translationService?: Pick<IntelligenceTranslationService, 'translateItems'>
    newsSentiment?: {
      enrichItems: ReturnType<typeof createNewsSentimentEnrichmentService>['enrichItems']
      scoreItems: ReturnType<typeof createNewsSentimentScoringService>['scoreItems']
    }
    capitalConditions?: { refresh: () => Promise<unknown> }
    etfFlowHistory?: { refresh: () => Promise<unknown> }
    fundingRateHistory?: { refresh: () => Promise<unknown> }
    openInterest?: { refresh: (input?: Readonly<{ log?: (entry: Readonly<{ level: 'warn'; message: string }>) => void | Promise<void> }>) => Promise<unknown> }
  }
): void {
  const { pipeline, archiveService, replayService, translationService } = deps

  jobRuntime.registerHandler(INTELLIGENCE_COLLECT_SOURCE_JOB, async (payload, context) => {
    const input = payload as { sourceId: string; runId?: string }
    await context.log({ level: 'info', message: `Collecting source ${input.sourceId}.` })
    if (isDefillamaStablecoinRetiredPath(input.sourceId)) {
      await deps.capitalConditions?.refresh()
      return
    }
    if (isZeroXRouterSource(input.sourceId)) {
      await deps.etfFlowHistory?.refresh()
      return
    }
    // One source, two series: the funding rate and the notional open interest it cannot be
    // read without. Both live behind this source's single enable switch, so both are
    // refreshed here rather than in a second job definition.
    if (input.sourceId === 'binance-futures-positioning') {
      await deps.fundingRateHistory?.refresh()
      await deps.openInterest?.refresh({ log: context.log })
      return
    }
    const result = await pipeline.collectSource({
      sourceId: input.sourceId,
      runId: input.runId ?? context.jobRunId
    })
    // 一次采集必须留下可查的数字（用户 2026-11-07）：以前这里什么都不记，于是
    // 「今天真的没有新文章」与「抓到了但一条没写进去」在运行记录里长得一模一样。
    //
    // 平台的运行结论只收四个计数（总数 = 成功 + 失败 + 跳过），所以按语义映射：
    //   总数 = 解析出的条目、成功 = 真正新增、跳过 = 被去重挡住；没采成时`失败 = 1` + 原因码。
    // 这样「成功但 0 条新」是 `{total:25, succeeded:0, skipped:25}`、
    // 「抓不到」是 `{total:0, failed:1, reasonCode:'collect.failed'}`——必然长得不一样。
    const { counts } = result
    await context.log({
      level: result.reasonCode === undefined ? 'info' : 'warn',
      message: `Collected ${input.sourceId}: ${counts.httpCalls} request(s), ${counts.fetchedBytes} byte(s), `
        + `${counts.parsed} parsed, ${counts.appended} new, ${counts.duplicates} duplicate`
        + (result.reasonCode === undefined ? '.' : `; ${result.reasonCode}: ${result.reason ?? ''}`)
    })
    // 抓住了正文却一条都没解析出来：对 RSS 这类源来说这不是「今天很安静」，是源坏了。
    const empty = result.reasonCode === undefined && counts.httpCalls > 0 && counts.parsed === 0
    const reasonCode = result.reasonCode ?? (empty ? 'collect.empty' : undefined)
    await context.result?.({
      counts: reasonCode === undefined
        ? { total: counts.parsed, succeeded: counts.appended, failed: 0, skipped: counts.duplicates }
        : { total: 0, succeeded: 0, failed: 1, skipped: 0 },
      ...(reasonCode === undefined ? {} : { reasonCode })
    })
    await enqueueIntelligencePipelineJobs(jobRuntime, result.queuedJobs, {
      sourceId: input.sourceId
    })
  })

  jobRuntime.registerHandler(INTELLIGENCE_NORMALIZE_RAW_RECORDS_JOB, async (payload, context) => {
    const input = payload as { sourceId?: string; limit?: number; newItemIds?: string[] }
    const result = await pipeline.normalizeRawRecords(input)
    await enqueueIntelligencePipelineJobs(jobRuntime, result.queuedJobs, {
      sourceId: input.sourceId,
      newItemIds: result.newItemIds
    })
    await context.log({ level: 'info', message: 'Normalized pending raw records.' })
  })

  jobRuntime.registerHandler(INTELLIGENCE_TRANSLATE_ITEMS_JOB, async (payload, context) => {
    if (!translationService) {
      await context.log({ level: 'warn', message: 'Translation service unavailable.' })
      return
    }
    const result = await translationService.translateItems(payload as TranslateIntelligenceItemsJobInput)
    await context.log({
      level: 'info',
      message: `Translated ${result.processed} item(s); ${result.failed} failed.`
    })
    // 只写真跑出来的结论：抛错或没算出数的批走不到这里，旧行就是「无计数」，
    // 不会被补成 0/0/0/0 混进成功率的分母。
    if (result.counts) {
      await context.result?.({
        counts: result.counts,
        ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
        ...(result.reasons ? { reasons: result.reasons } : {})
      })
    }
  })

  jobRuntime.registerHandler(INTELLIGENCE_ENRICH_NEWS_DOCUMENTS_JOB, async (payload, context) => {
    const input = payload as { itemIds?: string[]; rebuild?: boolean; limit?: number }
    if (!deps.newsSentiment) {
      await context.log({ level: 'warn', message: 'News sentiment service unavailable.' })
      return
    }
    const result = await deps.newsSentiment.enrichItems(input.rebuild ? { limit: 500 } : { itemIds: input.itemIds, limit: input.limit })
    await context.log({
      level: 'info',
      message: `Enriched ${result.processed} news item(s); ${result.available} available, ${result.tooShort} short, ${result.failed} failed.`
    })
    if (input.rebuild) {
      await enqueueIntelligencePipelineJobs(jobRuntime, [INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB], { rebuild: true })
    } else if (input.itemIds?.length) {
      await enqueueIntelligencePipelineJobs(jobRuntime, [INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB], {
        newItemIds: input.itemIds
      })
    }
  })

  jobRuntime.registerHandler(INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB, async (payload, context) => {
    const input = payload as { itemIds?: string[]; rebuild?: boolean; limit?: number }
    if (!deps.newsSentiment) {
      await context.log({ level: 'warn', message: 'News sentiment service unavailable.' })
      return
    }
    const result = await deps.newsSentiment.scoreItems(input.rebuild ? { limit: 500 } : { itemIds: input.itemIds, limit: input.limit })
    await context.log({
      level: 'info',
      message: `Scored ${result.processed} news item(s); model ${result.model}, rules ${result.rules}, skipped ${result.skipped}.`
    })
  })

  jobRuntime.registerHandler(INTELLIGENCE_ASSESS_CHANGED_ITEMS_JOB, async (payload, context) => {
    const input = payload as { itemIds?: string[] }
    await pipeline.assessChangedItems(input)
    await context.log({ level: 'info', message: 'Assessed changed intelligence items.' })
  })

  jobRuntime.registerHandler(INTELLIGENCE_REFRESH_SENTIMENT_AGGREGATES_JOB, async (payload, context) => {
    const input = payload as { scopeKey?: string; horizon?: '15m' | '1h' | '4h' | '24h'; itemIds?: string[] }
    await pipeline.refreshSentimentAggregates(input)
    await context.log({ level: 'info', message: 'Refreshed sentiment aggregates.' })
  })

  jobRuntime.registerHandler(INTELLIGENCE_REEVALUATE_CLUSTERS_JOB, async (payload, context) => {
    const input = payload as { itemIds?: string[]; clusterId?: string }
    await pipeline.assessChangedItems({ itemIds: input.itemIds })
    await context.log({ level: 'info', message: `Re-evaluated cluster ${input.clusterId ?? 'scoped items'}.` })
  })

  jobRuntime.registerHandler(INTELLIGENCE_REEVALUATE_SENTIMENT_SCOPES_JOB, async (payload, context) => {
    const input = payload as { scopeKey?: string; horizon?: '15m' | '1h' | '4h' | '24h' }
    await pipeline.refreshSentimentAggregates({
      scopeKey: input.scopeKey ?? 'global',
      horizon: input.horizon ?? '1h'
    })
    await context.log({ level: 'info', message: 'Re-evaluated sentiment scopes.' })
  })

  jobRuntime.registerHandler(INTELLIGENCE_ARCHIVE_COMPACTION_JOB, async (payload, context) => {
    const input = payload as { sourceId: string; retentionMode?: 'compact' | 'balanced' | 'extended' }
    if (isDefillamaStablecoinRetiredPath(input.sourceId)) {
      await context.log({ level: 'info', message: 'Archive skipped for retired source.' })
      return
    }
    if (!archiveService) {
      await context.log({ level: 'warn', message: 'Archive service unavailable.' })
      return
    }
    const result = await archiveService.compactSource({
      sourceId: input.sourceId,
      retentionMode: input.retentionMode ?? 'balanced'
    })
    await context.log({ level: 'info', message: `Archived ${result.archivedCount} raw records.` })
  })

  jobRuntime.registerHandler(INTELLIGENCE_PARQUET_EXPORT_JOB, async (_payload, context) => {
    await context.log({ level: 'info', message: 'Parquet export skipped: not implemented in v1.' })
  })

  jobRuntime.registerHandler(INTELLIGENCE_PURGE_JOB, async (_payload, context) => {
    await context.log({ level: 'info', message: 'Purge skipped: explicit purge policy required.' })
  })

  jobRuntime.registerHandler(INTELLIGENCE_REPLAY_WINDOW_JOB, async (payload, context) => {
    const input = payload as {
      sourceId: string
      from?: string
      to?: string
      rawRecordIds?: string[]
    }
    if (isDefillamaStablecoinRetiredPath(input.sourceId)) {
      await context.log({ level: 'info', message: 'Replay skipped for retired source.' })
      return
    }
    if (!replayService) {
      await context.log({ level: 'warn', message: 'Replay service unavailable.' })
      return
    }
    const result = await replayService.replayWindow(input)
    await context.log({ level: 'info', message: `Replayed ${result.replayedCount} raw records.` })
  })

  jobRuntime.registerHandler(INTELLIGENCE_REINDEX_JOB, async (payload, context) => {
    const input = payload as { sourceId?: string; limit?: number }
    await pipeline.normalizeRawRecords({ sourceId: input.sourceId, limit: input.limit ?? 100 })
    await pipeline.assessChangedItems({})
    await context.log({ level: 'info', message: 'Reindexed intelligence records.' })
  })
}
