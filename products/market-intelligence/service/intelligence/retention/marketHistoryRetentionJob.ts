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
  /** The two stores this pass owns, and the note prefix each ledger line is filed under. */
  stores: Object.freeze({ macro: 'macro-market', crossAsset: 'cross-asset', analysis: 'analysis' } as const)
})

type StoreId = keyof typeof marketHistoryRetentionPolicy.stores
export type MarketHistoryRetentionResult = Readonly<{ thinned: number; deleted: number; oldestKeptAtMs: number | null }>
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
  results: Readonly<Record<StoreId, MarketHistoryRetentionResult | { state: 'failed'; failureCode: 'retention-failed' }>>
}>

export function createMarketHistoryRetention(deps: Readonly<{
  stores: Readonly<Record<StoreId, RetainedStore>>
  now?: () => number
  onError?: (error: unknown, storeId: StoreId) => void
}>): Readonly<{ run: (atMs?: number) => Promise<MarketHistoryRetentionSummary> }> {
  const now = deps.now ?? Date.now
  return {
    async run(atMs: number = now()): Promise<MarketHistoryRetentionSummary> {
      // One clock reading for both stores: a pass that straddled midnight would thin one store against a
      // different edge than the other, and the ledger would say two things about one night.
      const cutoffs = barRetentionCutoffs(atMs)
      const results: Record<string, MarketHistoryRetentionResult | { state: 'failed'; failureCode: 'retention-failed' }> = {}
      for (const [storeId, store] of Object.entries(deps.stores) as [StoreId, RetainedStore][]) {
        const prefix = `${marketHistoryRetentionPolicy.stores[storeId]}.retention`
        try {
          const result = store.retention({ atMs, cutoffs })
          store.note(`${prefix}.lastRunAtMs`, String(atMs))
          store.note(`${prefix}.lastThinned`, String(result.thinned))
          store.note(`${prefix}.lastDeleted`, String(result.deleted))
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
    trigger: { kind: 'interval' as const, intervalMs: marketHistoryRetentionPolicy.intervalMs, anchor: 'lastComplete' as const },
    payload: {}
  }
  if (typeof jobRuntime.setSchedule === 'function') {
    jobRuntime.setSchedule(definition as never)
    void jobRuntime.enqueueDefinition({ ...definition, id: `${MARKET_HISTORY_RETENTION_JOB_ID}:startup`, trigger: { kind: 'manual' as const } } as never).catch(() => undefined)
  }
}
