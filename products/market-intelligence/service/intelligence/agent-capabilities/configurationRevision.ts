import { createHash } from 'node:crypto'

import type { IntelligenceSourceProfile } from '../schema/intelligenceSource'

export type ConfigurationRevisionInput = {
  profiles: readonly IntelligenceSourceProfile[]
  focusMarkets: readonly string[]
}

/**
 * Single implementation of the configuration revision. Focus markets are part
 * of the revision because they change the analysis scope.
 */
export function computeConfigurationRevision({ profiles, focusMarkets }: ConfigurationRevisionInput): string {
  const rows = profiles
    .map((profile) =>
      [
        profile.sourceId,
        profile.enabled,
        profile.collectionPreset,
        profile.includeInSentiment,
        profile.scopePolicy,
        profile.rawArchiveEnabled,
        profile.retentionMode,
        profile.autoReplayAfterParserUpgrade,
        (profile.monitoredSymbols ?? []).join(','),
        profile.updatedAt
      ].join('|')
    )
    .sort()

  rows.push(`focus:${[...focusMarkets].sort().join(',')}`)

  return createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 12)
}
