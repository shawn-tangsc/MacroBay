import { createHash } from 'node:crypto'

import type { IntelligenceSourceProfile } from '../schema/intelligenceSource'

export type ConfigurationRevisionInput = {
  profiles: readonly IntelligenceSourceProfile[]
  focusMarkets: readonly string[]
}

export type CalendarReleaseTimeValue = Readonly<{
  scheduledAt: string
  scheduledDate: string
}>

export type CalendarRevisionInput = {
  providers: Readonly<Record<string, boolean>>
  releaseTimes: Readonly<Record<string, CalendarReleaseTimeValue>>
}

export type TranslationRevisionInput = {
  autoTranslateEnabled: boolean
  targetLocale: string
  providerId?: string
  modelId?: string
  translateTitle: boolean
  translateSummary: boolean
  translateEvidenceExcerpt: boolean
}

export type CrossAssetRevisionInput =
  | Readonly<{ state: 'configured' | 'default'; enabled: boolean }>
  | Readonly<{ state: 'unknown' }>

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

  return shortRevision(rows)
}

/**
 * The calendar domain changes when a provider is enabled or disabled and when the
 * reader edits a release time; nothing else may move this revision.
 */
export function computeCalendarRevision({ providers, releaseTimes }: CalendarRevisionInput): string {
  const rows = [
    ...Object.keys(providers)
      .sort()
      .map((providerId) => `provider|${providerId}|${providers[providerId] === true}`),
    ...Object.keys(releaseTimes)
      .sort()
      .map(
        (eventKey) =>
          `release|${eventKey}|${releaseTimes[eventKey]!.scheduledAt}|${releaseTimes[eventKey]!.scheduledDate}`
      )
  ]
  return shortRevision(rows)
}

/**
 * Translation settings are their own configuration domain. `updatedAt` is
 * metadata, not a setting: it must not move the revision on its own.
 */
export function computeTranslationRevision(settings: TranslationRevisionInput): string {
  return shortRevision([
    [
      settings.autoTranslateEnabled === true,
      settings.targetLocale,
      settings.providerId ?? '',
      settings.modelId ?? '',
      settings.translateTitle === true,
      settings.translateSummary === true,
      settings.translateEvidenceExcerpt === true
    ].join('|')
  ])
}

/** The cross-asset interface is one enabled flag plus whether it was ever configured. */
export function computeCrossAssetRevision(configuration: CrossAssetRevisionInput): string {
  return shortRevision([
    configuration.state === 'unknown' ? 'unknown' : `${configuration.state}|${configuration.enabled === true}`
  ])
}

function shortRevision(rows: readonly string[]): string {
  return createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 12)
}
