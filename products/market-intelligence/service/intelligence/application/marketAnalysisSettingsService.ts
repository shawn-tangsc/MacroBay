import type { ProviderState } from '@platform/ai/providers/modelProviderTypes'
import { resolveConfiguredModel } from '@platform/ai/model-defaults/configuredDefaultModel'
import type { ModelDefaultsSettings } from '@platform/settings/schema/appSettings'

import {
  MARKET_ANALYSIS_SETTINGS_ERROR_CODES,
  applyMarketAnalysisSettingsPatch,
  isMarketAnalysisModelSet,
  type MarketAnalysisSettings,
  type MarketAnalysisSettingsPatch
} from './marketAnalysisSettings'
import type { MarketAnalysisSettingsStore } from './marketAnalysisSettingsStore'

export type MarketAnalysisSettingsService = Readonly<{
  getSettings: () => Promise<MarketAnalysisSettings>
  /**
   * Applies a patch and returns what was stored.
   *
   * Enabling requires a model. With no explicit choice the platform's default assistant model is
   * resolved once and written into the settings, so the analysis keeps calling that model even if
   * the platform default moves later; a model that cannot be called right now is refused instead
   * of being stored and failing on the next background run.
   */
  updateSettings: (patch: MarketAnalysisSettingsPatch) => Promise<MarketAnalysisSettings>
}>

export type MarketAnalysisSettingsDependencies = Readonly<{
  store: MarketAnalysisSettingsStore
  now: () => string
  getProviderState?: () => Promise<ProviderState>
  getModelDefaults?: () => Promise<ModelDefaultsSettings>
}>

export function createMarketAnalysisSettingsService(
  deps: MarketAnalysisSettingsDependencies
): MarketAnalysisSettingsService {
  const getSettings = () => deps.store.getSettings()

  async function resolveAssistantModel(): Promise<{ providerId: string; modelId: string } | null> {
    if (!deps.getModelDefaults || !deps.getProviderState) return null
    try {
      const [defaults, state] = await Promise.all([deps.getModelDefaults(), deps.getProviderState()])
      const resolved = resolveConfiguredModel({
        value: defaults.assistantModelId,
        providers: state.providers,
        isModelAcceptable: (_provider, model) => model.capabilities.chat === true
      })
      return resolved.ok ? { providerId: resolved.ref.providerId, modelId: resolved.ref.modelId } : null
    } catch {
      return null
    }
  }

  /** A model that exists but cannot be called now must not be stored and discovered on the next run. */
  async function assertModelUsable(settings: MarketAnalysisSettings): Promise<void> {
    if (!deps.getProviderState) return
    const state = await deps.getProviderState().catch(() => undefined)
    const resolved = state
      ? resolveConfiguredModel({
        value: `${settings.providerId}:${settings.modelId}`,
        providers: state.providers,
        isModelAcceptable: (_provider, model) => model.capabilities.chat === true
      })
      : undefined
    if (!resolved?.ok) throw new Error(MARKET_ANALYSIS_SETTINGS_ERROR_CODES.modelUnavailable)
  }

  return {
    getSettings,
    async updateSettings(patch) {
      const current = await getSettings()
      let next = applyMarketAnalysisSettingsPatch(current, patch, deps.now())

      // Turning it on (or clearing the model while it stays on) needs a model: take the platform's
      // default assistant model once and keep it, rather than re-deriving it on every run.
      if (next.enabled && !isMarketAnalysisModelSet(next)) {
        const snapshot = await resolveAssistantModel()
        if (!snapshot) throw new Error(MARKET_ANALYSIS_SETTINGS_ERROR_CODES.modelUnconfigured)
        next = applyMarketAnalysisSettingsPatch(next, snapshot, deps.now())
      }
      if (next.enabled) await assertModelUsable(next)

      return deps.store.save(next)
    }
  }
}
