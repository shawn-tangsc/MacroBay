import type { DailyBriefingAiSettingsPatch } from '../schema/dailyBriefingAiSettings'
import type { DailyBriefingAiSettingsService } from './dailyBriefingAiSettingsService'
import type { EditionLanguageSettingsPatch } from './dailyBriefingLanguageSettings'
import type { EditionLanguageSettingsService, EditionLanguageSettingsView } from './dailyBriefingLanguageSettingsService'

/**
 * The reader settings that shape one edition, behind one IPC seam:
 *
 * - `settings` is the AI editorial preference (model, web search, on/off);
 * - `language` is the one global language preference and the plan derived from it.
 *
 * The period list — when each edition runs and how far back it looks — is no longer part of this
 * surface: it has its own store and its own IPC methods, so a second copy here could only disagree
 * with the schedule. They stay separate shapes on purpose: saving one never rewrites another.
 */
export type DailyBriefingSettingsPatch = DailyBriefingAiSettingsPatch & Readonly<{
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
  language: Pick<EditionLanguageSettingsService, 'getView' | 'save'>
}>): DailyBriefingSettingsService {
  async function view(): Promise<DailyBriefingSettingsView> {
    const [ai, language] = await Promise.all([deps.ai.getView(), deps.language.getView()])
    return Object.freeze({
      settings: ai.settings,
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
      if (patch.language) await deps.language.save(patch.language)
      return view()
    }
  }
}
