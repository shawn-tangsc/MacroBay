/** The source switches the daily briefing reads, in one place for the source and the read tools. */
export const DAILY_BRIEFING_SOURCE_IDS = Object.freeze({
  fearGreed: 'alternative-fear-greed',
  funding: 'binance-futures-positioning',
  stablecoin: 'defillama-stablecoins',
  etf: '0xrouter-aggregate-provider'
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
    etf: enabled(DAILY_BRIEFING_SOURCE_IDS.etf),
    calendar: profiles.some((profile) => profile.sourceId.startsWith('macro-calendar-') && profile.enabled === true)
  })
}
