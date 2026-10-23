import type { JobRuntime } from '@platform/jobs'

import type { IntelligenceArchiveService } from '../application/intelligenceArchiveService'
import type { IntelligencePipeline } from '../application/intelligencePipeline'
import type { IntelligenceReplayService } from '../application/intelligenceReplayService'
import type { IntelligenceTranslationService } from '../application/intelligenceTranslationService'
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
  INTELLIGENCE_REFRESH_SENTIMENT_AGGREGATES_JOB,
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
    capitalConditions?: { refresh: () => Promise<unknown> }
    etfFlowHistory?: { refresh: () => Promise<unknown> }
    fundingRateHistory?: { refresh: () => Promise<unknown> }
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
    if (input.sourceId === 'binance-futures-positioning') {
      await deps.fundingRateHistory?.refresh()
      return
    }
    const result = await pipeline.collectSource({
      sourceId: input.sourceId,
      runId: input.runId ?? context.jobRunId
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
