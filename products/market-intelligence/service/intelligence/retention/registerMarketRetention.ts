import type { JobRuntime } from '@platform/jobs'

import { createMarketHistoryRetention, registerMarketHistoryRetentionJob, type MarketHistoryRetentionResult } from './marketHistoryRetentionJob'
import { analysisConclusionCutoffIso } from './analysisConclusionRetention'
import { analysisIoCutoffIso } from './analysisIoRetention'
import { analysisTriggerLedgerCutoffIso } from './analysisTriggerLedgerRetention'
import { predictionLedgerCutoffIso } from './predictionLedgerRetention'
import type { BarRetentionCutoffs } from './barRetention'
import { createNewsSentimentRetentionTarget } from '../news-sentiment/newsSentimentRetention'
import type { MarketAnalysisRepository } from '../store/marketAnalysisRepository'

/**
 * Register the one daily pass that keeps every market store inside its retention policy.
 *
 * The wiring lives here rather than in `bootstrap.ts` so the product entry point stays a call site,
 * and so the four windows this pass answers — conclusions, verdicts, the signal ledger, the model
 * call record — are read in one file next to the job that runs them.
 */
export function registerMarketRetention(input: Readonly<{
  jobRuntime: JobRuntime
  macroStore: Readonly<{ retention: (cutoffs: BarRetentionCutoffs) => MarketHistoryRetentionResult; note: (key: string, value: string) => void }>
  crossAssetStore: Readonly<{ retention: (cutoffs: BarRetentionCutoffs) => MarketHistoryRetentionResult; note: (key: string, value: string) => void }>
  analysisRepository: MarketAnalysisRepository
  newsStore?: Parameters<typeof createNewsSentimentRetentionTarget>[0]
}>): void {
  const { analysisRepository } = input
  registerMarketHistoryRetentionJob(input.jobRuntime, createMarketHistoryRetention({
    stores: {
      macro: { retention: ({ cutoffs }) => input.macroStore.retention(cutoffs), note: (key, value) => input.macroStore.note(key, value) },
      crossAsset: { retention: ({ cutoffs }) => input.crossAssetStore.retention(cutoffs), note: (key, value) => input.crossAssetStore.note(key, value) },
      // The conclusions keep their own window: fourteen days, then the whole graph goes — except the
      // verdicts, which keep theirs (a hundred and eighty days) on the same clock. The signal ledger
      // has a third window (fifteen days) handled inside the same call but in its own transaction, so
      // a failed sweep cannot mark the conclusion store failed. The bar cutoffs are ignored rather
      // than reinterpreted — several policies, one clock.
      analysis: {
        retention: ({ atMs }) => ({
          thinned: 0,
          ...analysisRepository.retention({
            conclusionCutoffIso: analysisConclusionCutoffIso(atMs),
            ledgerCutoffIso: predictionLedgerCutoffIso(atMs),
            triggerLedgerCutoffIso: analysisTriggerLedgerCutoffIso(atMs)
          })
        }),
        note: (key, value) => analysisRepository.note(key, value)
      },
      // The model calls (prompt + raw answer) are their own store id: thirty days, or the oldest go
      // first until the compressed bytes are back under a hundred megabytes. A failure here writes
      // `analysis-io.retention.lastFailureCode` and leaves `analysis.retention.lastFailureCode`
      // empty — that separation is why this is not a second clock inside `analysis`.
      analysisIo: {
        retention: ({ atMs }) => ({ thinned: 0, ...analysisRepository.analysisIo.retention({ cutoffIso: analysisIoCutoffIso(atMs) }) }),
        note: (key, value) => analysisRepository.note(key, value)
      },
      // The news store keeps its own two windows (30 days of bodies, 365 of judgments) on this same
      // clock. It joins this job rather than owning a timer of its own: one daily pass, one startup
      // look, and a store whose database failed to open is simply absent from the pass.
      ...(input.newsStore ? { news: createNewsSentimentRetentionTarget(input.newsStore) } : {})
    }
  }).run)
}
