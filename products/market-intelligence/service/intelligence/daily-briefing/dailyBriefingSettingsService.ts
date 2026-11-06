import type { DailyBriefingAiSettingsPatch } from '../schema/dailyBriefingAiSettings'
import type { DailyBriefingAiSettingsService } from './dailyBriefingAiSettingsService'
import type { DailyBriefingGenerationSettingsService, DailyBriefingGenerationSettingsView } from './dailyBriefingGenerationSettingsService'
import type { EditionLanguageSettingsPatch } from './dailyBriefingLanguageSettings'
import type { EditionLanguageSettingsService, EditionLanguageSettingsView } from './dailyBriefingLanguageSettingsService'

/**
 * The reader settings that shape one edition, behind one IPC seam:
 *
 * - `settings` is the AI editorial preference (model, web search, on/off);
 * - `generation` is the period list: when each edition runs and how far back it looks;
 * - `language` is the one global language preference and the plan derived from it.
 *
 * They stay separate shapes on purpose: each service keeps its own rules, and saving one never
 * rewrites another. The page reads all three and writes only the blocks the reader touched.
 */
export type DailyBriefingGenerationPatch = Readonly<{ generationTime?: string; windowHours?: number }>

export type DailyBriefingSettingsPatch = DailyBriefingAiSettingsPatch & Readonly<{
  generation?: DailyBriefingGenerationPatch
  language?: EditionLanguageSettingsPatch
}>

export type DailyBriefingSettingsView = Readonly<{
  settings: Readonly<{
    editorialEnabled: boolean
    providerId: string
    modelId: string
    webSearchEnabled: boolean
    webSearchAuthorizedAt?: string
  }>
  generation: DailyBriefingGenerationSettingsView
  /** The global language preference and the plan the page renders; the page never re-derives it. */
  language: EditionLanguageSettingsView
  /** 日报 agent 实际模型能否使用 Anthropic server-side WebSearch/WebFetch。 */
  webSearchSupported: boolean
  resolved:
    | Readonly<{ state: 'disabled' }>
    | Readonly<{ state: 'agent'; providerId: string; modelId: string; source: 'default' | 'custom'; fallback?: 'custom-unavailable' }>
    | Readonly<{ state: 'unavailable'; reason: 'default-unavailable' }>
}>

export type DailyBriefingSettingsService = Readonly<{
  getView: () => Promise<DailyBriefingSettingsView>
  save: (patch: DailyBriefingSettingsPatch) => Promise<DailyBriefingSettingsView>
}>

const AI_PATCH_KEYS = ['editorialEnabled', 'providerId', 'modelId', 'webSearchEnabled', 'webSearchAuthorizedAt'] as const

export function createDailyBriefingSettingsService(deps: Readonly<{
  ai: Pick<DailyBriefingAiSettingsService, 'getView' | 'save'>
  generation: Pick<DailyBriefingGenerationSettingsService, 'getView' | 'save'>
  language: Pick<EditionLanguageSettingsService, 'getView' | 'save'>
}>): DailyBriefingSettingsService {
  async function view(): Promise<DailyBriefingSettingsView> {
    const [ai, generation, language] = await Promise.all([
      deps.ai.getView(),
      deps.generation.getView(),
      deps.language.getView()
    ])
    return Object.freeze({
      settings: ai.settings,
      generation,
      language,
      resolved: ai.resolved,
      webSearchSupported: ai.webSearchSupported
    })
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
      if (patch.language) await deps.language.save(patch.language)
      return view()
    }
  }
}
