import { resolveConfiguredModel } from '@platform/ai/model-defaults/configuredDefaultModel'
import type { ProviderState } from '@platform/ai/providers/modelProviderTypes'
import type { ModelDefaultsSettings } from '@platform/settings/schema/appSettings'

import {
  isDailyBriefingModelSet,
  type DailyBriefingAiSettings
} from '../schema/dailyBriefingAiSettings'

export type DailyBriefingEditorialModel =
  | Readonly<{ state: 'disabled' }>
  | Readonly<{
    state: 'agent'
    providerId: string
    modelId: string
    source: 'default' | 'custom'
    fallback?: 'custom-unavailable'
  }>
  | Readonly<{ state: 'unavailable'; reason: 'default-unavailable' }>

export type DailyBriefingModelResolverDeps = Readonly<{
  getModelDefaults?: () => Promise<ModelDefaultsSettings>
  getProviderState?: () => Promise<ProviderState>
}>

/**
 * Resolves the model at call time. A custom choice that cannot be called now falls back to the
 * platform default; if that is unavailable too, the caller keeps the fact layer. A disabled switch
 * wins over any stored model.
 */
export async function resolveDailyBriefingEditorialModel(
  settings: DailyBriefingAiSettings,
  deps: DailyBriefingModelResolverDeps
): Promise<DailyBriefingEditorialModel> {
  if (!settings.editorialEnabled) return Object.freeze({ state: 'disabled' as const })
  if (!deps.getModelDefaults || !deps.getProviderState) {
    return Object.freeze({ state: 'unavailable' as const, reason: 'default-unavailable' as const })
  }
  try {
    const [defaults, state] = await Promise.all([deps.getModelDefaults(), deps.getProviderState()])
    const defaultModel = resolveConfiguredModel({
      value: defaults.assistantModelId,
      providers: state.providers,
      isModelAcceptable: (_provider, model) => model.capabilities.chat === true
    })
    if (isDailyBriefingModelSet(settings)) {
      const custom = resolveConfiguredModel({
        value: `${settings.providerId}:${settings.modelId}`,
        providers: state.providers,
        isModelAcceptable: (_provider, model) => model.capabilities.chat === true
      })
      if (custom.ok) {
        return Object.freeze({
          state: 'agent' as const,
          providerId: custom.ref.providerId,
          modelId: custom.ref.modelId,
          source: 'custom' as const
        })
      }
      if (defaultModel.ok) {
        return Object.freeze({
          state: 'agent' as const,
          providerId: defaultModel.ref.providerId,
          modelId: defaultModel.ref.modelId,
          source: 'default' as const,
          fallback: 'custom-unavailable' as const
        })
      }
      return Object.freeze({ state: 'unavailable' as const, reason: 'default-unavailable' as const })
    }
    if (defaultModel.ok) {
      return Object.freeze({
        state: 'agent' as const,
        providerId: defaultModel.ref.providerId,
        modelId: defaultModel.ref.modelId,
        source: 'default' as const
      })
    }
    return Object.freeze({ state: 'unavailable' as const, reason: 'default-unavailable' as const })
  } catch {
    return Object.freeze({ state: 'unavailable' as const, reason: 'default-unavailable' as const })
  }
}
