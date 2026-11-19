import type { JobRuntime } from '@platform/jobs'

import type { IntelligenceArchiveService } from '../application/intelligenceArchiveService'
import type { IntelligencePipeline } from '../application/intelligencePipeline'
import type { IntelligenceReplayService } from '../application/intelligenceReplayService'
import type { IntelligenceTranslationService } from '../application/intelligenceTranslationService'
import type { createNewsSentimentEnrichmentService } from '../news-sentiment/newsSentimentEnrichmentService'
import type { createNewsSentimentScoringService } from '../news-sentiment/newsSentimentScoringService'
import { isDefillamaStablecoinRetiredPath } from '../application/sourceCatalog'
import { isZeroXRouterSource } from '../application/zeroXRouterSourcePolicy'
import { getSource } from '../application/providerRegistry'
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
    etfFlowHistory?: { refresh: () => Promise<Readonly<{ state: string; reason?: string }>> }
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
    // 路由按「这个源声明了 etf-net-flow」走，不认具体 id：以后加源只改注册表声明。
    // 旧锚的分支留着只为过渡期——它 collection 落成 none 后不会再有作业。
    if (getSource(input.sourceId)?.provides?.includes('etf-net-flow') === true || isZeroXRouterSource(input.sourceId)) {
      const refreshed = await deps.etfFlowHistory?.refresh()
      // 这一轮到底写没写，运行记录里要自己说出来：`unavailable` 时库里的 `last_attempt_at` 不动，
      // 界面上只剩「采集完成」，读者和我们都只能猜（2026-11-17 查了半天的那次）。
      if (refreshed !== undefined) {
        await context.log({
          level: refreshed.state === 'unavailable' ? 'warn' : 'info',
          message: `ETF window refresh: ${refreshed.state}${refreshed.reason ? ` (${refreshed.reason})` : ''}.`
        })
      }
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
    // 这个源在这次采集**之前**库里有没有条目：没有就是「建档」那一轮（一次几百条也不该响一遍）。
    // 条目是 normalize 才建的，所以此刻读到的还是上一轮的结果。
    const sourceHadItems = deps.pipeline.listItems().some((item) => item.sourceId === input.sourceId)
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
      sourceId: input.sourceId,
      ...(sourceHadItems ? {} : { firstCollection: true })
    })
  })

  jobRuntime.registerHandler(INTELLIGENCE_NORMALIZE_RAW_RECORDS_JOB, async (payload, context) => {
    const input = payload as { sourceId?: string; limit?: number; newItemIds?: string[]; firstCollection?: boolean }
    const result = await pipeline.normalizeRawRecords(input)
    await enqueueIntelligencePipelineJobs(jobRuntime, result.queuedJobs, {
      sourceId: input.sourceId,
      newItemIds: result.newItemIds,
      ...(input.firstCollection ? { firstCollection: true } : {})
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
    const input = payload as { itemIds?: string[]; rebuild?: boolean; limit?: number; firstCollection?: boolean }
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
        newItemIds: input.itemIds,
        ...(input.firstCollection ? { firstCollection: true } : {})
      })
    }
  })

  jobRuntime.registerHandler(INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB, async (payload, context) => {
    const input = payload as { itemIds?: string[]; rebuild?: boolean; limit?: number; firstCollection?: boolean }
    if (!deps.newsSentiment) {
      await context.log({ level: 'warn', message: 'News sentiment service unavailable.' })
      return
    }
    const result = await deps.newsSentiment.scoreItems({
      ...(input.rebuild ? { limit: 500 } : { itemIds: input.itemIds, limit: input.limit }),
      ...(input.rebuild ? { rebuild: true } : {}),
      // 建档那一轮整轮不发（`firstCollection` 由采集侧按「这个源之前库内 0 条」给出）。
      ...(input.firstCollection ? { suppressArrivalNotices: true } : {})
    })
    await context.log({
      level: 'info',
      // `unjudged` 必须出现在这里：这一轮「有几条没判出来」是可查的事实，不是一次静默跳过。
      message: `Scored ${result.processed} news item(s); model ${result.model}, rules ${result.rules}, `
        + `unjudged ${result.unjudged}, skipped ${result.skipped}.`
    })
    // 新闻的严重度只能在这一步之后才成立（判定刚写下来）。重建是重算历史，不是新事件，不补触发。
    // R39：新闻判定落地后不再补分析触发——按条解读只有读者手动那一次。
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
    /* 原文外置已退休（2026-11-20）：这个任务**只做译文压缩**，不再有「归档原始记录」这件事。
       日志照实说，别让读日志的人以为原文还被这个任务搬过。 */
    await context.log({ level: 'info', message: `Compacted ${result.translationRemoved} translation records; raw payload archiving is retired.` })
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


