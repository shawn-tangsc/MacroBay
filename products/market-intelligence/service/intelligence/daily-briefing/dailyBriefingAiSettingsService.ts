import { resolveConfiguredAgentModel } from '@platform/ai/agent-platform/runtime/effectiveAgentModel'
import { parseConfiguredModelRef, resolveConfiguredModel } from '@platform/ai/model-defaults/configuredDefaultModel'

import {
  applyDailyBriefingAiSettingsPatch,
  isDailyBriefingModelSet,
  type DailyBriefingAiSettings,
  type DailyBriefingAiSettingsPatch
} from '../schema/dailyBriefingAiSettings'
import {
  resolveDailyBriefingEditorialModel,
  type DailyBriefingEditorialModel,
  type DailyBriefingModelResolverDeps
} from './dailyBriefingAiSettings'
import type { DailyBriefingAiSettingsStore } from './dailyBriefingAiSettingsStore'

export type DailyBriefingAiSettingsView = Readonly<{
  settings: Readonly<{ editorialEnabled: boolean; providerId: string; modelId: string; webSearchEnabled: boolean; webSearchAuthorizedAt?: string }>
  resolved: DailyBriefingEditorialModel
}>

export type DailyBriefingAiSettingsService = Readonly<{
  getView: () => Promise<DailyBriefingAiSettingsView>
  save: (patch: DailyBriefingAiSettingsPatch) => Promise<DailyBriefingAiSettingsView>
  /**
   * The model the editor agent must run now, resolved against the same single settings choice.
   *
   * A custom model that stopped being callable resolves to the platform default agent model — the
   * model an unbound agent would use — and is written onto the agent so the next session cannot
   * open on the stale, uncallable choice. `disabled` / `unavailable` mean "keep the fact layer".
   */
  ensureAgentModel: () => Promise<DailyBriefingEditorialModel>
}>

export function createDailyBriefingAiSettingsService(deps: Readonly<{
  store: DailyBriefingAiSettingsStore
  now?: () => string
  onModelSaved?: (settings: DailyBriefingAiSettings) => Promise<void> | void
  /** Writes the resolved model onto the editor agent; settings stay the only model choice. */
  applyAgentModel?: (modelId: string) => Promise<void> | void
}> & DailyBriefingModelResolverDeps): DailyBriefingAiSettingsService {
  const now = deps.now ?? (() => new Date().toISOString())

  async function view(settings: DailyBriefingAiSettings): Promise<DailyBriefingAiSettingsView> {
    return Object.freeze({
      settings: Object.freeze({
        editorialEnabled: settings.editorialEnabled,
        providerId: settings.providerId,
        modelId: settings.modelId,
        webSearchEnabled: settings.webSearchEnabled,
        ...(settings.webSearchAuthorizedAt ? { webSearchAuthorizedAt: settings.webSearchAuthorizedAt } : {})
      }),
      resolved: await resolveDailyBriefingEditorialModel(settings, deps)
    })
  }

  /**
   * Resolves what the agent session may call. The view resolver answers for the optional
   * single-call editorial layer (assistant default); an agent session instead follows the platform
   * default agent model, the same one `resolveEffectiveAgentModel` gives an unbound agent.
   */
  async function resolveAgentModel(): Promise<DailyBriefingEditorialModel> {
    const settings = await deps.store.getSettings()
    if (!settings.editorialEnabled) return Object.freeze({ state: 'disabled' as const })
    if (!deps.getModelDefaults || !deps.getProviderState) {
      return Object.freeze({ state: 'unavailable' as const, reason: 'default-unavailable' as const })
    }
    try {
      const [defaults, state] = await Promise.all([deps.getModelDefaults(), deps.getProviderState()])
      const customSet = isDailyBriefingModelSet(settings)
      if (customSet) {
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
      }
      const fallback = resolveConfiguredAgentModel({
        providers: state.providers,
        configuredDefaultModelId: defaults.agentModelId,
        agentType: 'claude-code'
      })
      const ref = fallback.ok ? parseConfiguredModelRef(fallback.model) : null
      if (!ref) return Object.freeze({ state: 'unavailable' as const, reason: 'default-unavailable' as const })
      return Object.freeze({
        state: 'agent' as const,
        providerId: ref.providerId,
        modelId: ref.modelId,
        source: 'default' as const,
        ...(customSet ? { fallback: 'custom-unavailable' as const } : {})
      })
    } catch {
      return Object.freeze({ state: 'unavailable' as const, reason: 'default-unavailable' as const })
    }
  }

  async function ensureAgentModel(): Promise<DailyBriefingEditorialModel> {
    const resolved = await resolveAgentModel()
    if (resolved.state !== 'agent' || !deps.applyAgentModel) return resolved
    try {
      await deps.applyAgentModel(`${resolved.providerId}:${resolved.modelId}`)
      return resolved
    } catch {
      // The session could still open on the stale model that just failed readiness; the fact layer
      // is safer than silently calling it.
      return Object.freeze({ state: 'unavailable' as const, reason: 'default-unavailable' as const })
    }
  }

  return {
    async getView() {
      return view(await deps.store.getSettings())
    },
    async save(patch) {
      const current = await deps.store.getSettings()
      const next = applyDailyBriefingAiSettingsPatch(current, patch, now())
      const saved = await deps.store.save(next)
      await deps.onModelSaved?.(saved)
      return view(saved)
    },
    ensureAgentModel
  }
}
