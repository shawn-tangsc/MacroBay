import { getIntelligenceModule } from '../intelligenceModule'
import type { MacroCalendarSettingsProviderId } from '../../../contracts/macro/economicCalendarQueryContracts'
import type { IntelligenceSourceProfile } from '../schema/intelligenceSource'
import {
  computeCalendarRevision,
  computeConfigurationRevision,
  computeCrossAssetRevision,
  computeTranslationRevision
} from './configurationRevision'
import type { WriteHandlerDeps, WriteSnapshot } from './writeAudit'

export type SourceConfigurationState = {
  revision: string
  profiles: readonly IntelligenceSourceProfile[]
  focusMarkets: readonly string[]
}

export type CalendarConfigurationState = {
  revision: string
  providers: Readonly<Record<string, boolean>>
  releaseTimes: Readonly<Record<string, Readonly<{ scheduledAt: string; scheduledDate: string }>>>
}

/** One read of the two things the source configuration revision is computed from. */
export async function readSourceConfiguration(
  deps: WriteHandlerDeps
): Promise<SourceConfigurationState> {
  const sourcesService = getIntelligenceModule(deps.jobRuntime).sourcesService
  const [profiles, focusSettings] = await Promise.all([
    sourcesService.listProfiles(),
    sourcesService.getFocusSettings()
  ])
  return {
    revision: computeConfigurationRevision({
      profiles,
      focusMarkets: focusSettings.enabledFocusMarkets
    }),
    profiles,
    focusMarkets: [...focusSettings.enabledFocusMarkets]
  }
}

/** The profile fields an agent may read or change, and nothing else (no credentialRef). */
export function sourceConfigValue(
  state: SourceConfigurationState,
  sourceId: string
): Record<string, unknown> {
  const profile = state.profiles.find((candidate) => candidate.sourceId === sourceId)
  if (!profile) return {}
  return {
    sourceId: profile.sourceId,
    enabled: profile.enabled === true,
    collectionPreset: profile.collectionPreset,
    includeInSentiment: profile.includeInSentiment === true,
    scopePolicy: profile.scopePolicy,
    rawArchiveEnabled: profile.rawArchiveEnabled === true,
    retentionMode: profile.retentionMode,
    autoReplayAfterParserUpgrade: profile.autoReplayAfterParserUpgrade === true,
    ...(profile.monitoredSymbols && profile.monitoredSymbols.length > 0
      ? { monitoredSymbols: [...profile.monitoredSymbols] }
      : {})
  }
}

export function focusMarketsValue(state: SourceConfigurationState): Record<string, unknown> {
  return { enabledFocusMarkets: [...state.focusMarkets] }
}

export async function readSourceSnapshot(
  deps: WriteHandlerDeps,
  sourceId: string
): Promise<WriteSnapshot> {
  const state = await readSourceConfiguration(deps)
  return { revision: state.revision, value: sourceConfigValue(state, sourceId) }
}

export async function readFocusMarketsSnapshot(deps: WriteHandlerDeps): Promise<WriteSnapshot> {
  const state = await readSourceConfiguration(deps)
  return { revision: state.revision, value: focusMarketsValue(state) }
}

/** Operations that change no configuration still carry the revision they ran under. */
export async function readRevisionSnapshot(deps: WriteHandlerDeps): Promise<WriteSnapshot> {
  const state = await readSourceConfiguration(deps)
  return { revision: state.revision, value: {} }
}

/** One read of the provider enable map and every release time the calendar owns. */
export async function readCalendarConfiguration(
  deps: WriteHandlerDeps
): Promise<CalendarConfigurationState> {
  const configuration = await deps.macroCalendarOps.readConfiguration()
  return {
    revision: computeCalendarRevision(configuration),
    providers: configuration.providers,
    releaseTimes: configuration.releaseTimes
  }
}

export async function readCalendarProviderSnapshot(
  deps: WriteHandlerDeps,
  providerId: MacroCalendarSettingsProviderId
): Promise<WriteSnapshot> {
  const [state, enabled] = await Promise.all([
    readCalendarConfiguration(deps),
    deps.macroCalendarOps.readProviderState(providerId)
  ])
  return { revision: state.revision, value: { enabled } }
}

export async function readCalendarReleaseTimeSnapshot(
  deps: WriteHandlerDeps,
  eventKey: string
): Promise<WriteSnapshot> {
  const [state, releaseTime] = await Promise.all([
    readCalendarConfiguration(deps),
    deps.macroCalendarOps.readReleaseTime(eventKey)
  ])
  return {
    revision: state.revision,
    value: {
      releaseTime: releaseTime?.scheduledAt ?? null,
      releaseDate: releaseTime?.scheduledDate ?? null
    }
  }
}

export async function readCalendarRevisionSnapshot(deps: WriteHandlerDeps): Promise<WriteSnapshot> {
  const state = await readCalendarConfiguration(deps)
  return { revision: state.revision, value: {} }
}

/** Translation settings as the agent may see them; no provider secret lives here. */
export async function readTranslationSnapshot(deps: WriteHandlerDeps): Promise<WriteSnapshot> {
  const settings = await getIntelligenceModule(deps.jobRuntime).translationService.getSettings()
  return {
    revision: computeTranslationRevision(settings),
    value: {
      autoTranslateEnabled: settings.autoTranslateEnabled === true,
      targetLocale: settings.targetLocale,
      providerId: settings.providerId ?? null,
      modelId: settings.modelId ?? null,
      translateTitle: settings.translateTitle === true,
      translateSummary: settings.translateSummary === true,
      translateEvidenceExcerpt: settings.translateEvidenceExcerpt === true
    }
  }
}

/** The cross-asset interface is its own configuration domain; leases are operations. */
export async function readCrossAssetSnapshot(deps: WriteHandlerDeps): Promise<WriteSnapshot> {
  const configuration = await deps.crossAssetOps.readConfiguration()
  return { revision: computeCrossAssetRevision(configuration), value: {} }
}
