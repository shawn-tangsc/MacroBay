import type { JobRuntime } from '@platform/jobs'

import {
  createMarketHistoryRetention,
  marketHistoryRetentionPolicy,
  registerMarketHistoryRetentionJob,
  type MarketHistoryRetentionResult,
  type RetainedStore
} from './marketHistoryRetentionJob'
import { analysisConclusionCutoffIso } from './analysisConclusionRetention'
import { analysisIoCutoffIso } from './analysisIoRetention'
import { analysisTriggerLedgerCutoffIso } from './analysisTriggerLedgerRetention'
import { predictionLedgerCutoffIso } from './predictionLedgerRetention'
import type { BarRetentionCutoffs } from './barRetention'
import { createNewsSentimentRetentionTarget } from '../news-sentiment/newsSentimentRetention'
import { createRawRecordRetentionTarget, logRawRecordRetention } from './rawRecordRetention'
import type { RawRecordStore } from '../application/rawRecordStore'
import type { MarketAnalysisRepository } from '../store/marketAnalysisRepository'

export type RetentionStoreId = keyof typeof marketHistoryRetentionPolicy.stores

/**
 * 一次没剪的那一站与原因。
 *
 * 「缺一节」必须写成一行事实，不能靠「参数是可选」表达：可选参数在调用点看起来和「没有这一站」
 * 一模一样，而静默少剪一处就是 0.4.5「记录只增不减」那个病的形状。所以每一处缺失都进这个列表、
 * 打一行 marker，排障的人从日志就能分清「这次没剪」和「这一站不存在」。
 */
export type RetentionStoreSkip = Readonly<{ store: RetentionStoreId; reason: string }>

/** 跳过那几行：一行 JSON，带 store 与 reason，不带记录内容。 */
export function logRetentionStoreSkip(skip: RetentionStoreSkip): void {
  console.log(JSON.stringify({ marker: 'RETENTION_STORE_SKIPPED', ...skip }))
}

/**
 * Register the one daily pass that keeps every market store inside its retention policy.
 *
 * The wiring lives here rather than in `bootstrap.ts` so the product entry point stays a call site,
 * and so the windows this pass answers — conclusions, verdicts, the signal ledger, the model call
 * record, the raw records and their payload files — are read in one file next to the job that runs them.
 *
 * **A store that never opened must not take the others down with it.** Each store is optional here and
 * each absent one is reported as a skip with its reason, so the pass still runs for everything that did
 * open: a cross-asset database that refused to open cannot be allowed to leave the raw records growing.
 */
export function registerMarketRetention(input: Readonly<{
  jobRuntime: JobRuntime
  macroStore?: Readonly<{ retention: (cutoffs: BarRetentionCutoffs) => MarketHistoryRetentionResult; note: (key: string, value: string) => void }>
  crossAssetStore?: Readonly<{ retention: (cutoffs: BarRetentionCutoffs) => MarketHistoryRetentionResult; note: (key: string, value: string) => void }>
  analysisRepository?: MarketAnalysisRepository
  newsStore?: Parameters<typeof createNewsSentimentRetentionTarget>[0]
  rawRecordStore?: Pick<RawRecordStore, 'pruneRawRecords'>
  /** 每一站缺失的原因；没写的那一站按 `store-unavailable` 记。 */
  skipReasons?: Readonly<Partial<Record<RetentionStoreId, string>>>
  /** 跳过那几行的出口；默认写日志，测试可换成收集器。 */
  reportSkip?: (skip: RetentionStoreSkip) => void
}>): readonly RetentionStoreSkip[] {
  const stores: Partial<Record<RetentionStoreId, RetainedStore>> = {}
  const skips: RetentionStoreSkip[] = []
  const skip = (store: RetentionStoreId): void => {
    skips.push({ store, reason: input.skipReasons?.[store] ?? 'store-unavailable' })
  }

  const { analysisRepository } = input
  if (input.macroStore) {
    const macro = input.macroStore
    stores.macro = { retention: ({ cutoffs }) => macro.retention(cutoffs), note: (key, value) => macro.note(key, value) }
  } else skip('macro')
  if (input.crossAssetStore) {
    const crossAsset = input.crossAssetStore
    stores.crossAsset = { retention: ({ cutoffs }) => crossAsset.retention(cutoffs), note: (key, value) => crossAsset.note(key, value) }
  } else skip('crossAsset')
  if (analysisRepository) {
    // The conclusions keep their own window: fourteen days, then the whole graph goes — except the
    // verdicts, which keep theirs (a hundred and eighty days) on the same clock. The signal ledger
    // has a third window (fifteen days) handled inside the same call but in its own transaction, so
    // a failed sweep cannot mark the conclusion store failed. The bar cutoffs are ignored rather
    // than reinterpreted — several policies, one clock.
    stores.analysis = {
      retention: ({ atMs }) => ({
        thinned: 0,
        ...analysisRepository.retention({
          conclusionCutoffIso: analysisConclusionCutoffIso(atMs),
          ledgerCutoffIso: predictionLedgerCutoffIso(atMs),
          triggerLedgerCutoffIso: analysisTriggerLedgerCutoffIso(atMs)
        })
      }),
      note: (key, value) => analysisRepository.note(key, value)
    }
    // The model calls (prompt + raw answer) are their own store id: thirty days, or the oldest go
    // first until the compressed bytes are back under a hundred megabytes. A failure here writes
    // `analysis-io.retention.lastFailureCode` and leaves `analysis.retention.lastFailureCode`
    // empty — that separation is why this is not a second clock inside `analysis`.
    stores.analysisIo = {
      retention: ({ atMs }) => ({ thinned: 0, ...analysisRepository.analysisIo.retention({ cutoffIso: analysisIoCutoffIso(atMs) }) }),
      note: (key, value) => analysisRepository.note(key, value)
    }
  } else {
    // 同一个仓储装着结论与调用记录两串时间，缺了它两站都没剪：一行说清是哪两站。
    skip('analysis')
    skip('analysisIo')
  }
  // The news store keeps its own two windows (30 days of bodies, 365 of judgments) on this same
  // clock. It joins this job rather than owning a timer of its own: one daily pass, one startup
  // look, and a store whose database failed to open is simply absent from the pass.
  if (input.newsStore) stores.news = createNewsSentimentRetentionTarget(input.newsStore)
  else skip('news')
  // 原始记录（json 元数据 + 内容寻址原文）是这一跑的最后一段：7 天轮转、孤儿每次顺手回收。
  // 它也一样没有自己的时间：不接上就是「只增不减」，接上一跑就够。
  if (input.rawRecordStore) stores.rawRecords = createRawRecordRetentionTarget(input.rawRecordStore, logRawRecordRetention)
  else skip('rawRecords')

  const report = input.reportSkip ?? logRetentionStoreSkip
  for (const entry of skips) report(entry)

  registerMarketHistoryRetentionJob(input.jobRuntime, createMarketHistoryRetention({ stores }).run)
  return Object.freeze(skips)
}