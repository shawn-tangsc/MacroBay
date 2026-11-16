import { intelligenceSourcesClient } from '../../../shared/ipc/intelligenceSourcesClient'

/**
 * Re-collecting what the capital-conditions panel reads.
 *
 * 刷新 on that panel used to re-read the stored snapshot, so a reader looking at
 * "资金面暂时不可用" was shown the same state the collector had already failed to update.
 * Asking the collection layer for the sources again is what makes the read that follows a
 * read of fresh data.
 *
 * ETF 那一半从 2026-11-17 起也能手动重采：主源 `cryptoetf-etf-flows` 打开了手动采集
 * （`supportsRunNow: true`），点一下走的是产品自己的 ETF 刷新（主源 + 备源合并那一轮），
 * 不是另开一条采集路径。备源 0xrouter 自己的目录项仍是 `supportsRunNow: false`
 * （它是「被合并」的一方，不需要单独一个按钮）。
 *
 * The list lives in the feature because the panel owns which sources it renders; the
 * renderer never talks to the service or the bridge directly (see the dashboard layering
 * guard).
 */
export const capitalConditionsCollectableSourceIds = ['defillama-stablecoins', 'cryptoetf-etf-flows'] as const

export async function collectCapitalConditionsSources(): Promise<void> {
  await Promise.all(capitalConditionsCollectableSourceIds.map(sourceId => intelligenceSourcesClient.runNow(sourceId)))
}
