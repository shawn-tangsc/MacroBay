import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import {
  createDefaultBriefingPeriod,
  type BriefingPeriod,
  type BriefingPeriodDraft
} from '../../../contracts/dailyBriefingPeriod'
import type { DailyBriefingAiSettingsPatch } from '../schema/dailyBriefingAiSettings'
import type { DailyBriefingAiSettingsService } from './dailyBriefingAiSettingsService'
import {
  dailyBriefingGenerationCronExpression,
  isDailyBriefingTimeZoneId,
  type DailyBriefingGenerationSettingsPatch
} from './dailyBriefingGenerationSettings'
import type {
  DailyBriefingGenerationSettingsService,
  DailyBriefingGenerationSettingsView,
  DailyBriefingPeriodView
} from './dailyBriefingGenerationSettingsService'
import type { EditionLanguageSettingsPatch } from './dailyBriefingLanguageSettings'
import type { EditionLanguageSettingsService, EditionLanguageSettingsView } from './dailyBriefingLanguageSettingsService'
import type { BriefingPeriodSaveResult } from './dailyBriefingPeriodStore'

/**
 * The reader settings that shape one edition, behind one IPC seam:
 *
 * - `settings` is the AI editorial preference (model, web search, on/off);
 * - `generation` is the period the panel edits: its hour and window;
 * - `language` is the one global language preference and the plan derived from it.
 *
 * They stay separate shapes on purpose: each service keeps its own rules, and saving one never
 * rewrites another.
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

/**
 * The generation block's real store: the reader's period list, one row per edition.
 *
 * The block edits the **first** period, because the old panel showed one row and one save has to
 * keep meaning "the edition I am looking at". Adding, removing and ordering periods belongs to the
 * period list surface, which writes the same store through its own methods.
 */
export type DailyBriefingPeriodEditor = Readonly<{
  list: (locale: DailyBriefingLocale) => Promise<readonly BriefingPeriod[]>
  update: (id: string, draft: BriefingPeriodDraft) => Promise<BriefingPeriodSaveResult>
  create: (draft: BriefingPeriodDraft) => Promise<BriefingPeriodSaveResult>
}>

const AI_PATCH_KEYS = ['editorialEnabled', 'providerId', 'modelId', 'webSearchEnabled', 'webSearchAuthorizedAt'] as const

/**
 * One period as the settings block reads it.
 *
 * A stored period has no zone of its own any more — "when it runs" is a wall-clock time in the
 * reader's zone, and the zone is decided at the read site. So the zone shown is the reader's, and
 * there is nothing to call invalid: the invalid-zone state belonged to the old per-period field.
 */
function projectPeriod(period: BriefingPeriod, readerTimeZone: string): DailyBriefingPeriodView {
  return Object.freeze({
    id: period.id,
    generationTime: period.generationTime,
    generationTimeZone: isDailyBriefingTimeZoneId(readerTimeZone) ? readerTimeZone : null,
    generationTimeZoneInvalid: null,
    windowHours: period.windowHours,
    cronExpression: dailyBriefingGenerationCronExpression(period)
  })
}

export function createDailyBriefingSettingsService(deps: Readonly<{
  ai: Pick<DailyBriefingAiSettingsService, 'getView' | 'save'>
  /**
   * The old generation settings service, still assembled this commit and never read or written by
   * this seam any more. It stays in the dependency list for one reason: the settings test watches
   * that `save` is never called, and a mutation that puts the old write back has somewhere to put
   * it. `C15c` removes the service and this field together.
   */
  generation: Pick<DailyBriefingGenerationSettingsService, 'save'>
  periods: DailyBriefingPeriodEditor
  language: Pick<EditionLanguageSettingsService, 'getView' | 'save'>
  /** The reader's interface language: names the language a newly created period speaks. */
  locale: () => Promise<DailyBriefingLocale>
  /** The reader's clock: what a stored wall-clock time means. */
  timeZone: () => string
}>): DailyBriefingSettingsService {
  async function view(): Promise<DailyBriefingSettingsView> {
    const locale = await deps.locale()
    const [ai, periods, language] = await Promise.all([
      deps.ai.getView(),
      deps.periods.list(locale),
      deps.language.getView()
    ])
    // No periods is a real state (the reader deleted them all), but the block cannot render an
    // edit form without one. The default stands in for the form only; saving then creates the
    // row, it never pretends one already exists.
    const first = periods[0] ?? createDefaultBriefingPeriod(locale)
    return Object.freeze({
      settings: ai.settings,
      generation: Object.freeze({ periods: Object.freeze([projectPeriod(first, deps.timeZone())]) }),
      language,
      resolved: ai.resolved,
      webSearchSupported: ai.webSearchSupported
    })
  }

  /** Edit the first period in place; with no period at all, the save creates the first one. */
  async function saveFirstPeriod(patch: DailyBriefingGenerationSettingsPatch): Promise<void> {
    const locale = await deps.locale()
    const first = (await deps.periods.list(locale))[0]
    const fallback = createDefaultBriefingPeriod(locale)
    const draft: BriefingPeriodDraft = {
      generationTime: patch.generationTime ?? first?.generationTime ?? fallback.generationTime,
      windowHours: patch.windowHours ?? first?.windowHours ?? fallback.windowHours,
      language: first?.language ?? fallback.language
    }
    const result = first === undefined
      ? await deps.periods.create(draft)
      : await deps.periods.update(first.id, draft)
    // The store's rule wins: a rejected draft is reported, never written over.
    if (result.state !== 'saved') throw new Error(result.code)
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
      if (patch.generation) await saveFirstPeriod(patch.generation)
      if (patch.language) await deps.language.save(patch.language)
      return view()
    }
  }
}
