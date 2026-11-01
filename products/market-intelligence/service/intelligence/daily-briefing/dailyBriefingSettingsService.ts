import type { DailyBriefingAiSettingsPatch } from '../schema/dailyBriefingAiSettings'
import type { DailyBriefingAiSettingsService } from './dailyBriefingAiSettingsService'
import type { DailyBriefingGenerationSettingsService } from './dailyBriefingGenerationSettingsService'

/**
 * The two reader settings that shape one edition, behind one IPC seam:
 *
 * - `settings` is the AI editorial preference (model, web search, on/off).
 * - `generation` is when the edition runs and how far back it looks.
 *
 * They stay separate shapes on purpose: the AI service keeps owning model resolution and the
 * generation service keeps owning the schedule, so neither has to know the other's rules. Saving one
 * never rewrites the other.
 */
export type DailyBriefingGenerationPatch = Readonly<{ generationTime?: string; windowHours?: number }>

export type DailyBriefingSettingsView = Readonly<{
  settings: Readonly<{
    editorialEnabled: boolean
    providerId: string
    modelId: string
    webSearchEnabled: boolean
    webSearchAuthorizedAt?: string
  }>
  generation: Readonly<{ generationTime: string; windowHours: number; cronExpression: string }>
  /** 日报 agent 实际模型能否使用 Anthropic server-side WebSearch/WebFetch。 */
  webSearchSupported: boolean
  resolved:
    | Readonly<{ state: 'disabled' }>
    | Readonly<{ state: 'agent'; providerId: string; modelId: string; source: 'default' | 'custom'; fallback?: 'custom-unavailable' }>
    | Readonly<{ state: 'unavailable'; reason: 'default-unavailable' }>
}>

export type DailyBriefingSettingsPatch = DailyBriefingAiSettingsPatch & Readonly<{
  generation?: DailyBriefingGenerationPatch
}>

export type DailyBriefingSettingsService = Readonly<{
  getView: () => Promise<DailyBriefingSettingsView>
  save: (patch: DailyBriefingSettingsPatch) => Promise<DailyBriefingSettingsView>
}>

const AI_PATCH_KEYS = ['editorialEnabled', 'providerId', 'modelId', 'webSearchEnabled', 'webSearchAuthorizedAt'] as const

export function createDailyBriefingSettingsService(deps: Readonly<{
  ai: Pick<DailyBriefingAiSettingsService, 'getView' | 'save'>
  generation: Pick<DailyBriefingGenerationSettingsService, 'getView' | 'save'>
}>): DailyBriefingSettingsService {
  async function view(): Promise<DailyBriefingSettingsView> {
    const [ai, generation] = await Promise.all([deps.ai.getView(), deps.generation.getView()])
    return Object.freeze({ settings: ai.settings, generation, resolved: ai.resolved, webSearchSupported: ai.webSearchSupported })
  }

  return {
    getView: view,
    async save(patch) {
      const aiPatch = Object.fromEntries(
        AI_PATCH_KEYS
          .filter((key) => patch[key] !== undefined)
          .map((key) => [key, patch[key]])
      ) as DailyBriefingAiSettingsPatch
      if (Object.keys(aiPatch).length > 0) await deps.ai.save(aiPatch)
      if (patch.generation) await deps.generation.save(patch.generation)
      return view()
    }
  }
}
