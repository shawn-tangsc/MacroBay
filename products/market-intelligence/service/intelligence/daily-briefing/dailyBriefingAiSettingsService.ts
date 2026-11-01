import { resolveConfiguredAgentModel } from '@platform/ai/agent-platform/runtime/effectiveAgentModel'
import { parseConfiguredModelRef, resolveConfiguredModel } from '@platform/ai/model-defaults/configuredDefaultModel'
import { supportsAnthropicServerWebSearch } from '@platform/ai/providers/providerServerTools'
import type { ModelProvider } from '@platform/ai/providers/modelProviderTypes'

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
  /**
   * Whether the model that will actually run the editor agent can take Anthropic server-side web
   * tools. `false` means WebSearch/WebFetch must not be granted: the endpoint would reject the
   * request (third-party messages endpoints return `400 tools.0.input_schema`).
   */
  webSearchSupported: boolean
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
    const [resolved, agentModel] = await Promise.all([
      resolveDailyBriefingEditorialModel(settings, deps),
      resolveAgentModel(settings)
    ])
    return Object.freeze({
      settings: Object.freeze({
        editorialEnabled: settings.editorialEnabled,
        providerId: settings.providerId,
        modelId: settings.modelId,
        webSearchEnabled: settings.webSearchEnabled,
        ...(settings.webSearchAuthorizedAt ? { webSearchAuthorizedAt: settings.webSearchAuthorizedAt } : {})
      }),
      resolved,
      webSearchSupported: agentModel.webSearchSupported
    })
  }

  /**
   * Resolves what the agent session may call. The view resolver answers for the optional
   * single-call editorial layer (assistant default); an agent session instead follows the platform
   * default agent model, the same one `resolveEffectiveAgentModel` gives an unbound agent.
   *
   * Web-search support belongs to this agent model: a custom model can differ from the editorial
   * default, and the editor agent is the only caller that can emit Anthropic server web tools.
   */
  async function resolveAgentModel(settings: DailyBriefingAiSettings): Promise<{
    model: DailyBriefingEditorialModel
    webSearchSupported: boolean
  }> {
    if (!settings.editorialEnabled) {
      return { model: Object.freeze({ state: 'disabled' as const }), webSearchSupported: false }
    }
    if (!deps.getModelDefaults || !deps.getProviderState) {
      return { model: Object.freeze({ state: 'unavailable' as const, reason: 'default-unavailable' as const }), webSearchSupported: false }
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
          return {
            model: Object.freeze({
              state: 'agent' as const,
              providerId: custom.ref.providerId,
              modelId: custom.ref.modelId,
              source: 'custom' as const
            }),
            webSearchSupported: providerSupportsWebSearch(state.providers, custom.ref.providerId)
          }
        }
      }
      const fallback = resolveConfiguredAgentModel({
        providers: state.providers,
        configuredDefaultModelId: defaults.agentModelId,
        agentType: 'claude-code'
      })
      const ref = fallback.ok ? parseConfiguredModelRef(fallback.model) : null
      if (!ref) {
        return { model: Object.freeze({ state: 'unavailable' as const, reason: 'default-unavailable' as const }), webSearchSupported: false }
      }
      return {
        model: Object.freeze({
          state: 'agent' as const,
          providerId: ref.providerId,
          modelId: ref.modelId,
          source: 'default' as const,
          ...(customSet ? { fallback: 'custom-unavailable' as const } : {})
        }),
        webSearchSupported: providerSupportsWebSearch(state.providers, ref.providerId)
      }
    } catch {
      return { model: Object.freeze({ state: 'unavailable' as const, reason: 'default-unavailable' as const }), webSearchSupported: false }
    }
  }

  async function ensureAgentModel(): Promise<DailyBriefingEditorialModel> {
    const settings = await deps.store.getSettings()
    const resolved = (await resolveAgentModel(settings)).model
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

function providerSupportsWebSearch(providers: readonly ModelProvider[], providerId: string): boolean {
  const provider = providers.find((item) => item.id === providerId)
  return provider ? supportsAnthropicServerWebSearch(provider) : false
}
