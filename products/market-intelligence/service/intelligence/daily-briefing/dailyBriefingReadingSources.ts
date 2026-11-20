import type { MarketFactId } from '../../../contracts/factSources'

import { allSources } from '../application/providerRegistry'

/** The fact whose provider the briefing asks for instead of naming an id. */
export const ETF_FACT_ID: MarketFactId = 'etf-net-flow'

/**
 * Sources that declare a fact, read from the registry each call. The provider is configuration,
 * not a constant: adding a second source is one declaration, not an edit here.
 */
export function declaredSourceIdsForFact(factId: MarketFactId): readonly string[] {
  return allSources().filter((source) => source.provides?.includes(factId) === true).map((source) => source.sourceId)
}

/** The source switches the daily briefing reads, in one place for the source and the read tools. */
export const DAILY_BRIEFING_SOURCE_IDS = Object.freeze({
  fearGreed: 'alternative-fear-greed',
  funding: 'binance-futures-positioning',
  stablecoin: 'defillama-stablecoins',
  /**
   * The macro rows the deterministic core-fact ensure may read. The dollar has two writers (the
   * licensed index and this product's basket), so either switch is enough for `dxy`; gold and the
   * two 10-year yields each have one owner.
   */
  dxyReal: 'realmarketapi-market',
  dxySynthetic: 'twelve-data-market',
  gold: 'realmarketapi-market',
  rates: 'fred-rates-liquidity'
})

export type DailyBriefingEnabledFlags = Readonly<{
  fearGreed: boolean
  funding: boolean
  stablecoin: boolean
  etf: boolean
  calendar: boolean
}>

/**
 * `undefined` means the profile store could not be read: that is "unknown", not "everything off".
 * An empty list is a clean install and does mean every source is off.
 */
export function dailyBriefingEnabledFromProfiles(
  profiles: readonly Readonly<{ sourceId: string; enabled: boolean }>[] | undefined
): DailyBriefingEnabledFlags {
  if (!profiles) return Object.freeze({ fearGreed: true, funding: true, stablecoin: true, etf: true, calendar: true })
  const enabled = (sourceId: string): boolean => profiles.some((profile) => profile.sourceId === sourceId && profile.enabled === true)
  return Object.freeze({
    fearGreed: enabled(DAILY_BRIEFING_SOURCE_IDS.fearGreed),
    funding: enabled(DAILY_BRIEFING_SOURCE_IDS.funding),
    stablecoin: enabled(DAILY_BRIEFING_SOURCE_IDS.stablecoin),
    etf: declaredSourceIdsForFact(ETF_FACT_ID).some(enabled),
    calendar: profiles.some((profile) => profile.sourceId.startsWith('macro-calendar-') && profile.enabled === true)
  })
}
