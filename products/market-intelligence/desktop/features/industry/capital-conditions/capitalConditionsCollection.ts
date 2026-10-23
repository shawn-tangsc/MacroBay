import { intelligenceSourcesClient } from '../../../shared/ipc/intelligenceSourcesClient'

/**
 * Re-collecting what the capital-conditions panel reads.
 *
 * 刷新 on that panel used to re-read the stored snapshot, so a reader looking at
 * "资金面暂时不可用" was shown the same state the collector had already failed to update.
 * Asking the collection layer for the sources again is what makes the read that follows a
 * read of fresh data.
 *
 * `0xrouter-aggregate-provider` (the ETF half of the panel) is deliberately absent: the
 * source catalog keeps `supportsRunNow: false` for it — "generic collection and Run Now
 * remain unavailable" — and `intelligenceSources.runNow` throws for such a source, so
 * listing it here would make the button fail every time.
 *
 * The list lives in the feature because the panel owns which sources it renders; the
 * renderer never talks to the service or the bridge directly (see the dashboard layering
 * guard).
 */
export const capitalConditionsCollectableSourceIds = ['defillama-stablecoins'] as const

export async function collectCapitalConditionsSources(): Promise<void> {
  await Promise.all(capitalConditionsCollectableSourceIds.map(sourceId => intelligenceSourcesClient.runNow(sourceId)))
}
