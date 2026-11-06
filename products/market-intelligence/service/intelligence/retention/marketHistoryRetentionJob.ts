import type { JobRuntime } from '@platform/jobs'
import { barRetentionCutoffs, type BarRetentionCutoffs } from './barRetention'

/**
 * The daily pass that keeps both market stores inside their retention policy.
 *
 * One job rather than two: the two stores answer the same policy from the same clock, and running them
 * together means the ledger's two lines describe one instant instead of two. A store that throws does not
 * stop the other — a repository that cannot be compacted today must not leave the other one growing
 * forever — and its failure is written down as a code, never as an exception the scheduler has to carry.
 */
export const MARKET_HISTORY_RETENTION_JOB_ID = 'market-intelligence.retain-market-history'
const PRODUCT_ID = 'market-intelligence'

export const marketHistoryRetentionPolicy = Object.freeze({
  intervalMs: 24 * 3_600_000,
  /** The stores this pass owns, and the note prefix each ledger line is filed under. */
  stores: Object.freeze({ macro: 'macro-market', crossAsset: 'cross-asset', analysis: 'analysis', news: 'news-sentiment', analysisIo: 'analysis-io' } as const)
})

type StoreId = keyof typeof marketHistoryRetentionPolicy.stores
/**
 * What one store's pass did. `ledgerDeleted` is optional because only the analysis store has a second
 * clock: its verdicts outlive their conclusions, so the pass reports two counts and the bar stores
 * report one. `triggerLedgerDeleted` is the analysis store's third count — the signal ledger's own
 * fifteen days — and stays absent when that segment could not run. `bytesBefore` / `bytesAfter` are
 * the call record's occupancy: a pass that reports only a deletion count cannot say how close the
 * hundred-megabyte ceiling it is, and one that reports only the current size cannot say whether the
 * pass ran at all. `capped` says the pass hit its own row budget and more is waiting — without it a
 * capped store would look finished.
 */
export type MarketHistoryRetentionResult = Readonly<{ thinned: number; deleted: number; ledgerDeleted?: number; triggerLedgerDeleted?: number; bytesBefore?: number; bytesAfter?: number; oldestKeptAtMs: number | null; capped?: boolean }>
/**
 * What a store has to offer to be retained: the pass itself, and somewhere to write its own ledger.
 *
 * The pass is handed the instant as well as the bar cutoffs, because the stores do not share one window:
 * market bars keep eight days hot and drop at thirty, while an analysis conclusion is kept fourteen days
 * and deleted whole. One clock reading feeds both, so no two stores can disagree about which night it is.
 */
export type RetainedStore = Readonly<{
  retention: (input: Readonly<{ atMs: number; cutoffs: BarRetentionCutoffs }>) => MarketHistoryRetentionResult
  note: (key: string, value: string) => void
}>

export type MarketHistoryRetentionSummary = Readonly<{
  atMs: number
  results: Readonly<Partial<Record<StoreId, MarketHistoryRetentionResult | { state: 'failed'; failureCode: 'retention-failed' }>>>
}>

/**
 * A store whose database could not be opened is simply absent from the pass, not a failure: it has
 * nothing to retain today and must not stop the other stores from being retained.
 */
export function createMarketHistoryRetention(deps: Readonly<{
  stores: Readonly<Partial<Record<StoreId, RetainedStore>>>
  now?: () => number
  onError?: (error: unknown, storeId: StoreId) => void
}>): Readonly<{ run: (atMs?: number) => Promise<MarketHistoryRetentionSummary> }> {
  const now = deps.now ?? Date.now
  return {
    async run(atMs: number = now()): Promise<MarketHistoryRetentionSummary> {
      // One clock reading for both stores: a pass that straddled midnight would thin one store against a
      // different edge than the other, and the ledger would say two things about one night.
      const cutoffs = barRetentionCutoffs(atMs)
      const results: Partial<Record<string, MarketHistoryRetentionResult | { state: 'failed'; failureCode: 'retention-failed' }>> = {}
      for (const [storeId, store] of Object.entries(deps.stores) as [StoreId, RetainedStore | undefined][]) {
        if (!store) continue
        const prefix = `${marketHistoryRetentionPolicy.stores[storeId]}.retention`
        try {
          const result = store.retention({ atMs, cutoffs })
          store.note(`${prefix}.lastRunAtMs`, String(atMs))
          store.note(`${prefix}.lastThinned`, String(result.thinned))
          store.note(`${prefix}.lastDeleted`, String(result.deleted))
          if (result.ledgerDeleted !== undefined) store.note(`${prefix}.lastLedgerDeleted`, String(result.ledgerDeleted))
          if (result.triggerLedgerDeleted !== undefined) store.note(`${prefix}.lastTriggerLedgerDeleted`, String(result.triggerLedgerDeleted))
          if (result.bytesBefore !== undefined) store.note(`${prefix}.lastBytesBefore`, String(result.bytesBefore))
          if (result.bytesAfter !== undefined) store.note(`${prefix}.lastBytesAfter`, String(result.bytesAfter))
          if (result.capped) store.note(`${prefix}.lastCapped`, 'true')
          store.note(`${prefix}.oldestKeptAtMs`, result.oldestKeptAtMs === null ? 'none' : String(result.oldestKeptAtMs))
          results[storeId] = result
        } catch (error) {
          // A refusal is a fact about this store, not a reason to skip the other one.
          store.note(`${prefix}.lastFailureCode`, 'retention-failed')
          deps.onError?.(error, storeId)
          results[storeId] = { state: 'failed', failureCode: 'retention-failed' }
        }
      }
      return Object.freeze({ atMs, results: Object.freeze(results) as MarketHistoryRetentionSummary['results'] })
    }
  }
}

/**
 * A daily clock, and a look at startup.
 *
 * The startup leg matters on the first run after this ships: a store that has been kept forever has
 * months of folding to do, and waiting until the first midnight would leave the reader's disk as it was
 * for a day. Both legs are the same handler, so a mid-pass failure is retried by the next day's run
 * rather than by a second code path.
 */
export function registerMarketHistoryRetentionJob(
  jobRuntime: JobRuntime,
  run: (atMs?: number) => Promise<unknown>
): void {
  jobRuntime.registerHandler(MARKET_HISTORY_RETENTION_JOB_ID, async () => { await run() })
  const definition = {
    id: MARKET_HISTORY_RETENTION_JOB_ID, owner: 'product' as const, productId: PRODUCT_ID,
    handlerId: MARKET_HISTORY_RETENTION_JOB_ID, title: 'Retain market history',
    audience: 'internal' as const,
    trigger: { kind: 'interval' as const, intervalMs: marketHistoryRetentionPolicy.intervalMs, anchor: 'lastComplete' as const },
    payload: {}
  }
  if (typeof jobRuntime.setSchedule === 'function') {
    jobRuntime.setSchedule(definition as never)
    void jobRuntime.enqueueDefinition({ ...definition, id: `${MARKET_HISTORY_RETENTION_JOB_ID}:startup`, trigger: { kind: 'manual' as const } } as never).catch(() => undefined)
  }
}
