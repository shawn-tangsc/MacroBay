import { getIntelligenceModule } from '../intelligenceModule'
import type { IntelligenceSourceProfile } from '../schema/intelligenceSource'
import { computeConfigurationRevision } from './configurationRevision'
import type { WriteHandlerDeps, WriteSnapshot } from './writeAudit'

export type SourceConfigurationState = {
  revision: string
  profiles: readonly IntelligenceSourceProfile[]
  focusMarkets: readonly string[]
}

/** One read of the two things the configuration revision is computed from. */
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

/** Translation settings as the agent may see them; no provider secret lives here. */
export async function readTranslationSnapshot(deps: WriteHandlerDeps): Promise<WriteSnapshot> {
  const state = await readSourceConfiguration(deps)
  const settings = await getIntelligenceModule(deps.jobRuntime).translationService.getSettings()
  return {
    revision: state.revision,
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
