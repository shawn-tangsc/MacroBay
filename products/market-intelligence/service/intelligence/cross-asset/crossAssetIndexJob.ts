import type { JobRuntime } from '@platform/jobs'
import { crossAssetPolicy } from './crossAssetPolicy'

export const CROSS_ASSET_INDEX_COLLECT_JOB_ID = 'market-intelligence.collect-cross-asset-index'
const PRODUCT_ID = 'market-intelligence'

/**
 * A fifteen-minute clock for the licensed Nasdaq 100 index.
 *
 * It is the row's fallback, so it does not have to tick: one request per quarter hour is 2,880 a
 * month, and the provider's budget stays with the real dollar index. The tick spends nothing at all
 * when the reader has switched the source off.
 */
export function crossAssetIndexJobDefinitions(): readonly Readonly<Record<string, unknown>>[] {
  const definition = {
    id: CROSS_ASSET_INDEX_COLLECT_JOB_ID, owner: 'product' as const, productId: PRODUCT_ID,
    handlerId: CROSS_ASSET_INDEX_COLLECT_JOB_ID, title: 'Collect the real Nasdaq 100 index',
    audience: 'user' as const,
    trigger: { kind: 'interval' as const, intervalMs: crossAssetPolicy.index.intervalMs, anchor: 'lastComplete' as const },
    payload: {}
  }
  // The startup tick looks immediately, so a reader who opens the app mid-session does not stare at a
  // proxy label for five minutes while a perfectly good key sits in the vault.
  return [definition, { ...definition, id: `${CROSS_ASSET_INDEX_COLLECT_JOB_ID}:startup`, trigger: { kind: 'manual' as const }, payload: { startup: true } }]
}

/**
 * Registers the collector and asks for one startup tick.
 *
 * The interval is not armed here: a source that is switched off must own no job registration
 * (user, 2026-11-11). The schedule is owned by `intelligenceSourcesService` through
 * `sourceOwnedJobSchedules`, the single place that reads this source's switch.
 */
export function registerCrossAssetIndexJob(
  jobRuntime: JobRuntime,
  run: () => Promise<unknown>
): void {
  jobRuntime.registerHandler(CROSS_ASSET_INDEX_COLLECT_JOB_ID, async () => { await run() })
  const [, startup] = crossAssetIndexJobDefinitions()
  void jobRuntime.enqueueDefinition(startup as never).catch(() => undefined)
}
